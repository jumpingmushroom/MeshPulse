export type MapNode = { ieee: string; type: string; failed: boolean };
export type MapParents = Map<string, { parent: string; lqi: number }>;
export const WEAK_LQI = 60;

const GAP = 12; // min centre distance for nodes packed on one arc
const SUB = 14; // radial step between sub-rings of end devices

export type MapLink = { source: string; target: string; lqi: number };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Radial tree. Routers form a breadth-first tree from the coordinator over router links of any relationship
 * (Zigbee2MQTT's own depth and parent fields are unreliable): the ring is the hop count, the tree parent is the
 * highest-LQI neighbour one hop closer. End devices hang off their reported parent, else their best router.
 * Unreachable nodes go on an outer ring. Each subtree gets an angular sector proportional to its size. Pure and deterministic.
 */
export function mapLayout(nodes: MapNode[], links: MapLink[], parents: MapParents, w: number, h: number) {
	const sorted = [...nodes].sort((a, b) => cmp(a.ieee, b.ieee));
	const byId = new Map(sorted.map((n) => [n.ieee, n]));
	const coord = sorted.find((n) => n.type === 'Coordinator');
	const cx = w / 2, cy = h / 2;
	const pos = new Map<string, { x: number; y: number }>();
	if (coord) pos.set(coord.ieee, { x: cx, y: cy });
	const infra = (i: string) => ['Router', 'Coordinator'].includes(byId.get(i)?.type ?? '');

	// best LQI per neighbour pair
	const nb = new Map<string, Map<string, number>>();
	for (const l of links) {
		if (l.source === l.target || !byId.has(l.source) || !byId.has(l.target)) continue;
		for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) {
			const m = nb.get(a) ?? nb.set(a, new Map()).get(a)!;
			m.set(b, Math.max(m.get(b) ?? -1, l.lqi));
		}
	}
	// best parent among candidates: highest LQI, then lowest ieee
	const best = (id: string, ok: (o: string) => boolean) => {
		let pick: { p: string; lqi: number } | undefined;
		for (const [o, lqi] of [...(nb.get(id) ?? [])].sort((a, b) => cmp(a[0], b[0]))) if (ok(o) && (!pick || lqi > pick.lqi)) pick = { p: o, lqi };
		return pick;
	};

	const root = coord?.ieee ?? '';
	const ring = new Map<string, number>(); // hop count from the coordinator
	if (coord) {
		ring.set(root, 0);
		for (let frontier = [root]; frontier.length;) {
			const next: string[] = [];
			for (const id of frontier) for (const o of [...(nb.get(id)?.keys() ?? [])].sort(cmp)) if (infra(o) && !ring.has(o)) { ring.set(o, ring.get(id)! + 1); next.push(o); }
			frontier = next;
		}
	}
	const outer = Math.max(0, ...ring.values()) + 1;
	const treeParent = new Map<string, { p: string; lqi: number }>();
	const level = new Map<string, number>();
	for (const n of sorted) {
		if (n === coord || n.type === 'EndDevice') continue;
		const h0 = ring.get(n.ieee);
		const pick = h0 === undefined ? undefined : best(n.ieee, (o) => ring.get(o) === h0 - 1);
		if (pick) treeParent.set(n.ieee, pick);
		level.set(n.ieee, h0 ?? outer);
	}
	const ends = new Map<string, MapNode[]>();
	for (const n of sorted) {
		if (n.type !== 'EndDevice') continue;
		const rep = parents.get(n.ieee);
		const pick = rep && infra(rep.parent) ? { p: rep.parent, lqi: rep.lqi } : best(n.ieee, infra);
		if (!pick) { level.set(n.ieee, outer); continue; } // unreachable: outer ring, no edge
		treeParent.set(n.ieee, pick);
		if (byId.get(pick.p)!.type === 'Router' && treeParent.has(pick.p) ) ends.set(pick.p, [...(ends.get(pick.p) ?? []), n]);
		else if (byId.get(pick.p)!.type === 'Router') { level.set(n.ieee, outer); treeParent.delete(n.ieee); } // parent itself unreachable
		else level.set(n.ieee, 1);
	}
	const tree = sorted.filter((n) => level.has(n.ieee) && !(ends.get(treeParent.get(n.ieee)?.p ?? '')?.includes(n)));

	const kids = new Map<string, MapNode[]>();
	for (const n of tree) { const p = treeParent.get(n.ieee)?.p ?? root; kids.set(p, [...(kids.get(p) ?? []), n]); }

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
	const place = (id: string, a0: number, a1: number, seen: Set<string>) => {
		let a = a0;
		const list = (kids.get(id) ?? []).filter((c) => !seen.has(c.ieee));
		const total = list.reduce((s, c) => s + weight.get(c.ieee)!, 0);
		for (const c of list) {
			seen.add(c.ieee);
			const span = ((a1 - a0) * weight.get(c.ieee)!) / total;
			(levels[level.get(c.ieee)! - 1] ??= []).push({ n: c, a0: a, a1: a + span });
			place(c.ieee, a, a + span, seen);
			a += span;
		}
	};
	place(root, -Math.PI / 2, (3 * Math.PI) / 2, new Set());

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
	const k = avail / Math.max(reach, 1), sx = (w / 2 - 24) / avail; // fill the box; x stretches only ever widen gaps
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
	const edges = sorted.flatMap((n) => { const t = treeParent.get(n.ieee); return t && pos.has(n.ieee) && pos.has(t.p) ? [{ from: n.ieee, to: t.p, lqi: t.lqi, weak: t.lqi < WEAK_LQI }] : []; });
	const lqiOf = new Map(edges.map((e) => [e.from, e.lqi]));
	return { nodes: sorted.filter((n) => pos.has(n.ieee)).map((n) => ({ ...n, ...pos.get(n.ieee)!, lqi: lqiOf.get(n.ieee) ?? null })), edges };
}

/** Greedy label placement: first free spot around the node, trying right, left, above, below, then stepping down the right side. `placed` is false when no spot is free. */
export function placeLabels(items: { ieee: string; x: number; y: number; r: number; text: string }[]) {
	const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
	const hit = (b: (typeof boxes)[number]) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
	return items.map((it) => {
		const tw = it.text.length * 5.5, g = it.r + 4;
		const spots: { x: number; y: number; anchor: 'start' | 'end' | 'middle' }[] = [
			{ x: it.x + g, y: it.y + 3, anchor: 'start' }, { x: it.x - g, y: it.y + 3, anchor: 'end' },
			{ x: it.x, y: it.y - g, anchor: 'middle' }, { x: it.x, y: it.y + g + 8, anchor: 'middle' }];
		for (let i = 1; i < 12; i++) spots.push({ x: it.x + g, y: it.y + 3 + 12 * i, anchor: 'start' }, { x: it.x + g, y: it.y + 3 - 12 * i, anchor: 'start' });
		const box = (s: (typeof spots)[number]) => { const x0 = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - tw : s.x - tw / 2; return { x0, x1: x0 + tw, y0: s.y - 9, y1: s.y + 3 }; };
		const spot = spots.find((s) => !hit(box(s)));
		if (!spot) return { ieee: it.ieee, ...spots[0], box: box(spots[0]), placed: false };
		boxes.push(box(spot));
		return { ieee: it.ieee, ...spot, box: box(spot), placed: true };
	});
}

export type ViewBox = { x: number; y: number; w: number; h: number };
export const clampBox = (v: ViewBox, w: number, h: number): ViewBox => ({ ...v, x: Math.min(Math.max(v.x, 0), w - v.w), y: Math.min(Math.max(v.y, 0), h - v.h) });

/** New viewBox after zooming by `factor` around `point` (map coordinates); zoom clamped to limits.min..max, kept inside the map. */
export function zoomAt(vb: ViewBox, factor: number, point: { x: number; y: number }, limits: { w: number; h: number; min: number; max: number }): ViewBox {
	const zoom = Math.min(limits.max, Math.max(limits.min, (limits.w / vb.w) * factor));
	const w = limits.w / zoom, h = limits.h / zoom;
	return clampBox({ x: point.x - ((point.x - vb.x) / vb.w) * w, y: point.y - ((point.y - vb.y) / vb.h) * h, w, h }, limits.w, limits.h);
}

/** Ieees joined to `ieee` by a tree edge, either direction. */
export function neighbours(edges: { from: string; to: string }[], ieee: string): Set<string> {
	const out = new Set<string>();
	for (const e of edges) { if (e.from === ieee) out.add(e.to); else if (e.to === ieee) out.add(e.from); }
	return out;
}

/** viewBox of the given zoom centred on a node, kept inside the map. */
export function focusBox(node: { x: number; y: number }, zoom: number, w: number, h: number): ViewBox {
	return clampBox({ x: node.x - w / zoom / 2, y: node.y - h / zoom / 2, w: w / zoom, h: h / zoom }, w, h);
}
