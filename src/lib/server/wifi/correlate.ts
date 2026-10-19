import { issueKey, type Finding, type RuleContext } from '../rules/types';

const HOUR = 3_600_000;
const RULES = new Set(['lqi.weak', 'lqi.degrading', 'route.failures', 'device.offline', 'device.flapping', 'network.route_errors', 'network.mass_offline']);
const hhmm = (ts: number, tz: string) => new Date(ts).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

/**
 * Adds Wi-Fi context to Zigbee findings that are about to open (keys not in `open`). Never changes severity;
 * the wording says Wi-Fi "may be involved". Wi-Fi off leaves findings as they are.
 */
export function withWifi(findings: Finding[], open: Set<string>, snap: RuleContext['wifi'], areaOfDevice: (ieee: string) => string[], busyPct: number, tz: string, now: number): Finding[] {
	if (!snap?.enabled) return findings;
	return findings.map((f) => {
		if (!RULES.has(f.rule) || open.has(issueKey(f.rule, f.ieee))) return f;
		if (!snap.fresh) return { ...f, evidence: { ...f.evidence, wifi: 'unavailable' } };
		const areas = f.ieee ? areaOfDevice(f.ieee) : [];
		// an AP without an area covers the whole network; each AP appears once whatever the number of matching areas
		const aps = snap.aps.filter((a) => !areas.length || a.area === null || areas.includes(a.area));
		if (!aps.length) return f;
		const zc = snap.zigbeeChannel ?? snap.lastZigbeeChannel;
		const lines = aps.filter((a) => a.overlaps && a.channel !== null).flatMap((a) => {
			const who = `${a.name} on channel ${a.channel} (overlaps Zigbee ${zc})`;
			return [
				...(a.cuMaxHour !== null && a.cuMaxHour >= busyPct ? [`${who} was ${a.cuMaxHour} % busy`] : []),
				...(a.changedAt !== null && now - a.changedAt <= HOUR ? [`${who} changed channel at ${hhmm(a.changedAt, tz)}`] : [])
			];
		});
		const wifi = aps.map((a) => ({ ap: a.name, channel: a.channel, overlaps: a.overlaps, cuTotal: a.cuTotal, cuMaxHour: a.cuMaxHour,
			changedAt: a.changedAt !== null && now - a.changedAt <= 24 * HOUR ? a.changedAt : null }));
		return { ...f, summary: lines.length ? `${f.summary} Wi-Fi may be involved: ${lines.join('; ')}` : f.summary, evidence: { ...f.evidence, wifi } };
	});
}
