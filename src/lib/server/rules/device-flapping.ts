import { inGrace, issueKey, type Finding, type RuleContext } from './index';

export function deviceFlapping(ctx: RuleContext): Finding[] {
	const { now, settings: s, events } = ctx;
	const graceMs = s.graceMin * 60_000;
	const restarts = events.filter((e) => e.kind === 'bridge_restart').map((e) => e.ts);
	if (ctx.state.bridge.restartedAt !== null) restarts.push(ctx.state.bridge.restartedAt);
	const counts = new Map<string, number>();
	for (const e of events) {
		if (e.kind !== 'availability' || !e.ieee || e.ts <= now - s.flappingWindowH * 3_600_000) continue;
		if (e.detail.from == null) continue; // first-ever availability is not a change
		if (restarts.some((r) => e.ts >= r && e.ts < r + graceMs)) continue;
		counts.set(e.ieee, (counts.get(e.ieee) ?? 0) + 1);
	}
	const grace = inGrace(ctx);
	const out: Finding[] = [];
	for (const [ieee, n] of counts) {
		const d = ctx.state.devices.get(ieee);
		if (!d) continue;
		const bad = ctx.open.has(issueKey('device.flapping', ieee)) ? n >= s.flappingClearBelow : !grace && n >= s.flappingCount;
		if (!bad) continue;
		out.push({
			rule: 'device.flapping',
			ieee,
			severity: 'warning',
			summary: `${d.friendlyName} keeps dropping off: ${n} availability changes in ${s.flappingWindowH} h`,
			action: 'Check the signal and the routers near the device',
			evidence: { changes: n, windowH: s.flappingWindowH }
		});
	}
	return out;
}
