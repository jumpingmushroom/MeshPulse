import { eq, min, ne } from 'drizzle-orm';
import { baselines, issues, samplesHourly } from '../lib/server/db/schema';
import { checkPrereqs } from '../lib/server/prereqs';
import { getRuntime } from '../lib/server/runtime';
import { buildSeries, summarise } from '../lib/chart';
import { networkScore } from '../lib/score';
import { getSettings } from '../lib/server/settings';
import { loadWifiSnapshot } from '../lib/server/wifi/snapshot';
import { networkMsgPerMin } from '../lib/server/trends/rollup';
import { batteriesDue, banner, counters, setupNotice, learning, peakQuiet, formatDuration, sortIssues, wifiApName } from '../lib/views';
import type { PageServerLoad } from './$types';

const H = 3_600_000;
const SPARK = { w: 160, h: 32 };

export const load: PageServerLoad = () => {
	const { db, state, config } = getRuntime();
	const open = sortIssues(db.select().from(issues).where(ne(issues.state, 'resolved')).all());
	const ids = new Set(open.map((i) => i.id)); // a child whose parent is not open shows at top level
	const list = open.filter((i) => i.parentIssueId === null || !ids.has(i.parentIssueId));
	const now = Date.now();
	const msgs = networkMsgPerMin(db, now);
	const box = { ...SPARK, t0: now - 24 * H, t1: now, y0: 0, y1: Math.max(1, ...msgs.map((p) => p.v)) };
	const { bridge } = state;
	const info = bridge.info;
	const watched = [...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator');
	const name = (ieee: string | null) => (ieee && state.devices.get(ieee)?.friendlyName) || undefined;
	const due = batteriesDue(db.select({ ieee: baselines.ieee, days: baselines.value }).from(baselines).where(eq(baselines.metric, 'battery_days_left')).all(), state);
	const first = db.select({ h: min(samplesHourly.hour) }).from(samplesHourly).get()?.h ?? null;
	const w = state.wifi;
	const wifiSnap = getSettings(db).wifiEnabled ? loadWifiSnapshot(db, state, now) : null;
	// never "No overlap" without current data, and no overlap judgement while the Zigbee channel is unknown
	const wifiState = !wifiSnap ? null : w.failures > 0 ? 'failed' : w.lastOkAt === null ? 'none' : now - w.lastOkAt > 15 * 60_000 ? 'stale'
		: wifiSnap.zigbeeChannel === null ? 'unknown' : 'ok';
	return {
		wifi: wifiSnap && { state: wifiState!, zigbeeChannel: wifiSnap.zigbeeChannel, overlap: wifiSnap.aps.filter((a) => a.overlaps).length },
		...networkScore(open),
		setup: setupNotice({ connected: state.monitor.connected, connectedAt: state.monitor.connectedAt, lastError: state.monitor.lastError,
			bridgeSeen: bridge.state !== null || bridge.info !== null, mqttUrl: config.mqttUrl, baseTopic: config.baseTopic, now }),
		banner: banner(list),
		learning: learning(first, now),
		peakQuiet: peakQuiet(msgs, config.tz),
		offline: watched.filter((d) => d.availability === 'offline').length,
		unknown: watched.filter((d) => d.availability !== 'online' && d.availability !== 'offline').length,
		batteriesDue: { count: due.length, soonest: due[0] ?? null },
		topLevel: list.length,
		spark: { w: SPARK.w, h: SPARK.h, d: msgs.length >= 2 ? buildSeries(msgs, box, 3 * H).line : '', summary: summarise('Messages per minute, 24 h', '/min', msgs) },
		issues: list.map(({ id, severity, state, summary, action, rule, ieee, openedAt, evidence }) =>
			({ id, severity, state, summary, action, rule, ieee, deviceName: wifiApName(ieee, evidence) ?? name(ieee), openedAt,
				children: open.filter((c) => c.parentIssueId === id).map(({ id, summary, rule }) => ({ id, summary, rule })) })),
		lastUpdate: bridge.lastLiveAt,
		mqttConnected: state.monitor.connected,
		counters: counters(state),
		prereqs: checkPrereqs(info).filter((p) => !p.ok),
		bridge: {
			state: bridge.state,
			version: bridge.version ?? info?.version ?? null,
			uptime: bridge.lastUptimeSec === null ? null : formatDuration(bridge.lastUptimeSec * 1000),
			channel: info?.network?.channel ?? null,
			coordinator: info?.coordinator?.type ?? null
		}
	};
};
