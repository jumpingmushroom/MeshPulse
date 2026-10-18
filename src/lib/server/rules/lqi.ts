import { baselineOf } from '../trends/history';
import { hourStart } from '../trends/rollup';
import { issueKey, type Finding, type RuleContext } from './types';

const H = 3_600_000;
const ACTION = 'Move the device closer to a router or add a router nearby';

/** Mean of the hourly LQI averages over the last `hours` hours; `n` = hours with data (avg is NaN when 0). */
function window(ctx: RuleContext, ieee: string, hours: number): { avg: number; n: number } {
	const from = hourStart(ctx.now) - hours * H;
	const avgs = (ctx.history.hourly.get(ieee) ?? []).filter((r) => r.hour >= from && r.lqiAvg !== null).map((r) => r.lqiAvg!);
	return { avg: avgs.reduce((a, b) => a + b, 0) / avgs.length, n: avgs.length };
}

const show = (n: number) => (Number.isNaN(n) ? 'unknown' : Math.round(n));

/**
 * Both rules open on the 24 h window, but not while the last 12 h already meet the stop condition
 * (that would resolve and reopen in a loop). Once open the last 12 h decide, falling back to 24 h;
 * no data in 24 h stops it (device.offline covers silent devices).
 */
function fires(open: boolean, day: { avg: number; n: number }, recent: { avg: number; n: number }, minHours: number,
	raises: (avg: number) => boolean, clears: (avg: number) => boolean): boolean {
	if (!open) return day.n >= minHours && raises(day.avg) && !(recent.n > 0 && clears(recent.avg));
	const judge = recent.n > 0 ? recent : day;
	return judge.n > 0 && !clears(judge.avg);
}

export function lqiWeak(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		if (d.type === 'Coordinator') continue;
		const day = window(ctx, d.ieee, 24);
		const recent = window(ctx, d.ieee, 12);
		if (!fires(ctx.open.has(issueKey('lqi.weak', d.ieee)), day, recent, s.lqiMinHours,
			(avg) => avg < s.lqiWeak, (avg) => avg > s.lqiWeakClear)) continue;
		out.push({
			rule: 'lqi.weak',
			ieee: d.ieee,
			severity: 'warning', // never critical: Z-Stack edge devices often report very low LQI while working
			summary: `Weak link to ${d.friendlyName} (LQI ${show(day.avg)})`,
			action: ACTION,
			evidence: { avg: day.avg, hours: day.n, avg12h: recent.avg, hours12h: recent.n, threshold: s.lqiWeak, clearAbove: s.lqiWeakClear }
		});
	}
	return out;
}

export function lqiDegrading(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	const weak = new Set(lqiWeak(ctx).map((f) => f.ieee)); // one problem, one issue: lqi.weak covers it
	for (const d of ctx.state.devices.values()) {
		const b = baselineOf(ctx.history, d.ieee, 'lqi_mean');
		if (d.type === 'Coordinator' || !b) continue;
		const day = window(ctx, d.ieee, 24);
		const recent = window(ctx, d.ieee, 12);
		const open = ctx.open.has(issueKey('lqi.degrading', d.ieee));
		if (!open && (b.days < s.baselineMinDays || weak.has(d.ieee) || ctx.open.has(issueKey('lqi.weak', d.ieee)))) continue;
		if (!fires(open, day, recent, s.lqiMinHours,
			(avg) => avg < b.value * (1 - s.lqiDegradePct / 100), (avg) => avg >= b.value * (1 - s.lqiRecoverPct / 100))) continue;
		out.push({
			rule: 'lqi.degrading',
			ieee: d.ieee,
			severity: 'warning',
			summary: `Link to ${d.friendlyName} degrading (LQI ${show(day.avg)}, normally ${show(b.value)})`,
			action: ACTION,
			evidence: { avg: day.avg, hours: day.n, avg12h: recent.avg, hours12h: recent.n, baseline: b.value, baselineDays: b.days,
				degradePct: s.lqiDegradePct, recoverPct: s.lqiRecoverPct }
		});
	}
	return out;
}
