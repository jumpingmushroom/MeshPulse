import { and, desc, eq, ne } from 'drizzle-orm';
import { requestManualScan } from '../../lib/server/active/run';
import { parentMap } from '../../lib/server/active/parents';
import { scanLinks, scans } from '../../lib/server/db/schema';
import { NETWORK_SCAN_AT } from '../../lib/server/active/schedule';
import { getRuntime } from '../../lib/server/runtime';
import { getSettings } from '../../lib/server/settings';
import { mapLayout, placeLabels, type MapNode } from '../../lib/map';
import type { Actions, PageServerLoad } from './$types';

const W = 1100, H = 760;
const isScan = and(eq(scans.kind, 'networkmap'), ne(scans.status, 'skipped'));

export const load: PageServerLoad = () => {
	const { db, state, config } = getRuntime();
	const now = Date.now(), tz = config.tz;
	const enabled = getSettings(db).activeNetworkScan;
	const last = db.select().from(scans).where(isScan).orderBy(desc(scans.startedAt), desc(scans.id)).limit(1).get();
	const ok = db.select().from(scans).where(and(eq(scans.kind, 'networkmap'), eq(scans.status, 'ok'))).orderBy(desc(scans.startedAt), desc(scans.id)).limit(1).get();
	const failure = last && last.status === 'failed' ? { at: last.startedAt, reason: last.reason ?? 'unknown error' } : null;
	if (!ok) return { enabled, failure, now, tz, scanAt: NETWORK_SCAN_AT, scan: null };

	const links = db.select().from(scanLinks).where(eq(scanLinks.scanId, ok.id)).all();
	const dev = (i: string) => state.devices.get(i);
	const parents = parentMap(links.map((l) => ({ source: l.sourceIeee, target: l.targetIeee, lqi: l.lqi ?? 0, relationship: l.relationship ?? -1 })), (i) => dev(i)?.type);
	const missing = ok.missing ?? [];
	const ids = new Set([...links.flatMap((l) => [l.sourceIeee, l.targetIeee]), ...missing]);
	for (const d of state.devices.values()) if (d.type === 'Coordinator' && d.removedAt === null) ids.add(d.ieee);
	const nodes: MapNode[] = [...ids].map((ieee) => ({ ieee, type: dev(ieee)?.type ?? 'EndDevice', failed: missing.includes(ieee) }));
	const layout = mapLayout(nodes, links.map((l) => ({ source: l.sourceIeee, target: l.targetIeee, lqi: l.lqi ?? 0 })), parents, W, H);
	const name = (i: string) => dev(i)?.friendlyName ?? i;
	return {
		enabled, failure, now, tz, scanAt: NETWORK_SCAN_AT,
		scan: {
			at: ok.startedAt,
			nodes: layout.nodes.map((n) => ({ ...n, name: name(n.ieee) })),
			labels: placeLabels(layout.nodes.filter((n) => n.type === 'Coordinator' || n.failed).map((n) => ({ ieee: n.ieee, x: n.x, y: n.y, r: n.type === 'Coordinator' ? 14 : 9, text: name(n.ieee) }))),
			edges: layout.edges.map((e) => ({ ...e, name: name(e.from), parent: name(e.to) })),
			offline: layout.nodes.filter((n) => n.failed).map((n) => ({ ieee: n.ieee, name: name(n.ieee) }))
		}
	};
};

export const actions: Actions = {
	// POST only: a GET must never start a scan
	scan: async () => requestManualScan(getRuntime(), Date.now())
};
