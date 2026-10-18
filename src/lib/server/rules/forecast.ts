import { baselineOf } from '../trends/history';
import { issueKey, type Finding, type RuleContext } from './types';

export function batteryForecast(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		const b = baselineOf(ctx.history, d.ieee, 'battery_days_left');
		if (d.powerSource !== 'Battery' || !b) continue;
		// hysteresis: open at warn days, hold until clear days
		if (b.value > (ctx.open.has(issueKey('battery.forecast', d.ieee)) ? s.forecastClearDays : s.forecastWarnDays)) continue;
		out.push({
			rule: 'battery.forecast',
			ieee: d.ieee,
			severity: 'info',
			summary: b.value < 0.5 ? `Battery in ${d.friendlyName} is at or below ${s.forecastTargetPct}%`
				: `Battery in ${d.friendlyName} runs out in about ${Math.round(b.value)} days`,
			action: 'Buy a replacement battery',
			evidence: { daysLeft: b.value, basedOnDays: b.days }
		});
	}
	return out;
}
