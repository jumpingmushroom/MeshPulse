import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { encrypt } from '../crypto';
import { openDb, type Db } from '../db';
import { channels, issues, outbox } from '../db/schema';
import type { IssueRow, Notify } from '../issues/lifecycle';
import type { Severity } from '../types';
import { enqueue, foldHeld, outboxTick, resetOutbox, sendTest } from './outbox';

const T = 1760000000000;
const KEY = 'secret';
const HOOK = 'https://discord.test/api/webhooks/1/abc';

const issue = (id: number, severity: Severity = 'warning', p: Partial<IssueRow> = {}): IssueRow => ({
	id, rule: 'battery.low', ieee: null, severity, state: 'open', openedAt: T, updatedAt: T, resolvedAt: null,
	summary: `Issue ${id}`, action: 'Do something', evidence: {}, lastNotifiedAt: null, parentIssueId: null, ...p
});
const n = (severity: Severity = 'warning', kind: Notify['kind'] = 'open'): Notify => ({ key: 'k', kind, severity });

function setup() {
	const db = openDb(':memory:');
	const addChannel = (minSeverity: Severity = 'info', enabled = true) =>
		db.insert(channels).values({ kind: 'discord', name: 'd', minSeverity, enabled,
			config: { webhookUrl: encrypt(HOOK, KEY), mentionCritical: true } }).returning().get().id;
	return { db, addChannel };
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;
function fakeFetch(replies: Reply[] = []) {
	const calls: { url: string; body: { embeds: { title: string; fields: { name: string }[] }[]; content?: string } }[] = [];
	const fn = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(init.body as string) });
		const r = replies.shift() ?? { status: 204 };
		if (r instanceof Error) throw r;
		return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
	}) as unknown as typeof fetch;
	return { fn, calls };
}
const rows = (db: Db) => db.select().from(outbox).all();
const tick = (db: Db, fetch: typeof globalThis.fetch, now: number) => outboxTick({ db, secretKey: KEY, fetch }, now);

beforeEach(() => resetOutbox());

describe('outbox', () => {
	it('enqueue respects min_severity', () => {
		const { db, addChannel } = setup();
		const info = addChannel('info');
		const crit = addChannel('critical');
		addChannel('info', false);
		enqueue(db, issue(1), n(), { now: T, quiet: false, device: null });
		expect(rows(db)).toMatchObject([{ channelId: info, issueId: 1, kind: 'open', severity: 'warning', status: 'pending', nextAttemptAt: T, dedupeKey: `1:open:warning:${info}` }]);
		// resolved uses the issue's severity
		enqueue(db, issue(2, 'critical'), n('critical', 'resolved'), { now: T, quiet: false, device: null });
		expect(rows(db).filter((r) => r.issueId === 2).map((r) => r.channelId)).toEqual([info, crit]);
	});

	it('enqueue during quiet hours holds warning, sends critical', () => {
		const { db, addChannel } = setup();
		addChannel();
		enqueue(db, issue(1), n(), { now: T, quiet: true, device: null });
		enqueue(db, issue(2, 'critical'), n('critical'), { now: T, quiet: true, device: null });
		enqueue(db, issue(3), n('warning', 'resolved'), { now: T, quiet: true, device: null });
		expect(rows(db).map((r) => [r.issueId, r.status])).toEqual([[1, 'held'], [2, 'pending'], [3, 'held']]);
	});

	it('dedupe key blocks a second identical row', () => {
		const { db, addChannel } = setup();
		addChannel();
		enqueue(db, issue(1, 'critical'), n('critical', 'escalate'), { now: T, quiet: false, device: null });
		// escalate → de-escalate → escalate repeats the key and must not throw
		expect(() => enqueue(db, issue(1, 'critical'), n('critical', 'escalate'), { now: T + 1, quiet: false, device: null })).not.toThrow();
		expect(rows(db)).toHaveLength(1);
		enqueue(db, issue(1), n('warning', 'reminder'), { now: T, quiet: false, device: null });
		enqueue(db, issue(1), n('warning', 'reminder'), { now: T + 1, quiet: false, device: null });
		expect(rows(db).map((r) => r.dedupeKey).slice(1)).toEqual([`1:reminder:warning:1:${T}`, `1:reminder:warning:1:${T + 1}`]);
	});

	it('sends and marks sent', async () => {
		const { db, addChannel } = setup();
		addChannel();
		enqueue(db, issue(1, 'critical'), n('critical'), { now: T, quiet: false, device: null });
		const f = fakeFetch();
		await tick(db, f.fn, T);
		expect(f.calls).toMatchObject([{ url: HOOK, body: { content: '@here', embeds: [{ title: 'Critical: Issue 1' }] } }]);
		expect(rows(db)).toMatchObject([{ status: 'sent', sentAt: T }]);
		await tick(db, f.fn, T + 5000);
		expect(f.calls).toHaveLength(1);
	});

	it('retries with 1/5/30 min backoff then marks failed after 4 attempts', async () => {
		const { db, addChannel } = setup();
		addChannel();
		enqueue(db, issue(1), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch([{ status: 500, body: 'oops' }, new Error('ECONNRESET'), { status: 400 }, { status: 502 }]);
		let now = T;
		const expected: [number, number | null, string][] = [[1, 60_000, 'pending'], [2, 300_000, 'pending'], [3, 1_800_000, 'pending'], [4, null, 'failed']];
		for (const [attempts, delay, status] of expected) {
			await tick(db, f.fn, now);
			const r = rows(db)[0];
			expect(r).toMatchObject({ attempts, status, lastError: expect.any(String) });
			if (delay === null) break;
			expect(r.nextAttemptAt).toBe(now + delay);
			await tick(db, f.fn, now + delay - 1); // not due yet
			expect(f.calls).toHaveLength(attempts);
			now += delay;
		}
		await tick(db, f.fn, now + 3_600_000);
		expect(f.calls).toHaveLength(4);
	});

	it('honours 429 retry_after', async () => {
		const { db, addChannel } = setup();
		addChannel();
		enqueue(db, issue(1), n(), { now: T, quiet: false, device: null });
		enqueue(db, issue(2), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch([{ status: 429, body: { retry_after: 1.5 } }, { status: 429, headers: { 'retry-after': '7' } }]);
		await tick(db, f.fn, T);
		expect(rows(db)[0]).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: T + 1500 });
		await tick(db, f.fn, T + 2000); // both due again; row 1 goes first (createdAt, then id)
		expect(rows(db)[0]).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: T + 2000 + 7000 });
	});

	it('spaces sends 2 s per channel', async () => {
		const { db, addChannel } = setup();
		addChannel();
		const other = addChannel();
		for (const id of [1, 2]) enqueue(db, issue(id), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch();
		await tick(db, f.fn, T);
		expect(rows(db).filter((r) => r.status === 'sent').map((r) => [r.issueId, r.channelId])).toEqual([[1, 1], [1, other]]);
		await tick(db, f.fn, T + 1999);
		expect(f.calls).toHaveLength(2);
		await tick(db, f.fn, T + 2000);
		expect(rows(db).every((r) => r.status === 'sent')).toBe(true);
		expect(f.calls).toHaveLength(4);
	});

	it('folds more than 3 due rows into one digest', async () => {
		const { db, addChannel } = setup();
		addChannel();
		for (const id of [1, 2, 3, 4]) enqueue(db, issue(id), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch();
		await tick(db, f.fn, T);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].body.embeds[0].title).toBe('4 notifications');
		expect(f.calls[0].body.embeds[0].fields.map((x) => x.name)).toEqual([1, 2, 3, 4].map((i) => `Warning: Issue ${i}`));
		expect(rows(db).every((r) => r.status === 'sent')).toBe(true);
	});

	it('never folds a weekly digest into a burst', async () => {
		const { db, addChannel } = setup();
		const ch = addChannel();
		db.insert(outbox).values({ channelId: ch, issueId: null, kind: 'digest', severity: 'info', dedupeKey: `weekly:2026-W43:${ch}`,
			message: { kind: 'digest', severity: 'info', title: 'Weekly digest', summary: 's', fields: [] }, status: 'pending', nextAttemptAt: T, createdAt: T - 1 }).run();
		for (const id of [1, 2, 3, 4]) enqueue(db, issue(id), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch();
		await tick(db, f.fn, T);
		await tick(db, f.fn, T + 2000);
		expect(f.calls.map((c) => c.body.embeds[0].title)).toEqual(['4 notifications', 'Weekly digest']);
	});

	it('a burst with a critical open mentions only when mentionCritical is on', async () => {
		for (const mentionCritical of [true, false]) {
			resetOutbox();
			const { db, addChannel } = setup();
			const id = addChannel();
			db.update(channels).set({ config: { webhookUrl: encrypt(HOOK, KEY), mentionCritical } }).where(eq(channels.id, id)).run();
			for (const i of [1, 2, 3]) enqueue(db, issue(i), n(), { now: T, quiet: false, device: null });
			enqueue(db, issue(4, 'critical'), n('critical'), { now: T, quiet: false, device: null });
			const f = fakeFetch();
			await tick(db, f.fn, T);
			const body = f.calls[0].body as unknown as { content?: string; allowed_mentions: unknown };
			expect(body.content).toBe(mentionCritical ? '@here' : undefined);
			expect(body.allowed_mentions).toEqual({ parse: mentionCritical ? ['everyone'] : [] });
		}
	});

	it('caps a large burst at 24 fields plus "+N more", values at 150 chars', async () => {
		const { db, addChannel } = setup();
		addChannel();
		for (let i = 1; i <= 30; i++) enqueue(db, issue(i, 'warning', { summary: `Issue ${i} ` + 'x'.repeat(300) }), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch();
		await tick(db, f.fn, T);
		const fields = f.calls[0].body.embeds[0].fields as unknown as { name: string; value: string }[];
		expect(fields).toHaveLength(25);
		expect(fields[24].name).toBe('+6 more');
		expect(Math.max(...fields.map((x) => x.value.length))).toBeLessThanOrEqual(150);
		expect(rows(db).every((r) => r.status === 'sent')).toBe(true);
	});

	it('redacts URLs from errors', async () => {
		const { db, addChannel } = setup();
		const id = addChannel();
		enqueue(db, issue(1), n(), { now: T, quiet: false, device: null });
		const f = fakeFetch([new TypeError(`Failed to parse URL from ${HOOK}`), new TypeError(`Failed to parse URL from ${HOOK}`)]);
		await tick(db, f.fn, T);
		expect(rows(db)[0].lastError).toBe('Failed to parse URL from <url>');
		expect(await sendTest(db, id, KEY, f.fn)).toEqual({ ok: false, error: 'Failed to parse URL from <url>' });
	});

	it('redacts apprise urls in errors', async () => {
		const { db } = setup();
		const id = db.insert(channels).values({ kind: 'apprise', name: 'a', config: { apiUrl: 'http://a', urls: encrypt('tgram://123:abc/9', KEY) } }).returning().get().id;
		const f = fakeFetch([new TypeError('bad tgram://123:abc/9 here')]);
		expect(await sendTest(db, id, KEY, f.fn)).toEqual({ ok: false, error: 'bad <url> here' });
	});

	it('marks rows for a disabled or missing channel failed', async () => {
		const { db, addChannel } = setup();
		const id = addChannel();
		enqueue(db, issue(1), n(), { now: T, quiet: false, device: null });
		db.update(channels).set({ enabled: false }).where(eq(channels.id, id)).run();
		db.insert(outbox).values({ channelId: 99, kind: 'open', severity: 'warning', message: {}, dedupeKey: 'x', createdAt: T, nextAttemptAt: T }).run();
		const f = fakeFetch();
		await tick(db, f.fn, T);
		expect(f.calls).toHaveLength(0);
		expect(rows(db)).toMatchObject([{ status: 'failed', lastError: expect.any(String) }, { status: 'failed', lastError: expect.any(String) }]);
	});

	it('foldHeld makes one digest', async () => {
		const { db, addChannel } = setup();
		const ch = addChannel();
		const a = db.insert(issues).values({ ...issue(0), id: undefined, summary: 'Still bad' }).returning().get().id;
		const b = db.insert(issues).values({ ...issue(0), id: undefined, rule: 'device.offline', summary: 'Came back', state: 'resolved', resolvedAt: T }).returning().get().id;
		enqueue(db, issue(a, 'warning', { summary: 'Still bad' }), n(), { now: T, quiet: true, device: null });
		enqueue(db, issue(b, 'warning', { summary: 'Came back' }), n(), { now: T, quiet: true, device: null });
		enqueue(db, issue(b, 'warning', { summary: 'Came back' }), n('warning', 'resolved'), { now: T, quiet: true, device: null });
		foldHeld(db, T + 1);
		const all = rows(db);
		expect(all.slice(0, 3).map((r) => r.status)).toEqual(['sent', 'sent', 'sent']);
		expect(all.slice(3)).toMatchObject([{ channelId: ch, issueId: null, kind: 'digest', status: 'pending', nextAttemptAt: T + 1, dedupeKey: `digest:${ch}:${T + 1}`,
			message: { title: 'Overnight summary', fields: [{ name: 'Still open', value: '• Still bad' }, { name: 'Resolved overnight', value: '• Came back' }] } }]);
		foldHeld(db, T + 2); // nothing held: no-op
		expect(rows(db)).toHaveLength(4);
	});

	it('foldHeld keeps rows held when the digest key collides, and truncates long lists', () => {
		const { db, addChannel } = setup();
		const ch = addChannel();
		for (let i = 0; i < 40; i++) {
			const id = db.insert(issues).values({ ...issue(0), id: undefined, rule: `r${i}` as IssueRow['rule'], summary: `Open issue number ${i} ` + 'y'.repeat(40) }).returning().get().id;
			enqueue(db, issue(id), n(), { now: T, quiet: true, device: null });
		}
		db.insert(outbox).values({ channelId: ch, kind: 'digest', severity: 'info', message: {}, dedupeKey: `digest:${ch}:${T + 1}`, createdAt: T }).run();
		foldHeld(db, T + 1);
		expect(rows(db).filter((r) => r.status === 'held')).toHaveLength(40);
		foldHeld(db, T + 2);
		const digest = rows(db).at(-1)!.message as { fields: { name: string; value: string }[] };
		expect(digest.fields[0].value.length).toBeLessThanOrEqual(1024);
		expect(digest.fields[0].value).toMatch(/…and \d+ more$/);
	});

	it('sendTest posts directly and reports errors without throwing', async () => {
		const { db, addChannel } = setup();
		const id = addChannel();
		const ok = fakeFetch();
		expect(await sendTest(db, id, KEY, ok.fn)).toEqual({ ok: true });
		expect(ok.calls[0].url).toBe(HOOK);
		expect(rows(db)).toHaveLength(0);
		expect(await sendTest(db, id, KEY, fakeFetch([{ status: 404 }]).fn)).toMatchObject({ ok: false, error: expect.stringContaining('404') });
		expect(await sendTest(db, id, 'wrong', ok.fn)).toMatchObject({ ok: false });
		expect(await sendTest(db, 99, KEY, ok.fn)).toMatchObject({ ok: false });
	});
});
