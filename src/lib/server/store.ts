import { desc, eq } from 'drizzle-orm';
import type { Db } from './db';
import { devices, events, healthSamples, samples } from './db/schema';
import type { AppState, DeviceState, Effect } from './types';
import { FOREVER } from '../views';

// DeviceState.tags is string[]; the column is a { tag: true } object.
const tagsToDb = (tags: string[]) => Object.fromEntries(tags.map((t) => [t, true]));
const tagsFromDb = (t: Record<string, boolean | undefined> | null) =>
	Object.entries(t ?? {}).flatMap(([k, v]) => (v ? [k] : []));

export function loadDevices(db: Db, state: AppState): void {
	for (const r of db.select().from(devices).all()) {
		const s = db.select().from(samples).where(eq(samples.ieee, r.ieee)).orderBy(desc(samples.ts)).limit(1).get();
		const d: DeviceState = {
			ieee: r.ieee,
			friendlyName: r.friendlyName ?? r.ieee,
			type: (r.type as DeviceState['type']) ?? 'EndDevice',
			powerSource: r.powerSource,
			model: r.model,
			vendor: r.vendor,
			firmware: r.firmware,
			networkAddress: r.networkAddress,
			availability: r.availability as DeviceState['availability'],
			lastSeenAt: r.lastSeenAt,
			removedAt: r.removedAt,
			mutedUntil: r.mutedUntil,
			tags: tagsFromDb(r.tags),
			ignoreRules: r.ignoreRules ?? [],
			typicalGapMs: r.typicalGapMs,
			maxVoltage: r.maxVoltage,
			lqi: s?.lqi ?? null,
			battery: s?.battery ?? null,
			voltage: s?.voltage ?? null,
			batteryLow: r.batteryLow,
			batteryType: r.batteryType,
			batteryCells: r.batteryCells,
			recentSeen: [],
			lastSampleAt: s?.ts ?? null,
			offlineSince: null
		};
		state.devices.set(d.ieee, d);
		if (d.removedAt === null) state.byName.set(d.friendlyName, d.ieee);
	}
	state.lastHealth = db.select().from(healthSamples).orderBy(desc(healthSamples.ts)).limit(1).get()?.devices ?? null;
}

export function applyEffects(db: Db, effects: Effect[], dirty: Set<string>): void {
	db.transaction((tx) => {
		for (const e of effects) {
			if (e.kind === 'event') tx.insert(events).values(e.event).run();
			else if (e.kind === 'sample')
				tx.insert(samples).values({ ieee: e.ieee, ts: e.ts, lqi: e.lqi, battery: e.battery, voltage: e.voltage })
					.onConflictDoNothing().run();
			else if (e.kind === 'health')
				tx.insert(healthSamples).values({ ts: e.ts, uptimeSec: e.uptimeSec, mqttQueued: e.mqttQueued, devices: e.devices })
					.onConflictDoNothing().run();
			else dirty.add(e.ieee);
		}
	});
}

export function flushDevices(db: Db, state: AppState, dirty: Set<string>): void {
	db.transaction((tx) => {
		for (const ieee of dirty) {
			const d = state.devices.get(ieee);
			if (!d) continue;
			const v = {
				friendlyName: d.friendlyName, type: d.type, powerSource: d.powerSource, model: d.model,
				vendor: d.vendor, firmware: d.firmware, networkAddress: d.networkAddress,
				availability: d.availability, lastSeenAt: d.lastSeenAt, removedAt: d.removedAt,
				mutedUntil: d.mutedUntil, tags: tagsToDb(d.tags), ignoreRules: d.ignoreRules,
				typicalGapMs: d.typicalGapMs, maxVoltage: d.maxVoltage, batteryLow: d.batteryLow
			};
			// first_seen_at is insert-only: absent from the update set
			tx.insert(devices).values({ ieee, ...v, firstSeenAt: Date.now() }).onConflictDoUpdate({ target: devices.ieee, set: v }).run();
		}
	});
	dirty.clear();
}

/** Sets or clears a tag in memory (rules read it) and on the device row. */
export function setTag(db: Db, state: AppState, ieee: string, tag: 'ignore' | 'chatty' | 'rechargeable', on: boolean): boolean {
	const d = state.devices.get(ieee);
	if (!d) return false;
	d.tags = [...d.tags.filter((t) => t !== tag), ...(on ? [tag] : [])];
	db.update(devices).set({ tags: tagsToDb(d.tags) }).where(eq(devices.ieee, ieee)).run();
	return true;
}

/** Turns one rule off (on=true adds it to ignoreRules) or back on for a device, in memory and on the row. */
export function setIgnoredRule(db: Db, state: AppState, ieee: string, rule: string, on: boolean): boolean {
	const d = state.devices.get(ieee);
	if (!d) return false;
	d.ignoreRules = [...d.ignoreRules.filter((r) => r !== rule), ...(on ? [rule] : [])];
	db.update(devices).set({ ignoreRules: d.ignoreRules }).where(eq(devices.ieee, ieee)).run();
	return true;
}

/** Sets or clears the battery override in memory and on the device row (not part of flushDevices, like tags). */
export function setBatteryType(db: Db, state: AppState, ieee: string, type: string | null, cells: number | null): boolean {
	const d = state.devices.get(ieee);
	if (!d) return false;
	d.batteryType = type;
	d.batteryCells = cells;
	db.update(devices).set({ batteryType: type, batteryCells: cells }).where(eq(devices.ieee, ieee)).run();
	return true;
}

const H = 3_600_000;
const MUTE = new Map<string, number | null>([['1h', H], ['24h', 24 * H], ['7d', 168 * H], ['forever', FOREVER], ['unmute', null]]);

/** UI mute duration → devices.muted_until; undefined for an unknown duration. */
export function muteUntil(duration: string, now: number): number | null | undefined {
	const ms = MUTE.get(duration);
	return ms === undefined || ms === null || ms === FOREVER ? ms : now + ms;
}
