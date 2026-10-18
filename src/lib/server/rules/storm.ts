import { baselineOf } from '../trends/history';
import type { DeviceState } from '../types';
import { issueKey, openFor, restartStarts, type Finding, type RuleContext } from './types';

const MIN = 60_000;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const show = (n: number) => Math.round(n * 10) / 10;

/**
 * Whether the last `n` complete minutes all come after the latest MeshPulse start, broker reconnect and
 * restart-guard window: counters start empty and a restart makes every device report at once.
 */
function ready(ctx: RuleContext, n: number): boolean {
	const { startedAt, connectedAt } = ctx.state.monitor;
	const since = Math.max(startedAt, connectedAt ?? 0, ...restartStarts(ctx).map((s) => s + ctx.settings.graceMin * MIN));
	return Math.floor(ctx.now / MIN) * MIN - n * MIN >= since;
}

/** Opens on `stormSustainMin` minutes all above the limits; once open holds until `stormClearMin` minutes are all below the clear rate. */
function storming(ctx: RuleContext, ieee: string | null, open: boolean, raise: number, clear: number): boolean {
	const s = ctx.settings;
	const m = ctx.state.minutes;
	// no full clear window yet (restart): keep it open rather than resolve on empty counters
	if (open) return !ready(ctx, s.stormClearMin) || !m.perMinute(ieee, ctx.now, s.stormClearMin).every((n) => n < clear);
	return ready(ctx, s.stormSustainMin) && m.perMinute(ieee, ctx.now, s.stormSustainMin).every((n) => n > raise);
}

export function deviceStorm(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		const b = baselineOf(ctx.history, d.ieee, 'msg_per_min');
		const open = ctx.open.has(issueKey('device.storm', d.ieee));
		if (!b || (!open && b.days < s.baselineMinDays)) continue;
		if (!storming(ctx, d.ieee, open, Math.max(s.stormFactor * b.value, s.stormMinPerMin), s.stormClearFactor * b.value)) continue;
		const last = ctx.state.minutes.perMinute(d.ieee, ctx.now, s.stormSustainMin);
		out.push({
			rule: 'device.storm',
			ieee: d.ieee,
			severity: last.every((n) => n > s.stormCritPerMin) ? 'critical' : 'warning',
			summary: `${d.friendlyName} is flooding the network (${show(sum(last) / last.length)} msgs/min, normally ${show(b.value)})`,
			action: 'Check the device for a stuck sensor or a reporting-interval misconfiguration; power-cycle it',
			evidence: { perMin: last, baseline: b.value, baselineDays: b.days, factor: s.stormFactor, minPerMin: s.stormMinPerMin, critPerMin: s.stormCritPerMin }
		});
	}
	return out;
}

export function deviceDominant(ctx: RuleContext): Finding[] {
	const { now, settings: s, state } = ctx;
	const m = state.minutes;
	// one problem, one issue: a storming device is reported as device.storm
	const storm = new Set([...deviceStorm(ctx).map((f) => f.ieee!), ...openFor(ctx, 'device.storm')]);
	const skip = (d: DeviceState) => d.tags.includes('chatty') || d.tags.includes('ignore') || storm.has(d.ieee);
	const share = (ieee: string, min: number) => {
		const [n, total] = [sum(m.perMinute(ieee, now, min)), sum(m.perMinute(null, now, min))];
		return { n, total, share: total ? n / total : 0 };
	};
	const clears = (ieee: string) => ready(ctx, s.dominantClearMin) && share(ieee, s.dominantClearMin).share < s.dominantClearPct / 100;
	const found = (d: DeviceState): Finding => {
		const w = share(d.ieee, s.dominantWindowMin);
		return {
			rule: 'device.dominant',
			ieee: d.ieee,
			severity: 'warning',
			summary: `${d.friendlyName} sends ${Math.round(w.share * 100)}% of all network messages (${w.n} of ${w.total} in ${s.dominantWindowMin} min)`,
			action: 'Mark it as chatty if this is expected, otherwise check its reporting settings',
			evidence: { msgs: w.n, total: w.total, share: w.share, windowMin: s.dominantWindowMin, pct: s.dominantPct, clearPct: s.dominantClearPct }
		};
	};

	const out: Finding[] = [];
	const open = new Set(openFor(ctx, 'device.dominant'));
	for (const ieee of open) {
		const d = state.devices.get(ieee);
		if (d && !skip(d) && !clears(ieee)) out.push(found(d));
	}
	const top = ready(ctx, s.dominantWindowMin)
		? m.topShare(now, s.dominantWindowMin, new Set([...state.devices.values()].filter(skip).map((d) => d.ieee)))
		: null;
	const d = top && state.devices.get(top.ieee);
	// not while the clear window already says it's over (that would resolve and reopen in a loop)
	if (d && !open.has(d.ieee) && top.share > s.dominantPct / 100 && top.total >= s.dominantMinMsgs && !clears(d.ieee)) out.push(found(d));
	return out;
}

export function networkStorm(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const b = baselineOf(ctx.history, '', 'msg_per_min');
	const open = ctx.open.has(issueKey('network.storm', null));
	if (!b || (!open && b.days < s.baselineMinDays)) return [];
	if (!storming(ctx, null, open, s.netStormFactor * b.value, s.netStormClearFactor * b.value)) return [];
	const m = ctx.state.minutes;
	const rate = (ieee: string | null) => sum(m.perMinute(ieee, ctx.now, s.stormSustainMin)) / s.stormSustainMin;
	const top = [...ctx.state.devices.values()].map((d) => ({ name: d.friendlyName, perMin: show(rate(d.ieee)) }))
		.filter((t) => t.perMin > 0).sort((x, y) => y.perMin - x.perMin).slice(0, 5);
	return [{
		rule: 'network.storm',
		ieee: null,
		severity: 'critical',
		summary: `The network is flooded with messages (${show(rate(null))} msgs/min, normally ${show(b.value)})`,
		action: 'Check the top senders listed; a single misbehaving device is the usual cause',
		evidence: { perMin: m.perMinute(null, ctx.now, s.stormSustainMin), baseline: b.value, baselineDays: b.days, factor: s.netStormFactor, top }
	}];
}
