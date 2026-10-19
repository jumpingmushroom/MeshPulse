import { describe, expect, it } from 'vitest';
import { focusBox, neighbours, zoomAt } from './map';

const L = { w: 1100, h: 760, min: 1, max: 8 };
const base = { x: 0, y: 0, w: 1100, h: 760 };

describe('zoomAt', () => {
	it('keeps the point under the cursor fixed', () => {
		const v = zoomAt(base, 2, { x: 300, y: 200 }, L);
		expect(v.w).toBe(550);
		expect((300 - v.x) / v.w).toBeCloseTo(300 / 1100);
		expect((200 - v.y) / v.h).toBeCloseTo(200 / 760);
	});
	it('clamps to 1x and 8x', () => {
		expect(zoomAt(base, 0.5, { x: 5, y: 5 }, L)).toEqual(base);
		expect(zoomAt(zoomAt(base, 100, { x: 550, y: 380 }, L), 100, { x: 550, y: 380 }, L).w).toBeCloseTo(1100 / 8);
	});
	it('stays inside the map', () => {
		const v = zoomAt(base, 8, { x: 1100, y: 760 }, L);
		expect(v.x + v.w).toBeLessThanOrEqual(1100.0001);
		expect(v.y + v.h).toBeLessThanOrEqual(760.0001);
	});
});

describe('neighbours', () => {
	const edges = [{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }, { from: 'd', to: 'b' }];
	it('returns both parents and children', () => expect(neighbours(edges, 'a')).toEqual(new Set(['b', 'c'])));
	it('is empty for an unknown node', () => expect(neighbours(edges, 'z').size).toBe(0));
});

describe('focusBox', () => {
	it('centres on the node at the zoom', () => {
		expect(focusBox({ x: 550, y: 380 }, 3, 1100, 760)).toEqual({ x: 550 - 1100 / 6, y: 380 - 760 / 6, w: 1100 / 3, h: 760 / 3 });
	});
	it('clamps at the edges', () => {
		const v = focusBox({ x: 5, y: 755 }, 3, 1100, 760);
		expect(v.x).toBe(0);
		expect(v.y + v.h).toBeCloseTo(760);
	});
});
