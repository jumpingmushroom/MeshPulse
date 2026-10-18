import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { decrypt } from '../crypto';
import type { Db } from '../db/index';
import { channels, issues, outbox } from '../db/schema';
import { RANK, type IssueRow, type Notify } from '../issues/lifecycle';
import type { DeviceState, Severity } from '../types';
import { SEVERITY_LABEL, toMessage, type Channel, type Message } from './channel';
import { apprise } from './apprise';
import { discord, MENTION_KINDS } from './discord';

export const CHANNELS: Record<string, Channel> = { discord, apprise };

const SPACING_MS = 2000;
const BACKOFF_MS = [60_000, 300_000, 1_800_000];
const MAX_ATTEMPTS = 4;

// webhook and Apprise URLs carry tokens; errors like "Failed to parse URL from <url>" must not store or return it
const redact = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>');

/** Bullet list that fits a Discord field value (1024 chars). */
function bullets(lines: string[]): string {
	let out = '';
	for (const [i, l] of lines.entries()) {
		const more = `\n…and ${lines.length - i} more`;
		if (out.length + l.length + 3 + (i < lines.length - 1 ? more.length + 4 : 0) > 1024) return out + more;
		out += (out ? '\n' : '') + `• ${l}`;
	}
	return out;
}

const maxSeverity = (s: Severity[]) => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'info');

export function enqueue(db: Db, issue: IssueRow, n: Notify,
	{ now, quiet, publicUrl, device, tz }: { now: number; quiet: boolean; publicUrl?: string; device: DeviceState | null; tz?: string }): void {
	const message = toMessage(issue, n.kind, device, publicUrl, tz);
	const held = quiet && n.severity !== 'critical';
	for (const ch of db.select().from(channels).where(eq(channels.enabled, true)).all()) {
		if (RANK[n.severity] < RANK[ch.minSeverity]) continue;
		const dedupeKey = `${issue.id}:${n.kind}:${n.severity}:${ch.id}` + (n.kind === 'reminder' ? `:${now}` : '');
		// a repeated key (e.g. escalate, de-escalate, escalate) is a legit no-op; throwing would roll back the engine run
		db.insert(outbox).values({ channelId: ch.id, issueId: issue.id, kind: n.kind, severity: n.severity, message, dedupeKey,
			status: held ? 'held' : 'pending', nextAttemptAt: held ? null : now, createdAt: now }).onConflictDoNothing().run();
	}
}

/** End of quiet hours: per channel, all held rows become one pending summary. */
export function foldHeld(db: Db, now: number): void {
	const held = db.select().from(outbox).where(eq(outbox.status, 'held')).orderBy(asc(outbox.createdAt), asc(outbox.id)).all();
	for (const channelId of new Set(held.map((r) => r.channelId))) {
		const rows = held.filter((r) => r.channelId === channelId);
		const ids = [...new Set(rows.flatMap((r) => (r.issueId === null ? [] : [r.issueId])))];
		const iss = db.select().from(issues).where(inArray(issues.id, ids)).all();
		const open = iss.filter((i) => i.state !== 'resolved');
		const resolved = iss.filter((i) => i.state === 'resolved');
		const list = (xs: typeof iss) => bullets(xs.map((i) => i.summary));
		const message: Message = {
			kind: 'digest', title: 'Overnight summary', severity: open.length ? maxSeverity(open.map((i) => i.severity)) : 'resolved',
			summary: `${rows.length} message(s) were held during quiet hours.`,
			fields: [
				...(open.length ? [{ name: 'Still open', value: list(open) }] : []),
				...(resolved.length ? [{ name: 'Resolved overnight', value: list(resolved) }] : [])
			]
		};
		const digest = db.insert(outbox).values({ channelId, issueId: null, kind: 'digest', severity: maxSeverity(rows.map((r) => r.severity)), message,
			dedupeKey: `digest:${channelId}:${now}`, status: 'pending', nextAttemptAt: now, createdAt: now }).onConflictDoNothing().returning().get();
		if (!digest) continue; // key collision: keep them held for the next fold
		db.update(outbox).set({ status: 'sent', sentAt: now }).where(inArray(outbox.id, rows.map((r) => r.id))).run();
	}
}

// shortcut: in-memory, so a restart may send one message within 2 s of the last; fine for one process
const lastSentAt = new Map<number, number>();
export const resetOutbox = () => lastSentAt.clear();

type ChannelRow = typeof channels.$inferSelect;
const sendVia = (ch: ChannelRow, message: Message, secretKey: string, fetchFn: typeof fetch) => {
	const impl = CHANNELS[ch.kind];
	if (!impl) throw new Error(`unknown channel kind ${ch.kind}`);
	const cfg = ch.config ?? {};
	const secret = (k: string) => (cfg[k] === undefined ? {} : { [k]: decrypt(String(cfg[k]), secretKey) });
	return impl.send({ ...cfg, ...secret('webhookUrl'), ...secret('urls') }, message, fetchFn);
};

export async function outboxTick({ db, secretKey, fetch: fetchFn = fetch }: { db: Db; secretKey: string; fetch?: typeof fetch }, now: number): Promise<void> {
	const due = db.select().from(outbox).where(and(eq(outbox.status, 'pending'), lte(outbox.nextAttemptAt, now)))
		.orderBy(asc(outbox.createdAt), asc(outbox.id)).all();
	for (const channelId of new Set(due.map((r) => r.channelId))) {
		const rows = due.filter((r) => r.channelId === channelId);
		const ch = db.select().from(channels).where(eq(channels.id, channelId)).get();
		if (!ch?.enabled) {
			db.update(outbox).set({ status: 'failed', lastError: ch ? 'channel disabled' : 'channel missing' })
				.where(inArray(outbox.id, rows.map((r) => r.id))).run();
			continue;
		}
		if (now - (lastSentAt.get(channelId) ?? -Infinity) < SPACING_MS) continue;
		lastSentAt.set(channelId, now);
		// weekly digests go out on their own, never inside an "N notifications" burst
		const rest = rows.filter((r) => !r.dedupeKey.startsWith('weekly:'));
		const batch = rest.length > 3 ? rest : [rows[0]];
		const msgs = batch.map((r) => r.message as Message);
		const message: Message = batch.length === 1 ? msgs[0] : {
			kind: 'digest', title: `${batch.length} notifications`, summary: 'Several notifications were due at once.',
			severity: msgs.some((m) => m.severity !== 'resolved') ? maxSeverity(msgs.flatMap((m) => (m.severity === 'resolved' ? [] : [m.severity]))) : 'resolved',
			// 25 fields x 150 chars stays under Discord's 6000-char embed total
			fields: [...msgs.slice(0, msgs.length > 25 ? 24 : 25).map((m) => ({ name: m.title.slice(0, 100), value: m.summary.slice(0, 150) })),
				...(msgs.length > 25 ? [{ name: `+${msgs.length - 24} more`, value: 'See MeshPulse for the full list.' }] : [])],
			mention: msgs.some((m) => m.severity === 'critical' && MENTION_KINDS.includes(m.kind))
		};
		try {
			await sendVia(ch, message, secretKey, fetchFn);
			db.update(outbox).set({ status: 'sent', sentAt: now, lastError: null }).where(inArray(outbox.id, batch.map((r) => r.id))).run();
		} catch (e) {
			const lastError = redact(e);
			const retryAfterMs = (e as { retryAfterMs?: number }).retryAfterMs;
			for (const r of batch) {
				const attempts = retryAfterMs === undefined ? r.attempts + 1 : r.attempts; // 429s don't count
				const failed = attempts >= MAX_ATTEMPTS;
				db.update(outbox).set({ attempts, lastError, status: failed ? 'failed' : 'pending',
					nextAttemptAt: failed ? r.nextAttemptAt : now + (retryAfterMs ?? BACKOFF_MS[attempts - 1]) }).where(eq(outbox.id, r.id)).run();
			}
		}
	}
}

export function startOutbox(deps: { db: Db; secretKey: string; fetch?: typeof fetch }): { stop(): void } {
	let busy = false; // a slow send must not overlap the next tick, or rows go out twice
	const timer = setInterval(async () => {
		if (busy) return;
		busy = true;
		try {
			await outboxTick(deps, Date.now());
		} catch (e) {
			console.error('outbox: tick failed', e);
		} finally {
			busy = false;
		}
	}, SPACING_MS);
	return { stop: () => clearInterval(timer) };
}

const TEST_MESSAGE: Message = { kind: 'open', severity: 'info', title: 'Info: MeshPulse test message',
	summary: 'If you can read this, MeshPulse can reach this channel.', fields: [] };

/** Posts a test message directly, bypassing the outbox. Never throws. */
export async function sendTest(db: Db, channelId: number, secretKey: string, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
	try {
		const ch = db.select().from(channels).where(eq(channels.id, channelId)).get();
		if (!ch) return { ok: false, error: 'channel not found' };
		await sendVia(ch, TEST_MESSAGE, secretKey, fetchFn);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: redact(e) };
	}
}
