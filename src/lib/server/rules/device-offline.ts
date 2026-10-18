import { inGrace, issueKey, type Finding, type RuleContext } from './types';

const H = 3_600_000;

export function deviceOffline(ctx: RuleContext): Finding[] {
	const { now, settings: s } = ctx;
	const grace = inGrace(ctx);
	// after a real silence or a Z2M restart, Z2M marks devices offline until it hears from them again
	const { silenceEndedAt, silenceMs, restartedAt } = ctx.state.bridge;
	// a later short gap overwrites silenceMs/silenceEndedAt: that can only end this hold early, never re-arm it
	const resumedAt = silenceMs >= s.bridgeSilenceMin * 60_000 ? silenceEndedAt ?? 0 : 0;
	const settling = now < Math.max(resumedAt, restartedAt ?? 0) + s.graceMin * 60_000;
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		if (d.type === 'Coordinator') continue;
		const open = ctx.open.has(issueKey('device.offline', d.ieee));
		const threshold = d.typicalGapMs === null ? null
			: Math.min(Math.max(s.silenceMultiplier * d.typicalGapMs, s.silenceMinH * H), s.silenceMaxH * H);
		// grace only blocks new silence findings; an open one stops when the device is seen again
		// a new finding counts from reconnect / Z2M restart too: device state isn't replayed after an outage
		const since = open ? d.lastSeenAt
			: d.lastSeenAt === null ? null
			: Math.max(d.lastSeenAt, ctx.state.monitor.connectedAt ?? 0, ctx.state.bridge.restartedAt ?? 0);
		const silent = d.type !== 'Router' && threshold !== null && since !== null && now - since > threshold && (open || !grace);
		if (d.availability !== 'offline' && !silent) continue;
		const last = ctx.events.findLast((e) => e.kind === 'availability' && e.ieee === d.ieee);
		const offlineSince = d.offlineSince ?? (last?.detail.to === 'offline' ? last.ts : null) ?? d.lastSeenAt;
		const held = !open && settling;
		const offline = d.availability === 'offline' && !held;
		if (!offline && !silent) continue;
		out.push({
			rule: 'device.offline',
			ieee: d.ieee,
			severity: 'warning',
			summary: offline
				? `${d.friendlyName} is offline`
				: `${d.friendlyName} has been silent for ${Math.round((now - d.lastSeenAt!) / H)} h`,
			action: d.type === 'Router' ? 'Check power to the router' : 'Check the battery and that the device is in range',
			evidence: { availability: d.availability, offlineSince, lastSeenAt: d.lastSeenAt, typicalGapMs: d.typicalGapMs, thresholdMs: threshold }
		});
	}
	return out;
}
