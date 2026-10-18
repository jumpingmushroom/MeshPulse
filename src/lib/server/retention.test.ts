import { describe, expect, it } from 'vitest';
import { openDb } from './db/index';
import { events, issues, outbox, samples, samplesHourly } from './db/schema';
import { prune } from './retention';

const D = 86_400_000;

describe('prune', () => {
	it('prunes by age', () => {
		const db = openDb(':memory:');
		const now = 100 * D;
		db.insert(samples).values([{ ieee: 'a', ts: now - 15 * D }, { ieee: 'a', ts: now - 13 * D }]).run();
		db.insert(events).values([{ ts: now - 91 * D, kind: 'x' }, { ts: now - 89 * D, kind: 'x' }]).run();
		const i = { severity: 'info' as const, state: 'resolved' as const, openedAt: 1, updatedAt: 1, summary: '', action: '' };
		db.insert(issues).values([
			{ ...i, rule: 'r1', resolvedAt: now - 91 * D },
			{ ...i, rule: 'r2', resolvedAt: now - 89 * D },
			{ ...i, rule: 'r3', state: 'open', resolvedAt: null }
		]).run();
		const o = { channelId: 1, kind: 'k', severity: 'info' as const, message: {}, createdAt: 1 };
		db.insert(outbox).values([
			{ ...o, dedupeKey: '1', status: 'sent', sentAt: now - 8 * D },
			{ ...o, dedupeKey: '2', status: 'sent', sentAt: now - 6 * D },
			{ ...o, dedupeKey: '3', status: 'pending', sentAt: null }
		]).run();

		prune(db, now);

		expect(db.select().from(samples).all().map((r) => r.ts)).toEqual([now - 13 * D]);
		expect(db.select().from(events).all().map((r) => r.ts)).toEqual([now - 89 * D]);
		expect(db.select().from(issues).all().map((r) => r.rule)).toEqual(['r2', 'r3']);
		expect(db.select().from(outbox).all().map((r) => r.dedupeKey)).toEqual(['2', '3']);
	});
});

it('prunes samples_hourly after 365 days', () => {
	const db = openDb(':memory:');
	const now = 1000 * D;
	db.insert(samplesHourly).values([{ ieee: 'a', hour: now - 366 * D, msgCount: 1 }, { ieee: 'a', hour: now - 364 * D, msgCount: 1 }]).run();
	prune(db, now);
	expect(db.select().from(samplesHourly).all().map((r) => r.hour)).toEqual([now - 364 * D]);
});
