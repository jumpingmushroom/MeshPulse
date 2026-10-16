import { issueKey, type Finding, type RuleContext } from './types';

export function batteryLow(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		const pct = d.battery;
		const coin = d.maxVoltage !== null && d.maxVoltage <= s.coinCellMaxV;
		const v = coin ? d.voltage : null; // voltage only means something for coin cells
		const bad = ctx.open.has(issueKey('battery.low', d.ieee))
			? d.batteryLow === true || (pct !== null && pct <= s.batteryClearPct) || (v !== null && v <= s.voltageClear)
			: d.batteryLow === true || (pct !== null && pct <= s.batteryLowPct) || (v !== null && v <= s.voltageLow);
		if (!bad) continue;
		const critical = (pct !== null && pct <= s.batteryCriticalPct) || (v !== null && v <= s.voltageCritical);
		const readings = [pct !== null && `${pct}%`, d.voltage !== null && `${d.voltage} V`].filter(Boolean).join(' / ');
		out.push({
			rule: 'battery.low',
			ieee: d.ieee,
			severity: critical ? 'critical' : 'warning',
			summary: `Battery ${critical ? 'critical' : 'low'} in ${d.friendlyName}${readings ? `: ${readings}` : ''}`,
			action: 'Replace the battery',
			evidence: { level: critical ? 'battery.critical' : 'battery.low', battery: pct, voltage: d.voltage, batteryLow: d.batteryLow, coinCell: coin }
		});
	}
	return out;
}
