import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { baselines, channels, events, healthScores, issues, outbox, samplesHourly, settings } from '../db/schema';
import { lowPctFor } from '../rules/battery';
import { countRejoins, onePerRejoin } from '../rules/churn';
import type { EventRow } from '../rules/types';
import type { AppState, EventKind } from '../types';
import { GREEN } from '../../score';
import { batteryRows } from '../../views';
import { getSettings } from '../settings';
import type { Message } from './channel';

const H = 3_600_000;
const DAY = 24 * H;
const KEY = 'weeklyDigestWeek';

/** ISO week id (`2026-W43`) of the Sunday 18:00 (in `tz`) that most recently passed, or null if `lastWeek` already has it. */
export function shouldSendWeekly(now: number, lastWeek: string | null, tz: string): string | null {
	const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' })
		.formatToParts(now).map((x) => [x.type, Number(x.value)]));
	const today = Date.UTC(p.year, p.month - 1, p.day);
	const back = new Date(today).getUTCDay() || (p.hour < 18 ? 7 : 0); // days since that Sunday
	const thursday = new Date(today - back * DAY - 3 * DAY); // an ISO week belongs to the year of its Thursday
	const week = Math.floor((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / DAY / 7) + 1;
	const id = `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
	return id === lastWeek ? null : id;
}

const list = (xs: string[]) => xs.slice(0, 5).map((x) => `• ${x}`).join('\n').slice(0, 1024);

export function weeklyDigest(db: Db, state: AppState, now: number): Message {
	const name = (ieee: string) => state.devices.get(ieee)?.friendlyName ?? ieee;
	const fields: Message['fields'] = [];

	const scores = db.select().from(healthScores).where(gte(healthScores.ts, now - 7 * DAY)).orderBy(asc(healthScores.ts)).all();
	const min = scores.length ? Math.min(...scores.map((s) => s.score)) : null;
	if (scores.length)
		fields.push({ name: 'Health score', value: `${scores.at(-1)!.score} now, ${scores[0].score} a week ago, lowest ${min}` });

	const open = db.select({ severity: issues.severity, n: sql<number>`count(*)` }).from(issues).where(sql`${issues.state} != 'resolved'`).groupBy(issues.severity).all();
	const openCount = open.reduce((a, o) => a + o.n, 0);
	if (openCount) fields.push({ name: 'Open issues', value: (['critical', 'warning', 'info'] as const).flatMap((s) => open.filter((o) => o.severity === s).map((o) => `${o.n} ${s}`)).join(', ') });

	const daysLeft = new Map(db.select().from(baselines).where(eq(baselines.metric, 'battery_days_left')).all().map((b) => [b.ieee, b.value]));
	const buy = batteryRows([...state.devices.values()], daysLeft, new Map(), lowPctFor(getSettings(db))).filter((r) => r.low || (r.daysLeft !== null && r.daysLeft <= 30));
	if (buy.length) fields.push({ name: 'Batteries to buy', value: list(buy.map((r) => `${r.name} (${r.battery ?? '?'}%${r.daysLeft !== null ? `, about ${Math.round(r.daysLeft)} days left` : ''})`)) });

	const weak = db.select({ ieee: samplesHourly.ieee, lqi: sql<number>`avg(${samplesHourly.lqiAvg})` }).from(samplesHourly)
		.where(and(gte(samplesHourly.hour, now - DAY), sql`${samplesHourly.lqiAvg} is not null`)).groupBy(samplesHourly.ieee).orderBy(sql`avg(${samplesHourly.lqiAvg})`).limit(5).all();
	if (weak.length) fields.push({ name: 'Weakest links (24 h)', value: list(weak.map((w) => `${name(w.ieee)}: LQI ${Math.round(w.lqi)}`)) });

	const evs = db.select().from(events).where(gte(events.ts, now - 7 * DAY)).orderBy(asc(events.ts), asc(events.id)).all()
		.filter((e) => e.ieee !== null).map((e) => ({ ...e, kind: e.kind as EventKind, detail: e.detail ?? {} }) as EventRow);
	const by = (pick: (e: EventRow) => boolean) => {
		const m = new Map<string, EventRow[]>();
		for (const e of evs.filter(pick)) m.set(e.ieee!, [...(m.get(e.ieee!) ?? []), e]);
		return m;
	};
	const churn = [...by((e) => e.kind === 'device_announce' || e.kind === 'address_changed')].map(([ieee, es]) => {
		const rejoins = onePerRejoin(es); // a rejoin with a new address shows as both: count it once
		return [ieee, Math.max(countRejoins(rejoins, 0, 'device_announce'), countRejoins(rejoins, 0, 'address_changed'))] as const;
	}).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]); // one announce is normal after a battery swap
	if (churn.length) fields.push({ name: 'Most rejoins (7 days)', value: list(churn.map(([i, n]) => `${name(i)}: ${n}`)) });

	const fails = [...by((e) => e.kind === 'route_error' && e.detail.kind === 'command_failed')].map(([i, es]) => [i, es.length] as const).sort((a, b) => b[1] - a[1]);
	if (fails.length) fields.push({ name: 'Route failures (7 days)', value: list(fails.map(([i, n]) => `${name(i)}: ${n}`)) });

	const good = (min === null || min >= GREEN) && !openCount && !buy.length;
	return { kind: 'digest', severity: 'info', title: 'Weekly digest', fields,
		summary: good ? 'All good this week.' : 'How the mesh did this week.' };
}

/** At the first run after Sunday 18:00 (local) queues the digest once per ISO week for every channel that wants it. */
export function sendWeekly(db: Db, state: AppState, now: number, tz: string, quiet: boolean): void {
	// shortcut: while quiet hours last the digest waits (held rows would fold into the overnight summary and lose their content)
	if (quiet) return;
	const last = db.select().from(settings).where(eq(settings.key, KEY)).get()?.value;
	const week = shouldSendWeekly(now, typeof last === 'string' && last ? last : null, tz);
	if (!week) return;
	const record = () => db.insert(settings).values({ key: KEY, value: week }).onConflictDoUpdate({ target: settings.key, set: { value: week } }).run();
	if (!last) {
		record();
		return;
	} // fresh install: no catch-up digest, the first one goes out next Sunday 18:00
	const message = weeklyDigest(db, state, now);
	for (const ch of db.select().from(channels).where(eq(channels.enabled, true)).all())
		if (ch.config?.weeklyDigest ?? ch.kind === 'discord')
			db.insert(outbox).values({ channelId: ch.id, issueId: null, kind: 'digest', severity: 'info', message,
				dedupeKey: `weekly:${week}:${ch.id}`, status: 'pending', nextAttemptAt: now, createdAt: now }).onConflictDoNothing().run();
	record();
}
