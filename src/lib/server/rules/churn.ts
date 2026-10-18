import { issueKey, restartGuard, type EventRow, type Finding, type RuleContext } from './types';

const MIN = 60_000;
const H = 60 * MIN;

/** Non-guarded events of `kinds`, ascending. */
const live = (ctx: RuleContext, kinds: string[]): EventRow[] => {
	const guarded = restartGuard(ctx);
	return ctx.events.filter((e) => kinds.includes(e.kind) && e.ieee !== null && !guarded(e.ts));
};

const byDevice = (evs: EventRow[]) => {
	const m = new Map<string, EventRow[]>();
	for (const e of evs) m.set(e.ieee!, [...(m.get(e.ieee!) ?? []), e]);
	return m;
};

export function rejoinChurn(ctx: RuleContext): Finding[] {
	const { now, settings: s } = ctx;
	const out: Finding[] = [];
	for (const [ieee, evs] of byDevice(live(ctx, ['device_announce', 'address_changed']))) {
		const d = ctx.state.devices.get(ieee);
		if (!d) continue;
		const count = (since: number, kind: string) =>
			evs.filter((e) => e.ts >= since && e.kind === kind).reduce((n, e) => n + (kind === 'address_changed' ? Number(e.detail.delta) || 1 : 1), 0);
		const since = now - s.churnWindowH * H;
		const announces = count(since, 'device_announce');
		const addressChanges = count(since, 'address_changed');
		// a rejoin with a new address shows as both an announce and an address change: count it once
		const last24h = Math.max(count(now - 24 * H, 'device_announce'), count(now - 24 * H, 'address_changed'));
		const bad = ctx.open.has(issueKey('device.rejoin_churn', ieee))
			? evs.at(-1)!.ts >= now - s.churnClearH * H
			: announces >= s.churnAnnounce || addressChanges >= s.churnAddrChanges;
		if (!bad) continue;
		out.push({
			rule: 'device.rejoin_churn',
			ieee,
			severity: last24h >= s.churnCritical ? 'critical' : 'warning',
			summary: `${d.friendlyName} keeps rejoining the network (${Math.max(announces, addressChanges)} rejoins in ${s.churnWindowH} h)`,
			action: "Check the device's power and its nearest router",
			evidence: { announces, addressChanges, windowH: s.churnWindowH, last24h }
		});
	}
	return out;
}

export function deviceLeave(ctx: RuleContext): Finding[] {
	const out: Finding[] = [];
	for (const [ieee, evs] of byDevice(live(ctx, ['device_leave', 'leave_count_up']))) {
		const d = ctx.state.devices.get(ieee);
		const leftAt = evs.at(-1)!.ts;
		if (!d || (d.lastSeenAt ?? 0) > leftAt) continue;
		out.push({
			rule: 'device.leave',
			ieee,
			severity: 'warning',
			summary: `${d.friendlyName} left the network`,
			action: 'Re-pair the device if it does not come back',
			evidence: { leftAt }
		});
	}
	return out;
}

export function networkChurn(ctx: RuleContext): Finding[] {
	const { now, settings: s } = ctx;
	const evs = live(ctx, ['device_announce']);
	const recent = [...new Set(evs.filter((e) => e.ts >= now - s.netChurnWindowMin * MIN).map((e) => e.ieee!))];
	const bad = ctx.open.has(issueKey('network.churn', null))
		? evs.some((e) => e.ts >= now - s.netChurnQuietH * H)
		: recent.length >= s.netChurnDevices;
	if (!bad) return [];
	return [{
		rule: 'network.churn',
		ieee: null,
		severity: 'warning',
		summary: `${recent.length} devices rejoined the network within ${s.netChurnWindowMin} min`,
		action: 'Check for a power cut or a router that restarted near these devices',
		evidence: { devices: recent.length, windowMin: s.netChurnWindowMin, names: recent.slice(0, 10).map((i) => ctx.state.devices.get(i)?.friendlyName ?? i) }
	}];
}

export function interviewFailed(ctx: RuleContext): Finding[] {
	const out: Finding[] = [];
	// not restart-guarded: a failed interview is a real problem whenever it happens
	const evs = ctx.events.filter((e) => e.kind === 'device_interview' && e.ieee !== null && (e.detail.status === 'failed' || e.detail.status === 'successful'));
	for (const [ieee, list] of byDevice(evs)) {
		const last = list.at(-1)!;
		if (last.detail.status !== 'failed') continue;
		const name = ctx.state.devices.get(ieee)?.friendlyName ?? (typeof last.detail.friendly_name === 'string' ? last.detail.friendly_name : ieee);
		out.push({
			rule: 'device.interview_failed',
			ieee,
			severity: 'warning',
			summary: `${name} could not be interviewed`,
			action: 'Re-pair the device or check its compatibility',
			evidence: { failedAt: last.ts }
		});
	}
	return out;
}
