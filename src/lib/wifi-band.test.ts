import { describe, expect, it } from 'vitest';
import { bandLayout } from './wifi-band';

const ap = (name: string, channel: number, width = 20, overlaps = false) => ({ name, channel, width, overlaps });
const W = 840; // 10 px per MHz over 2400-2484 is 840

describe('bandLayout', () => {
	it('places a 20 MHz channel 1 bar over 2402-2422', () => {
		const { bars } = bandLayout(null, [ap('a', 1)], W);
		expect(bars[0].x).toBeCloseTo(20);
		expect(bars[0].width).toBeCloseTo(200);
	});
	it('puts Zigbee 11 at 2405', () => {
		expect(bandLayout(11, [], W).zigbee?.x).toBeCloseTo(50);
	});
	it('has no marker without a Zigbee channel', () => {
		expect(bandLayout(null, [], W).zigbee).toBeNull();
	});
	it('stacks same-channel APs in different rows and reuses a row when clear', () => {
		const { bars } = bandLayout(null, [ap('a', 1), ap('b', 1), ap('c', 11)], W);
		expect(bars[0].row).toBe(0);
		expect(bars[1].row).toBe(1);
		expect(bars[2].row).toBe(0);
	});
	it('keeps the input order and the overlap flag', () => {
		const { bars } = bandLayout(11, [ap('z', 11, 40, true), ap('y', 1)], W);
		expect(bars.map((b) => b.name)).toEqual(['z', 'y']);
		expect(bars[0].overlaps).toBe(true);
	});
	it('clamps channel 14 inside the band', () => {
		const b = bandLayout(null, [ap('a', 14)], W).bars[0];
		expect(b.x + b.width).toBeLessThanOrEqual(W);
	});
	it('spans 40 MHz as 40 MHz', () => {
		const b = bandLayout(null, [ap('a', 6, 40)], W).bars[0];
		expect(b.x).toBeCloseTo(370 - 200 + 0); // centre 2437 -> 370 px
		expect(b.width).toBeCloseTo(400);
	});
	it('places Zigbee 26 at 2480', () => {
		expect(bandLayout(26, [], W).zigbee?.x).toBeCloseTo(800);
	});
	it('puts touching bars in one row', () => {
		const { bars } = bandLayout(null, [ap('a', 1), ap('b', 5)], W); // 2402-2422 and 2422-2442
		expect(bars.map((b) => b.row)).toEqual([0, 0]);
	});
	it('never overlaps bars within a row', () => {
		const aps = [1, 3, 6, 6, 9, 11, 13, 2].map((c, i) => ap(`a${i}`, c, i % 2 ? 40 : 20));
		const { bars } = bandLayout(null, aps, W);
		for (const p of bars) for (const q of bars) if (p !== q && p.row === q.row) expect(p.x + p.width <= q.x + 1e-9 || q.x + q.width <= p.x + 1e-9).toBe(true);
	});
	it('places channel 14 at 2484 clamped to the band', () => {
		const b = bandLayout(null, [ap('a', 14)], W).bars[0];
		expect(b.x).toBeCloseTo(740);
		expect(b.x + b.width).toBeCloseTo(W);
	});
});
