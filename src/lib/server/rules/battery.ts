import { baselineOf } from '../trends/history';
import type { DeviceState } from '../types';
import { deviceSilent } from './bridge-offline';
import { countRejoins, live, onePerRejoin } from './churn';
import { window } from './lqi';
import { inGrace, issueKey, type EventRow, type Finding, type RuleContext } from './types';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

/** Periods where availability changes come from an outage, not the device: bridge offline, real silences, and the settling after. */
function outages(ctx: RuleContext, evs: EventRow[]): [number, number][] {
	const s = ctx.settings;
	const g = s.graceMin * MIN;
	const out: [number, number][] = [];
	let off: number | null = null;
	for (const e of evs) {
		if (e.kind !== 'bridge_state') continue;
		if (e.detail.to === 'offline') off ??= e.ts;
		else if (off !== null) { out.push([off, e.ts + g]); off = null; }
	}
	if (off !== null || ctx.state.bridge.state === 'offline') out.push([off ?? -Infinity, Infinity]);
	const { silenceEndedAt, silenceMs, lastDeviceAt } = ctx.state.bridge;
	// shortcut: only the last real silence is known (state.bridge), upgrade to a silence event if older ones matter
	if (silenceEndedAt !== null && silenceMs >= s.bridgeSilenceMin * MIN) out.push([silenceEndedAt - silenceMs, silenceEndedAt + g]);
	if (deviceSilent(ctx)) out.push([lastDeviceAt ?? -Infinity, Infinity]);
	return out;
}

/** Signs in the last causingWindowH that a low battery is hurting `d`: [label, plain words], in a fixed order. */
function instabilities(ctx: RuleContext, d: DeviceState): [string, string][] {
	const { now, settings: s } = ctx;
	const all = ctx.longEvents ?? ctx.events;
	const since = now - s.causingWindowH * H;
	const down = outages(ctx, all);
	// restart guard as for churn, over the whole window
	const mine = live({ ...ctx, events: all }, ['device_announce', 'address_changed', 'availability', 'route_error'])
		.filter((e) => e.ieee === d.ieee && e.ts >= since && !down.some(([a, b]) => e.ts >= a && e.ts < b));
	const out: [string, string][] = [];
	const rejoins = onePerRejoin(mine.filter((e) => e.kind === 'device_announce' || e.kind === 'address_changed'));
	const announces = countRejoins(rejoins, since, 'device_announce');
	const addr = countRejoins(rejoins, since, 'address_changed');
	if (announces >= s.churnAnnounce) out.push(['rejoin churn', `rejoined ${announces} times in ${s.causingWindowH} h`]);
	else if (addr >= s.churnAddrChanges) out.push(['rejoin churn', `changed address ${addr} times in ${s.causingWindowH} h`]);
	// a change at the same time as many other devices is a mass outage (network.mass_offline), not this battery
	const mass = (ts: number) => new Set(all.filter((e) => e.kind === 'availability' && Math.abs(e.ts - ts) <= s.massOfflineWindowMin * MIN).map((e) => e.ieee)).size >= s.massOfflineDevices;
	const flaps = mine.filter((e) => e.kind === 'availability' && e.detail.from != null && !mass(e.ts)).length;
	if (flaps >= s.flappingCount) out.push(['flapping', `dropped off ${flaps} times in ${s.causingWindowH} h`]);
	// as device.offline: counted from reconnect / Z2M restart / the end of an outage (with its grace), never in grace or an outage
	// shortcut: silence and LQI are judged now, not over the window; a past gap is forgotten once the device reports again
	const seen = d.lastSeenAt === null ? null : Math.max(d.lastSeenAt, ctx.state.monitor.connectedAt ?? 0, ctx.state.bridge.restartedAt ?? 0,
		...down.map(([, b]) => (b === Infinity ? 0 : b)));
	// 2 × gap alone would call a 10-minute reporter unstable after 20 min: also at least silenceMinH
	if (seen !== null && d.typicalGapMs !== null && !inGrace(ctx) && !down.some(([, b]) => b === Infinity) &&
		now - seen > Math.max(2 * d.typicalGapMs, s.silenceMinH * H)) out.push(['silence', `silent for ${Math.round((now - seen) / H)} h`]);
	const b = baselineOf(ctx.history, d.ieee, 'lqi_mean');
	const day = window(ctx, d.ieee, 24);
	if (b && b.days >= s.baselineMinDays && day.n >= s.lqiMinHours && day.avg <= b.value * (1 - s.lqiDegradePct / 100))
		out.push(['link degrading', `link LQI ${Math.round(day.avg)}, normally ${Math.round(b.value)}`]);
	const fails = mine.filter((e) => e.kind === 'route_error' && e.detail.kind === 'command_failed').length;
	if (fails >= s.routeFailWarn) out.push(['message failures', `${fails} messages failed in ${s.causingWindowH} h`]);
	return out;
}

export function batteryLow(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		const pct = d.battery;
		const coin = d.powerSource === 'Battery' && d.maxVoltage !== null && d.maxVoltage <= s.coinCellMaxV;
		const v = coin ? d.voltage : null; // voltage only means something for coin cells
		const causing = d.powerSource === 'Battery' &&
			(d.batteryLow === true || (pct !== null && pct <= s.causingBatteryPct) || (v !== null && v <= s.voltageLow))
			? instabilities(ctx, d) : [];
		const bad = causing.length > 0 || (ctx.open.has(issueKey('battery.low', d.ieee))
			? d.batteryLow === true || (pct !== null && pct <= s.batteryClearPct) || (v !== null && v <= s.voltageClear) ||
				// batteryLow is not persisted: after a restart hold until the device reports again
				(d.powerSource === 'Battery' && d.batteryLow === null && pct === null && d.voltage === null)
			: d.batteryLow === true || (pct !== null && pct <= s.batteryLowPct) || (v !== null && v <= s.voltageLow));
		if (!bad) continue;
		const critical = causing.length > 0 || (pct !== null && pct <= s.batteryCriticalPct) || (v !== null && v <= s.voltageCritical);
		const readings = [pct !== null && `${pct}%`, d.voltage !== null && `${d.voltage} V`].filter(Boolean).join(' / ');
		out.push({
			rule: 'battery.low',
			ieee: d.ieee,
			severity: critical ? 'critical' : 'warning',
			summary: causing.length
				? `Replace battery in ${d.friendlyName}${readings ? `: ${readings}` : ''}, ${causing[0][1]}`
				: `Battery ${critical ? 'critical' : 'low'} in ${d.friendlyName}${readings ? `: ${readings}` : ''}`,
			action: 'Replace the battery',
			evidence: { level: critical ? 'battery.critical' : 'battery.low', battery: pct, voltage: d.voltage, batteryLow: d.batteryLow, coinCell: coin,
				...(causing.length && { causingIssues: causing.map(([label]) => label) }) }
		});
	}
	return out;
}

export function batteryStale(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		const gap = baselineOf(ctx.history, d.ieee, 'battery_report_gap_h');
		const last = baselineOf(ctx.history, d.ieee, 'battery_last_report');
		// only devices whose battery normally reports at least daily
		if (d.powerSource !== 'Battery' || !gap || !last || gap.value > 24 || ctx.now - last.value <= s.staleBatteryDays * D) continue;
		out.push({
			rule: 'battery.stale',
			ieee: d.ieee,
			severity: 'info',
			summary: `No battery report from ${d.friendlyName} for ${Math.floor((ctx.now - last.value) / D)} days`,
			action: 'Check the device and its battery',
			evidence: { lastReportAt: last.value, typicalGapH: gap.value }
		});
	}
	return out;
}
