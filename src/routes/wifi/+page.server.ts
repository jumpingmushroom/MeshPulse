import { and, desc, eq, gte } from 'drizzle-orm';
import { buildSeries, summarise } from '../../lib/chart';
import { wifiAps, wifiAreas, wifiSamples } from '../../lib/server/db/schema';
import { getRuntime } from '../../lib/server/runtime';
import { getSettings } from '../../lib/server/settings';
import { areaOf } from '../../lib/server/wifi/areas';
import { loadWifiSnapshot } from '../../lib/server/wifi/snapshot';
import { bandLayout } from '../../lib/wifi-band';
import type { PageServerLoad } from './$types';

const H = 3_600_000;
const SPARK = { w: 160, h: 32 };
const BAND_W = 840;

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const now = Date.now();
	const enabled = getSettings(db).wifiEnabled;
	const w = state.wifi;
	const base = { enabled, lastOkAt: w.lastOkAt, lastError: w.lastError, failures: w.failures, spark: SPARK, bandW: BAND_W };
	if (!enabled) return { ...base, zigbeeChannel: null, aps: [], band: bandLayout(null, [], BAND_W), maxRow: 0 };

	const snap = loadWifiSnapshot(db, state, now);
	const areas = db.select().from(wifiAreas).all();
	const devices = [...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator');
	const aps = snap.aps.map((s0) => {
		const a = { ...s0, overlaps: s0.overlaps && snap.zigbeeChannel !== null }; // held channel is for the rules, not for display
		const model = db.select({ m: wifiAps.model }).from(wifiAps).where(eq(wifiAps.mac, a.mac)).get()?.m ?? '';
		const rows = db.select().from(wifiSamples).where(and(eq(wifiSamples.mac, a.mac), gte(wifiSamples.ts, now - 24 * H))).orderBy(desc(wifiSamples.ts)).all();
		const cur = a.channel === null ? null : rows[0];
		const pts = rows.slice().reverse().map((s) => ({ t: s.ts, v: s.cuTotal }));
		const line = pts.length >= 2 ? buildSeries(pts, { ...SPARK, t0: now - 24 * H, t1: now, y0: 0, y1: 100 }, 15 * 60_000).line : '';
		const area = areas.find((x) => x.name === a.area);
		return {
			...a, model, line, label: summarise('Channel utilisation, 24 h', '%', pts.filter((p) => p.v !== null).map((p) => ({ t: p.t, v: p.v }))),
			own: cur && cur.cuSelfRx !== null && cur.cuSelfTx !== null ? cur.cuSelfRx + cur.cuSelfTx : null,
			clients: cur?.numSta ?? null,
			match: area?.match ?? null,
			zigbeeDevices: area ? devices.filter((d) => areaOf(d.friendlyName, [area]).length).length : null
		};
	});
	const placed = aps.filter((a) => a.channel !== null);
	const band = bandLayout(snap.zigbeeChannel, placed.map((a) => ({ name: a.name, channel: a.channel!, width: a.width, overlaps: a.overlaps })), BAND_W);
	return { ...base, zigbeeChannel: snap.zigbeeChannel, aps, band, maxRow: Math.max(-1, ...band.bars.map((b) => b.row)) };
};
