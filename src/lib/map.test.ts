import { describe, expect, it } from 'vitest';
import { mapLayout as layout, placeLabels, type MapNode, type MapParents } from './map';

// synthetic meshes: one link per reported parent
const mapLayout = (nodes: MapNode[], parents: MapParents, w: number, h: number) =>
	layout(nodes, [...parents].map(([source, p]) => ({ source, target: p.parent, lqi: p.lqi })), parents, w, h);

type N = { ieee: string; type: string; failed: boolean };
function mesh(routers: number, ends: number) {
	const nodes: N[] = [{ ieee: '0x00', type: 'Coordinator', failed: false }];
	const parents = new Map<string, { parent: string; lqi: number }>();
	const ids: string[] = [];
	for (let i = 0; i < routers; i++) {
		const ieee = `0xr${String(i).padStart(3, '0')}`;
		nodes.push({ ieee, type: 'Router', failed: false });
		parents.set(ieee, { parent: i < 14 ? '0x00' : ids[i % 14], lqi: 40 + ((i * 13) % 200) });
		ids.push(ieee);
	}
	for (let i = 0; i < ends; i++) {
		const ieee = `0xe${String(i).padStart(3, '0')}`;
		nodes.push({ ieee, type: 'EndDevice', failed: false });
		parents.set(ieee, { parent: ids[(i * 7) % routers], lqi: 100 });
	}
	return { nodes, parents };
}

describe('mapLayout', () => {
	it('is deterministic whatever the input order', () => {
		const { nodes, parents } = mesh(10, 30);
		expect(mapLayout(nodes, parents, 900, 600)).toEqual(mapLayout([...nodes].reverse(), parents, 900, 600));
	});
	it('puts end devices nearer their parent than the centre', () => {
		const { nodes, parents } = mesh(10, 30);
		const out = mapLayout(nodes, parents, 900, 600);
		const at = new Map(out.nodes.map((n) => [n.ieee, n]));
		for (const n of out.nodes.filter((n) => n.type === 'EndDevice')) {
			const p = at.get(parents.get(n.ieee)!.parent)!, c = at.get('0x00')!;
			expect(Math.hypot(n.x - p.x, n.y - p.y)).toBeLessThan(Math.hypot(n.x - c.x, n.y - c.y));
		}
		expect(at.get('0x00')).toMatchObject({ x: 450, y: 300 });
	});
	it('keeps 140 nodes apart', () => {
		const { nodes, parents } = mesh(38, 101);
		const out = mapLayout(nodes, parents, 900, 600).nodes;
		expect(out).toHaveLength(140);
		let min = Infinity;
		for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) min = Math.min(min, Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y));
		expect(min).toBeGreaterThanOrEqual(8);
	});
	it('places nodes unreachable from the coordinator', () => {
		const nodes: N[] = [{ ieee: '0x00', type: 'Coordinator', failed: false }, { ieee: 'a', type: 'Router', failed: false }, { ieee: 'b', type: 'Router', failed: true }];
		const parents = new Map([['a', { parent: 'b', lqi: 59 }], ['b', { parent: 'a', lqi: 60 }]]);
		const out = mapLayout(nodes, parents, 900, 600);
		expect(out.edges).toEqual([]); // unreachable from the coordinator: placed, no edges
		expect(out.nodes).toHaveLength(3);
		expect(out.nodes.find((n) => n.ieee === 'b')!.failed).toBe(true);
	});

	it('keeps each depth-2 router angularly closest to its own parent', () => {
		const nodes: N[] = [{ ieee: '0x00', type: 'Coordinator', failed: false }];
		const parents = new Map<string, { parent: string; lqi: number }>();
		for (let i = 0; i < 12; i++) { nodes.push({ ieee: `0xa${String(i).padStart(2, '0')}`, type: 'Router', failed: false }); parents.set(`0xa${String(i).padStart(2, '0')}`, { parent: '0x00', lqi: 200 }); }
		for (let i = 0; i < 84; i++) { const ieee = `0xb${String(i).padStart(2, '0')}`; nodes.push({ ieee, type: 'Router', failed: false }); parents.set(ieee, { parent: `0xa${String((i * 5) % 12).padStart(2, '0')}`, lqi: 150 }); }
		const out = mapLayout(nodes, parents, 900, 600).nodes;
		const at = new Map(out.map((n) => [n.ieee, n]));
		const ang = (i: string) => Math.atan2(at.get(i)!.y - 300, (at.get(i)!.x - 450) / 1.5);
		const diff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
		const d1 = nodes.filter((n) => n.ieee.startsWith('0xa')).map((n) => n.ieee);
		for (const n of nodes.filter((n) => n.ieee.startsWith('0xb'))) {
			const own = parents.get(n.ieee)!.parent;
			for (const o of d1) if (o !== own) expect(diff(ang(n.ieee), ang(own))).toBeLessThan(diff(ang(n.ieee), ang(o)));
		}
	});
	it('keeps one router with 30 end devices clear of everything in a 140-node mesh', () => {
		const { nodes, parents } = mesh(38, 70);
		for (let i = 0; i < 30; i++) { const ieee = `0xz${String(i).padStart(3, '0')}`; nodes.push({ ieee, type: 'EndDevice', failed: false }); parents.set(ieee, { parent: '0xr020', lqi: 90 }); }
		const out = mapLayout(nodes, parents, 900, 600).nodes;
		expect(out).toHaveLength(139);
		let min = Infinity;
		for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) min = Math.min(min, Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y));
		expect(min).toBeGreaterThanOrEqual(8);
	});
});

describe('placeLabels', () => {
	const overlap = (a: { box: { x0: number; x1: number; y0: number; y1: number } }, b: typeof a) => a.box.x0 < b.box.x1 && a.box.x1 > b.box.x0 && a.box.y0 < b.box.y1 && a.box.y1 > b.box.y0;
	it('keeps placed labels from overlapping and skips what cannot be placed', () => {
		const items = Array.from({ length: 60 }, (_, i) => ({ ieee: String(i), x: 100 + (i % 3) * 2, y: 100, r: 7, text: 'Hall plug router' }));
		const out = placeLabels(items);
		const placed = out.filter((o) => o.placed);
		expect(placed.length).toBeGreaterThan(3);
		expect(placed.length).toBeLessThan(60);
		for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
	});
});

describe('mapLayout edges', () => {
	it('marks a tree edge weak under LQI 60', () => {
		const nodes: MapNode[] = [{ ieee: '0', type: 'Coordinator', failed: false }, { ieee: 'a', type: 'Router', failed: false }, { ieee: 'b', type: 'Router', failed: false }];
		const out = layout(nodes, [{ source: 'a', target: '0', lqi: 59 }, { source: 'b', target: '0', lqi: 60 }], new Map(), 900, 600);
		expect(out.edges).toEqual([{ from: 'a', to: '0', lqi: 59, weak: true }, { from: 'b', to: '0', lqi: 60, weak: false }]);
	});
});
