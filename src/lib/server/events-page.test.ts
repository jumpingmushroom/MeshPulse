import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { events } from './db/schema';
import { queryEvents } from './events-page';

const NOW = 100 * 86_400_000;
const known = new Set(['0xa', '0xb']);

function seed(n: number, ieee = '0xa', kind = 'availability', ts0 = NOW - 1000) {
	const db = openDb(':memory:');
	db.insert(events).values(Array.from({ length: n }, (_, i) => ({ ts: ts0 - i, ieee, kind, detail: {} }))).run();
	return db;
}
const q = (db: ReturnType<typeof openDb>, p: Record<string, string> = {}) => queryEvents(db, known, new URLSearchParams(p), NOW);

describe('queryEvents', () => {
	it('rejects unknown filters', () => {
		const db = seed(3);
		for (const p of [{ kind: 'nope' }, { device: '0xzz' }] as Record<string, string>[]) {
			const r = q(db, p);
			expect(r.rows).toEqual([]);
			expect(r.unknown).toBe(true);
		}
	});

	it('paginates at 100 with a next flag and bad pages fall back to 1', () => {
		const db = seed(150);
		const p1 = q(db);
		expect(p1.rows).toHaveLength(100);
		expect(p1.hasNext).toBe(true);
		const p2 = q(db, { page: '2' });
		expect(p2.rows).toHaveLength(50);
		expect(p2.hasNext).toBe(false);
		expect(q(db, { page: '0' }).page).toBe(1);
		expect(q(db, { page: 'x' }).page).toBe(1);
		const far = q(db, { page: '9' });
		expect(far.rows).toEqual([]);
		expect(far.page).toBe(9);
	});

	it('combines kind and device, and drops events older than 90 days', () => {
		const db = seed(2, '0xa', 'availability');
		db.insert(events).values([
			{ ts: NOW - 5, ieee: '0xb', kind: 'availability', detail: {} },
			{ ts: NOW - 6, ieee: '0xa', kind: 'battery_swap', detail: {} },
			{ ts: NOW - 91 * 86_400_000, ieee: '0xa', kind: 'availability', detail: {} }
		]).run();
		expect(q(db).rows).toHaveLength(4);
		expect(q(db, { kind: 'availability', device: '0xa' }).rows).toHaveLength(2);
		expect(q(db, { kind: 'battery_swap' }).rows).toHaveLength(1);
	});

	it('uses the ts index', () => {
		const db = seed(1);
		const plan = db.$client.prepare(
			'EXPLAIN QUERY PLAN SELECT * FROM events WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT 101 OFFSET 0'
		).all(0).map((r) => (r as { detail: string }).detail).join(' ');
		expect(plan).toMatch(/events_ts_idx/);
		expect(plan).not.toMatch(/SCAN events$/);
	});
});
