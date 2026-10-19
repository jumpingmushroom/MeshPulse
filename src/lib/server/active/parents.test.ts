import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { scanLinks, scans } from '../db/schema';
import { latestParents, parentChanged, parentMap } from './parents';

const types: Record<string, string> = { R1: 'Router', R2: 'Router', C: 'Coordinator', E1: 'EndDevice', E2: 'EndDevice' };
const typeOf = (i: string) => types[i];
const H = 3_600_000;

describe('parentMap', () => {
	it('relationship 1 on (source=X, target=R) makes R the parent of X', () => {
		expect(parentMap([{ source: 'E1', target: 'R1', lqi: 100, relationship: 1 }], typeOf).get('E1')).toEqual({ parent: 'R1', lqi: 100 });
	});
	it('relationship 0 on (source=R, target=X) makes R the parent of X', () => {
		expect(parentMap([{ source: 'R2', target: 'E1', lqi: 80, relationship: 0 }], typeOf).get('E1')).toEqual({ parent: 'R2', lqi: 80 });
	});
	it('falls back to the highest-LQI router link', () => {
		const m = parentMap([
			{ source: 'E1', target: 'R1', lqi: 50, relationship: 2 },
			{ source: 'E1', target: 'R2', lqi: 120, relationship: 2 },
			{ source: 'E1', target: 'E2', lqi: 250, relationship: 2 }
		], typeOf);
		expect(m.get('E1')).toEqual({ parent: 'R2', lqi: 120 });
	});
	it('fallback ignores relationship 3, 4 and null', () => {
		const m = parentMap([
			{ source: 'E1', target: 'R1', lqi: 250, relationship: 3 },
			{ source: 'E1', target: 'R1', lqi: 250, relationship: 4 },
			{ source: 'E1', target: 'R1', lqi: 250, relationship: null as unknown as number }
		], typeOf);
		expect(m.has('E1')).toBe(false);
	});
	it('explicit beats a better-LQI fallback', () => {
		const m = parentMap([
			{ source: 'E1', target: 'R1', lqi: 50, relationship: 1 },
			{ source: 'E1', target: 'R2', lqi: 200, relationship: 2 }
		], typeOf);
		expect(m.get('E1')?.parent).toBe('R1');
	});
});

describe('parentChanged', () => {
	const m = (p: string) => new Map([['E1', { parent: p, lqi: 1 }]]);
	it('compares by ieee: same parent is unchanged, other parent is changed', () => {
		expect(parentChanged(m('R1'), m('R1'), 'E1')).toBe(false);
		expect(parentChanged(m('R2'), m('R1'), 'E1')).toBe(true);
	});
	it('a device absent from the previous scan, or no previous scan, is not changed', () => {
		expect(parentChanged(m('R1'), new Map(), 'E1')).toBe(false);
		expect(parentChanged(m('R1'), null, 'E1')).toBe(false);
	});
});

describe('latestParents', () => {
	const seed = (db: ReturnType<typeof openDb>, startedAt: number, target: string, status: 'ok' | 'failed' = 'ok') => {
		const { id } = db.insert(scans).values({ kind: 'networkmap', trigger: 'scheduled', startedAt, status }).returning({ id: scans.id }).get();
		db.insert(scanLinks).values({ scanId: id, sourceIeee: 'E1', targetIeee: target, lqi: 90, depth: 1, relationship: 1 }).run();
	};
	it('ignores a 49 h old scan', () => {
		const db = openDb(':memory:');
		seed(db, 1_000_000_000_000 - 49 * H, 'R1');
		expect(latestParents(db, typeOf, 1_000_000_000_000)).toBeNull();
	});
	it('returns the latest ok scan and the previous one', () => {
		const db = openDb(':memory:');
		const now = 1_000_000_000_000;
		seed(db, now - 30 * H, 'R1');
		seed(db, now - 5 * H, 'R2');
		seed(db, now - H, 'R1', 'failed');
		const r = latestParents(db, typeOf, now)!;
		expect(r.at).toBe(now - 5 * H);
		expect(r.parents.get('E1')?.parent).toBe('R2');
		expect(r.previous?.get('E1')?.parent).toBe('R1');
	});
});
