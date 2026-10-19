import { describe, expect, it } from 'vitest';
import { mapLayout } from './map';

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
	it('marks weak links and survives parent cycles', () => {
		const nodes: N[] = [{ ieee: '0x00', type: 'Coordinator', failed: false }, { ieee: 'a', type: 'Router', failed: false }, { ieee: 'b', type: 'Router', failed: true }];
		const parents = new Map([['a', { parent: 'b', lqi: 59 }], ['b', { parent: 'a', lqi: 60 }]]);
		const out = mapLayout(nodes, parents, 900, 600);
		expect(out.edges).toEqual([{ from: 'a', to: 'b', weak: true }, { from: 'b', to: 'a', weak: false }]);
		expect(out.nodes.find((n) => n.ieee === 'b')!.failed).toBe(true);
	});
});
