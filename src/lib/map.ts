export type MapNode = { ieee: string; type: string; failed: boolean };
export type MapParents = Map<string, { parent: string; lqi: number }>;
export const WEAK_LQI = 60;

const GAP = 12; // min centre distance for nodes packed on one arc
const SUB = 14; // radial step between sub-rings of end devices

/**
 * Radial tree: coordinator in the centre, routers on rings by depth, each subtree in an angular sector
 * proportional to its size, end devices on sub-rings inside their router's sector. Pure and deterministic.
 */
export function mapLayout(nodes: MapNode[], parents: MapParents, w: number, h: number) {
	const sorted = [...nodes].sort((a, b) => (a.ieee < b.ieee ? -1 : a.ieee > b.ieee ? 1 : 0));
	const byId = new Map(sorted.map((n) => [n.ieee, n]));
	const parentOf = (i: string) => { const p = parents.get(i)?.parent; return p && byId.has(p) ? p : undefined; };
	const coord = sorted.find((n) => n.type === 'Coordinator');
	const cx = w / 2, cy = h / 2, sx = Math.max(1, w / h);
	const pos = new Map<string, { x: number; y: number }>();
	if (coord) pos.set(coord.ieee, { x: cx, y: cy });

	// tree nodes: everything except the coordinator and end devices hanging off a router
	const ownEnds = (n: MapNode) => n.type === 'EndDevice' && byId.get(parentOf(n.ieee) ?? '')?.type === 'Router';
	const tree = sorted.filter((n) => n !== coord && !ownEnds(n));
	const ends = new Map<string, MapNode[]>();
	for (const n of sorted) if (ownEnds(n)) ends.set(parentOf(n.ieee)!, [...(ends.get(parentOf(n.ieee)!) ?? []), n]);

	// tree parent: a tree node's parent when it is one, else the root; cycles are broken at the first unreached node
	const root = coord?.ieee ?? '';
	const kids = new Map<string, MapNode[]>();
	const treeIds = new Set(tree.map((n) => n.ieee));
	const attach = (n: MapNode, p: string) => kids.set(p, [...(kids.get(p) ?? []), n]);
	const reached = new Set<string>();
	const walk = (p: string) => { for (const c of kids.get(p) ?? []) if (!reached.has(c.ieee)) { reached.add(c.ieee); walk(c.ieee); } };
	for (const n of tree) { const p = parentOf(n.ieee); attach(n, p && (p === root || treeIds.has(p)) ? p : root); }
	walk(root);
	for (const n of tree) if (!reached.has(n.ieee)) { reached.add(n.ieee); attach(n, root); walk(n.ieee); }

	const weight = new Map<string, number>();
	const size = (id: string, seen = new Set<string>()): number => {
		if (weight.has(id)) return weight.get(id)!;
		seen.add(id);
		const w0 = (id === root ? 0 : 1 + (ends.get(id)?.length ?? 0)) + (kids.get(id) ?? []).filter((c) => !seen.has(c.ieee)).reduce((a, c) => a + size(c.ieee, seen), 0);
		weight.set(id, w0);
		return w0;
	};
	size(root);

	// sectors per depth
	type Slot = { n: MapNode; a0: number; a1: number };
	const levels: Slot[][] = [];
	const place = (id: string, a0: number, a1: number, d: number, seen: Set<string>) => {
		let a = a0;
		const list = (kids.get(id) ?? []).filter((c) => !seen.has(c.ieee));
		const total = list.reduce((s, c) => s + weight.get(c.ieee)!, 0);
		for (const c of list) {
			seen.add(c.ieee);
			const span = ((a1 - a0) * weight.get(c.ieee)!) / total;
			(levels[d] ??= []).push({ n: c, a0: a, a1: a + span });
			place(c.ieee, a, a + span, d + 1, seen);
			a += span;
		}
	};
	place(root, -Math.PI / 2, (3 * Math.PI) / 2, 0, new Set());

	// ring radii: far enough for the narrowest sector (12 px apart) and for the end-device sub-rings of the ring inside
	const subRings = (s: Slot, r: number) => Math.ceil((ends.get(s.n.ieee)?.length ?? 0) / Math.max(1, Math.floor(((s.a1 - s.a0) * r) / GAP)));
	const radii: number[] = [], extra: number[] = [];
	let prev = 0;
	levels.forEach((lv, d) => {
		let r = Math.max(d === 0 ? 70 : prev + 55, GAP / Math.min(...lv.map((s) => s.a1 - s.a0)));
		extra[d] = Math.max(0, ...lv.map((s) => subRings(s, r)));
		if (d > 0) r += SUB * extra[d - 1];
		radii[d] = r;
		extra[d] = Math.max(0, ...lv.map((s) => subRings(s, r)));
		prev = r;
	});
	const avail = Math.min(w, h) / 2 - 24;
	const reach = prev + SUB * (extra[extra.length - 1] ?? 0);
	const k = reach > avail ? avail / reach : 1;
	const at = (r: number, a: number) => ({ x: cx + Math.cos(a) * r * k * sx, y: cy + Math.sin(a) * r * k });

	levels.forEach((lv, d) => {
		for (const s of lv) {
			pos.set(s.n.ieee, at(radii[d], (s.a0 + s.a1) / 2));
			let rest = ends.get(s.n.ieee) ?? [];
			for (let ring = 1; rest.length; ring++) {
				const cap = Math.max(1, Math.floor(((s.a1 - s.a0) * (radii[d] + SUB * ring)) / GAP));
				const row = rest.slice(0, cap);
				rest = rest.slice(cap);
				row.forEach((e, i) => pos.set(e.ieee, at(radii[d] + SUB * ring, s.a0 + ((i + 0.5) / row.length) * (s.a1 - s.a0))));
			}
		}
	});
	return {
		nodes: sorted.filter((n) => pos.has(n.ieee)).map((n) => ({ ...n, ...pos.get(n.ieee)! })),
		edges: sorted.flatMap((n) => { const p = parentOf(n.ieee); return p ? [{ from: n.ieee, to: p, weak: parents.get(n.ieee)!.lqi < WEAK_LQI }] : []; })
	};
}
