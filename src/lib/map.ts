export type MapNode = { ieee: string; type: string; failed: boolean };
export type MapParents = Map<string, { parent: string; lqi: number }>;
export const WEAK_LQI = 60;

/** Radial layout: coordinator in the centre, routers on rings by depth, end devices fanned outward from their parent. Pure and deterministic. */
export function mapLayout(nodes: MapNode[], parents: MapParents, w: number, h: number) {
	const sorted = [...nodes].sort((a, b) => (a.ieee < b.ieee ? -1 : a.ieee > b.ieee ? 1 : 0));
	const ids = new Set(sorted.map((n) => n.ieee));
	const parentOf = (i: string) => { const p = parents.get(i)?.parent; return p && ids.has(p) ? p : undefined; };
	const coord = sorted.find((n) => n.type === 'Coordinator');
	const cx = w / 2, cy = h / 2, pos = new Map<string, { x: number; y: number }>();
	if (coord) pos.set(coord.ieee, { x: cx, y: cy });

	const depth = (i: string): number => {
		let d = 1;
		for (let p = parentOf(i), seen = new Set([i]); p && p !== coord?.ieee && !seen.has(p); p = parentOf(p)) { seen.add(p); d++; }
		return d;
	};
	// ring nodes: routers, plus end devices with no router parent (they hang off the coordinator)
	const onRing = (n: MapNode) => n.type !== 'Coordinator' && (n.type !== 'EndDevice' || sorted.find((m) => m.ieee === parentOf(n.ieee))?.type !== 'Router');
	const ring = sorted.filter(onRing).map((n) => ({ n, d: depth(n.ieee) }));
	const maxD = Math.max(1, ...ring.map((r) => r.d));
	const rx = w / 2 - 50, ry = h / 2 - 50;
	for (let d = 1; d <= maxD; d++) {
		const row = ring.filter((r) => r.d === d);
		row.forEach((r, k) => {
			const a = (k / row.length) * Math.PI * 2 + d * 0.35 - Math.PI / 2;
			pos.set(r.n.ieee, { x: cx + Math.cos(a) * rx * (d / maxD), y: cy + Math.sin(a) * ry * (d / maxD) });
		});
	}
	const kids = new Map<string, MapNode[]>();
	for (const n of sorted) if (!onRing(n) && n.type !== 'Coordinator') kids.set(parentOf(n.ieee)!, [...(kids.get(parentOf(n.ieee)!) ?? []), n]);
	for (const [p, list] of kids) {
		const pp = pos.get(p)!;
		const out = Math.atan2(pp.y - cy, pp.x - cx);
		list.forEach((n, i) => {
			const a = out + (i - (list.length - 1) / 2) * 0.5, r = 22 + (i % 2) * 10;
			pos.set(n.ieee, { x: pp.x + Math.cos(a) * r, y: pp.y + Math.sin(a) * r });
		});
	}
	return {
		nodes: sorted.filter((n) => pos.has(n.ieee)).map((n) => ({ ...n, ...pos.get(n.ieee)! })),
		edges: sorted.flatMap((n) => { const p = parentOf(n.ieee); return p ? [{ from: n.ieee, to: p, weak: parents.get(n.ieee)!.lqi < WEAK_LQI }] : []; })
	};
}
