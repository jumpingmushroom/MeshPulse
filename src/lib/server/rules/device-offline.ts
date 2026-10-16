import { inGrace, issueKey, type Finding, type RuleContext } from './types';

const H = 3_600_000;

export function deviceOffline(ctx: RuleContext): Finding[] {
	const { now, settings: s } = ctx;
	const grace = inGrace(ctx);
	const out: Finding[] = [];
	for (const d of ctx.state.devices.values()) {
		if (d.type === 'Coordinator') continue;
		const open = ctx.open.has(issueKey('device.offline', d.ieee));
		const threshold = d.typicalGapMs === null ? null
			: Math.min(Math.max(s.silenceMultiplier * d.typicalGapMs, s.silenceMinH * H), s.silenceMaxH * H);
		// grace only blocks new silence findings; an open one stops when the device is seen again
		const silent = d.type !== 'Router' && threshold !== null && d.lastSeenAt !== null &&
			now - d.lastSeenAt > threshold && (open || !grace);
		const offline = d.availability === 'offline';
		if (!offline && !silent) continue;
		const last = ctx.events.findLast((e) => e.kind === 'availability' && e.ieee === d.ieee);
		const offlineSince = d.offlineSince ?? (last?.detail.to === 'offline' ? last.ts : null) ?? d.lastSeenAt;
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
