import { describe, expect, it } from 'vitest';
import fixture from './server/active/fixtures/networkmap-scan.json';
import { parentMap } from './server/active/parents';
import { mapLayout, type MapNode } from './map';

const types = fixture.types as Record<string, string>;
const nodes: MapNode[] = Object.entries(types).map(([ieee, type]) => ({ ieee, type, failed: fixture.scan.missing.includes(ieee) }));
const links = fixture.links.map((l) => ({ source: l.source, target: l.target, lqi: l.lqi, relationship: l.relationship }));
const parents = parentMap(links, (i) => types[i]);
const run = (n = nodes) => mapLayout(n, links, parents, 900, 600);

describe('mapLayout on the real scan', () => {
	const out = run();
	it('places every node', () => expect(out.nodes).toHaveLength(nodes.length));
	it('keeps node centres 8 px apart', () => {
		let min = Infinity;
		for (let i = 0; i < out.nodes.length; i++) for (let j = i + 1; j < out.nodes.length; j++) min = Math.min(min, Math.hypot(out.nodes[i].x - out.nodes[j].x, out.nodes[i].y - out.nodes[j].y));
		expect(min).toBeGreaterThanOrEqual(8);
	});
	it('draws no edge longer than 40 % of the width', () => {
		const at = new Map(out.nodes.map((n) => [n.ieee, n]));
		for (const e of out.edges) expect(Math.hypot(at.get(e.from)!.x - at.get(e.to)!.x, at.get(e.from)!.y - at.get(e.to)!.y)).toBeLessThan(360);
	});
	it('fills the frame', () => {
		const xs = out.nodes.map((n) => n.x), ys = out.nodes.map((n) => n.y);
		expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(630);
		expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(420);
	});
	it('is deterministic', () => expect(run([...nodes].reverse())).toEqual(out));
});
