import { DEFAULT_SETTINGS } from '../../src/lib/server/settings';
import { createState, type NewEvent } from '../../src/lib/server/types';
import { route } from '../../src/lib/server/mqtt/route';
import type { EventRow, RuleContext } from '../../src/lib/server/rules/index';
import { loadFixture } from './fixtures';

export const T = 1760000000000;
export const MIN = 60_000;
export const H = 60 * MIN;
export const NOW = T + 24 * H; // well past grace
export const COORD = '0x00124b0000000001';
export const LAMP = '0x00124b0000000002';
export const HALL = '0x00124b0000000003';
export const DOOR = '0x00124b0000000004';
export const TEMP = '0x00124b0000000005'; // coin cell, 3.0 V max

/** Healthy baseline: startup.jsonl routed, bridge live, broker connected, every device online. */
export function ctx(): RuleContext {
	const state = createState(T);
	for (const m of loadFixture('startup')) route(state, m, 'zigbee2mqtt');
	state.monitor.connected = true;
	state.bridge.lastLiveAt = NOW;
	for (const d of state.devices.values()) {
		d.availability = 'online';
		d.offlineSince = null;
		d.lastSeenAt = NOW;
	}
	return { now: NOW, state, events: [], settings: { ...DEFAULT_SETTINGS }, open: new Set(), history: { hourly: new Map(), baselines: new Map() } };
}

let nextId = 1;
export const ev = (e: NewEvent): EventRow => ({ id: nextId++, ...e });
export const flip = (ieee: string, ts: number, from: string | null, to: string) =>
	ev({ ts, ieee, kind: 'availability', detail: { from, to } });
export const dev = (c: RuleContext, ieee: string) => c.state.devices.get(ieee)!;
