import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/index';
import { channels, issues, outbox, settings } from '../db/schema';
import { due } from '../active/schedule';
import { RANK } from '../issues/lifecycle';
import { RULE_DEFAULTS, type RuleId } from '../rules/index';
import { setSetting, type Settings } from '../settings';
import type { AppState, Severity } from '../types';
import { bullets } from './outbox';
import type { Message } from './channel';

// not a DEFAULT_SETTINGS key: a raw row, so the settings form never validates or overwrites it
const KEY = 'dailySummaryDay';
const LABEL = { critical: 'Critical', warning: 'Warning' } as const;

/**
 * Once a day at `summaryTime` (local), one message per channel lists the issues still open, in place of per-issue reminders.
 * Lists announced, unacknowledged, top-level issues of notifying rules on devices that are not muted or ignored.
 */
export function sendDaily(db: Db, state: AppState, now: number, tz: string, quiet: boolean, s: Pick<Settings, 'summaryTime'>): void {
	if (quiet) return; // a summary held through quiet hours would fold into the overnight one and lose its list
	const last = db.select().from(settings).where(eq(settings.key, KEY)).get()?.value;
	const day = due(now, s.summaryTime, typeof last === 'string' ? last : '', tz);
	if (!day) return;
	const silent = (ieee: string | null) => {
		const d = ieee ? state.devices.get(ieee) : undefined;
		return !!d && ((d.mutedUntil ?? 0) > now || d.tags.includes('ignore'));
	};
	const open = db.select().from(issues).where(and(eq(issues.state, 'open'), isNull(issues.parentIssueId), isNotNull(issues.lastNotifiedAt))).all()
		.filter((i) => i.severity !== 'info' && RULE_DEFAULTS[i.rule as RuleId]?.notify && !silent(i.ieee))
		.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.openedAt - b.openedAt);
	for (const ch of db.select().from(channels).where(eq(channels.enabled, true)).all()) {
		const mine = open.filter((i) => RANK[i.severity] >= RANK[ch.minSeverity]);
		if (!mine.length) continue;
		const severity: Severity = mine[0].severity;
		const message: Message = {
			kind: 'digest', severity, title: `Still open: ${mine.length} ${mine.length === 1 ? 'issue' : 'issues'}`,
			summary: 'Acknowledge the ones you accept to leave them out of this summary.',
			fields: (['critical', 'warning'] as const).flatMap((sev) => {
				const xs = mine.filter((i) => i.severity === sev);
				return xs.length ? [{ name: `${LABEL[sev]} (${xs.length})`, value: bullets(xs.map((i) => i.summary)) }] : [];
			})
		};
		db.insert(outbox).values({ channelId: ch.id, issueId: null, kind: 'digest', severity, message,
			dedupeKey: `daily:${day}:${ch.id}`, status: 'pending', nextAttemptAt: now, createdAt: now }).onConflictDoNothing().run();
	}
	setSetting(db, KEY, day);
}
