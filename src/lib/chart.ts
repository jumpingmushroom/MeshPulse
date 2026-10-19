// Pure SVG path builders for the server-rendered charts (no chart library).
export type Point = { t: number; v: number | null; lo?: number | null; hi?: number | null };
export type Box = { w: number; h: number; t0: number; t1: number; y0: number; y1: number };

const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const r = (n: number) => +n.toFixed(1);

/** Point → SVG coordinates; y is clamped to the box so out-of-range values stay on the plot. */
export function xy(box: Box, t: number, v: number): [number, number] {
	const x = (t - box.t0) / (box.t1 - box.t0 || 1) * box.w;
	const y = box.h - (v - box.y0) / (box.y1 - box.y0 || 1) * box.h;
	return [r(x), r(Math.min(box.h, Math.max(0, y)))];
}

export type Span = { from: number; to: number };

/** Runs of points where `has` holds, split where consecutive times are more than maxGapMs apart. */
function runs(points: Point[], has: (p: Point) => boolean, maxGapMs: number, breaks: Span[] = []): Point[][] {
	const out: Point[][] = [];
	let cur: Point[] = [];
	for (const p of points) {
		if (!ok(p.t) || !has(p)) { cur = []; continue; }
		if (cur.length && (p.t - cur[cur.length - 1].t > maxGapMs || breaks.some((b) => b.from < p.t && b.to > cur[cur.length - 1].t))) cur = [];
		if (!cur.length) out.push(cur);
		cur.push(p);
	}
	return out;
}

const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');

export function buildSeries(points: Point[], box: Box, maxGapMs: number, breaks: Span[] = []): { line: string; band: string; empty: boolean } {
	const lines = runs(points, (p) => ok(p.v), maxGapMs, breaks);
	const bands = runs(points, (p) => ok(p.lo) && ok(p.hi), maxGapMs, breaks);
	return {
		line: lines.map((s) => path(s.map((p) => xy(box, p.t, p.v!)))).join(''),
		band: bands.map((s) => path([...s.map((p) => xy(box, p.t, p.hi!)), ...s.reverse().map((p) => xy(box, p.t, p.lo!))]) + 'Z').join(''),
		empty: lines.length === 0
	};
}

/** Round tick values (1/2/5 × 10^k steps) between min and max inclusive. */
export function niceTicks(min: number, max: number, count: number, minStep = 0): number[] {
	if (!(max > min) || count < 1) return [min];
	const raw = (max - min) / count;
	const pow = 10 ** Math.floor(Math.log10(raw));
	const e = raw / pow;
	const step = Math.max(minStep, pow * (e >= 7.07 ? 10 : e >= 3.16 ? 5 : e >= 1.41 ? 2 : 1));
	const dp = Math.max(0, -Math.floor(Math.log10(step)) + 1);
	const ticks: number[] = [];
	for (let k = Math.ceil(min / step - 1e-9); k <= Math.floor(max / step + 1e-9); k++) ticks.push(+(k * step).toFixed(dp));
	return ticks;
}

/** y-range around the finite values, padded; [0, 1] when there are none. */
export function autoRange(values: (number | null)[]): [number, number] {
	const v = values.filter(ok);
	if (!v.length) return [0, 1];
	const [lo, hi] = [Math.min(...v), Math.max(...v)];
	const pad = Math.max((hi - lo) * 0.1, 0.05);
	return [+(lo - pad).toFixed(2), +(hi + pad).toFixed(2)];
}

/** Screen-reader text: latest, min and max of the finite values. */
export function summarise(title: string, unit: string, points: Point[]): string {
	const v = points.map((p) => p.v).filter(ok);
	if (!v.length) return `${title}: no data yet.`;
	const f = (n: number) => `${+n.toFixed(2)}${unit ? ` ${unit}` : ''}`;
	return `${title}: latest ${f(v[v.length - 1])}, lowest ${f(Math.min(...v))}, highest ${f(Math.max(...v))} over ${v.length} readings.`;
}

const HOUR = 3_600_000;

/** Hourly counts with missing hours as 0, from the first row (the device's first data) to lastHour. */
// shortcut: hours when MeshPulse itself was down also read as 0; track uptime if that misleads.
export function fillHours(rows: { t: number; v: number }[], lastHour: number): Point[] {
	if (!rows.length) return [];
	const byHour = new Map(rows.map((r) => [r.t, r.v]));
	const out: Point[] = [];
	for (let t = rows[0].t; t <= Math.max(lastHour, rows[rows.length - 1].t); t += HOUR) out.push({ t, v: byHour.get(t) ?? 0 });
	return out;
}

/** Battery trend path: x spans the points' own time range, y is a fixed 0-100 %. Empty with fewer than 2 points. */
export function batteryTrend(points: Point[], w: number, h: number, maxGapMs: number): string {
	const pts = points.filter((p) => ok(p.v));
	if (pts.length < 2) return '';
	return buildSeries(pts, { w, h, t0: pts[0].t, t1: pts[pts.length - 1].t, y0: 0, y1: 100 }, maxGapMs).line;
}
