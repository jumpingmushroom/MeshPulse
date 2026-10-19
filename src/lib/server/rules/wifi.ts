import { freeChannels } from '../wifi/overlap';
import { issueKey, type Finding, type RuleContext } from './types';

const BUSY_FOR = 15;
const CLEAR_FOR = 30;

/** Wi-Fi issues key on `wifi:<mac>` in the ieee slot: they are not devices. */
export const wifiKey = (mac: string) => `wifi:${mac}`;

/** With the Zigbee channel missing (bridge/info not seen yet) only already-open issues are held, on the last known channel. */
const on = (ctx: RuleContext) => (ctx.wifi?.enabled && (ctx.wifi.zigbeeChannel ?? ctx.wifi.lastZigbeeChannel) !== null ? ctx.wifi : null);
const zigbee = (w: NonNullable<RuleContext['wifi']>) => (w.zigbeeChannel ?? w.lastZigbeeChannel)!;
const keep = (ctx: RuleContext, rule: string, mac: string) => ctx.wifi!.zigbeeChannel !== null || ctx.open.has(issueKey(rule, wifiKey(mac)));

export function wifiChannelOverlap(ctx: RuleContext): Finding[] {
	const w = on(ctx);
	if (!w) return [];
	const z = zigbee(w);
	return w.aps.filter((a) => a.overlaps && a.channel !== null && keep(ctx, 'wifi.channel_overlap', a.mac)).map((a) => ({
		rule: 'wifi.channel_overlap', ieee: wifiKey(a.mac), severity: 'warning',
		summary: `${a.name} uses Wi-Fi channel ${a.channel}, which overlaps Zigbee channel ${z}`,
		action: `Move the AP's 2.4 GHz radio to channel ${freeChannels(z).join(' or ')} in UniFi`,
		evidence: { ap: a.name, mac: a.mac, area: a.area, wifiChannel: a.channel, width: a.width, zigbeeChannel: z, cuTotal: a.cuTotal }
	}));
}

/** Fires after 15 min busy, holds until 30 min below the clear threshold (hysteresis lives here). */
export function wifiBusyAir(ctx: RuleContext): Finding[] {
	const w = on(ctx);
	if (!w) return [];
	const z = zigbee(w);
	return w.aps.filter((a) => a.overlaps && keep(ctx, 'wifi.busy_air', a.mac) && (ctx.open.has(issueKey('wifi.busy_air', wifiKey(a.mac))) ? a.clearFor < CLEAR_FOR : a.busyFor >= BUSY_FOR)).map((a) => ({
		rule: 'wifi.busy_air', ieee: wifiKey(a.mac), severity: 'info',
		summary: `${a.name} is busy on Wi-Fi channel ${a.channel} (${Math.round(a.cuTotal ?? 0)} % channel use), which overlaps Zigbee channel ${z}`,
		action: `Move the AP's 2.4 GHz radio to channel ${freeChannels(z).join(' or ')} in UniFi, or reduce its load`,
		evidence: { ap: a.name, mac: a.mac, area: a.area, wifiChannel: a.channel, zigbeeChannel: z, cuTotal: a.cuTotal, busyFor: a.busyFor }
	}));
}

export function wifiUnreachable(ctx: RuleContext): Finding[] {
	const w = ctx.wifi;
	if (!w?.enabled || w.failures < 3) return [];
	return [{
		rule: 'wifi.unreachable', ieee: null, severity: 'info',
		summary: 'UniFi is not reachable, so Wi-Fi checks are paused',
		action: 'Check the controller URL, account and network in Settings, Wi-Fi (UniFi)',
		evidence: { failures: w.failures, lastError: w.lastError }
	}];
}
