import { describe, expect, it } from 'vitest';
import { openDb } from './db/index';
import { events, healthSamples, healthScores, issues, outbox, samples, samplesHourly, scanLinks, scans, wifiSamples } from './db/schema';
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
			{ ...o, dedupeKey: '3', status: 'pending', sentAt: null },
			{ ...o, dedupeKey: '4', status: 'failed', sentAt: null, createdAt: now - 8 * D },
			{ ...o, dedupeKey: '5', status: 'failed', sentAt: null, createdAt: now - 6 * D }
		]).run();

		prune(db, now);

		expect(db.select().from(samples).all().map((r) => r.ts)).toEqual([now - 13 * D]);
		expect(db.select().from(events).all().map((r) => r.ts)).toEqual([now - 89 * D]);
		expect(db.select().from(issues).all().map((r) => r.rule)).toEqual(['r2', 'r3']);
		expect(db.select().from(outbox).all().map((r) => r.dedupeKey)).toEqual(['2', '3', '5']);
	});
});

it('prunes samples_hourly after 365 days', () => {
	const db = openDb(':memory:');
	const now = 1000 * D;
	db.insert(samplesHourly).values([{ ieee: 'a', hour: now - 366 * D, msgCount: 1 }, { ieee: 'a', hour: now - 364 * D, msgCount: 1 }]).run();
	prune(db, now);
	expect(db.select().from(samplesHourly).all().map((r) => r.hour)).toEqual([now - 364 * D]);
});

it('prunes health_samples after 14 days and health_scores after 365', () => {
	const db = openDb(':memory:');
	const now = 1000 * D;
	const dev = { devices: {} };
	db.insert(healthSamples).values([{ ts: now - 15 * D, ...dev }, { ts: now - 13 * D, ...dev }]).run();
	db.insert(healthScores).values([{ ts: now - 366 * D, score: 1 }, { ts: now - 364 * D, score: 1 }]).run();
	prune(db, now);
	expect(db.select().from(healthSamples).all().map((r) => r.ts)).toEqual([now - 13 * D]);
	expect(db.select().from(healthScores).all().map((r) => r.ts)).toEqual([now - 364 * D]);
});

it('prunes scans and their links after 30 days', () => {
	const db = openDb(':memory:');
	const now = 1000 * D;
	const s = { kind: 'networkmap', trigger: 'scheduled' as const, status: 'ok' as const };
	db.insert(scans).values([{ id: 1, ...s, startedAt: now - 31 * D }, { id: 2, ...s, startedAt: now - 29 * D }]).run();
	db.insert(scanLinks).values([{ scanId: 1, sourceIeee: 'a', targetIeee: 'b' }, { scanId: 2, sourceIeee: 'a', targetIeee: 'b' }]).run();
	prune(db, now);
	expect(db.select().from(scans).all().map((r) => r.id)).toEqual([2]);
	expect(db.select().from(scanLinks).all().map((r) => r.scanId)).toEqual([2]);
});

it('keeps the latest ok coordinator check and networkmap (with links), however old', () => {
	const db = openDb(':memory:');
	const now = 1000 * D;
	const s = { trigger: 'scheduled' as const, status: 'ok' as const };
	db.insert(scans).values([
		{ id: 1, kind: 'networkmap', ...s, startedAt: now - 90 * D }, { id: 2, kind: 'networkmap', ...s, startedAt: now - 80 * D },
		{ id: 3, kind: 'networkmap', ...s, startedAt: now - 40 * D, status: 'failed' },
		{ id: 4, kind: 'coordinator_check', ...s, startedAt: now - 70 * D }, { id: 5, kind: 'coordinator_check', ...s, startedAt: now - 60 * D }
	]).run();
	db.insert(scanLinks).values([1, 2].map((scanId) => ({ scanId, sourceIeee: 'a', targetIeee: 'b' }))).run();
	prune(db, now);
	expect(db.select().from(scans).all().map((r) => r.id).sort()).toEqual([2, 5]);
	expect(db.select().from(scanLinks).all().map((r) => r.scanId)).toEqual([2]);
});

it('prunes wifi samples after 30 days', () => {
	const db = openDb(':memory:');
	const now = 1000 * D;
	const w = { mac: 'a', channel: 1, width: 20 };
	db.insert(wifiSamples).values([{ ...w, ts: now - 31 * D }, { ...w, ts: now - 29 * D }]).run();
	prune(db, now);
	expect(db.select().from(wifiSamples).all().map((r) => r.ts)).toEqual([now - 29 * D]);
});
