import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index';
import { scanLinks, scans } from '../db/schema';

export type Parents = Map<string, { parent: string; lqi: number }>;
type Link = { source: string; target: string; lqi: number; relationship: number };
const MAX_AGE = 48 * 3_600_000;

/** Links come from the target's neighbour table; `relationship` is the source's relation to the target (0 parent, 1 child). */
export function parentMap(links: Link[], typeOf: (ieee: string) => string | undefined): Parents {
	const explicit: Parents = new Map();
	const fallback: Parents = new Map();
	const best = (m: Parents, x: string, parent: string, lqi: number) => { if (lqi > (m.get(x)?.lqi ?? -1)) m.set(x, { parent, lqi }); };
	for (const l of links) {
		const lqi = l.lqi ?? 0;
		if (l.relationship === 1) best(explicit, l.source, l.target, lqi);
		else if (l.relationship === 0) best(explicit, l.target, l.source, lqi);
		else if (['Router', 'Coordinator'].includes(typeOf(l.target) ?? '')) best(fallback, l.source, l.target, lqi);
	}
	for (const [x, p] of fallback) if (!explicit.has(x)) explicit.set(x, p);
	return explicit;
}

/** Latest ok networkmap no older than 48 h, plus the ok one before it. Two indexed queries, one scan's links each. */
export function latestParents(db: Db, typeOf: (ieee: string) => string | undefined, now: number) {
	const [latest, prev] = db.select().from(scans).where(and(eq(scans.kind, 'networkmap'), eq(scans.status, 'ok')))
		.orderBy(desc(scans.startedAt), desc(scans.id)).limit(2).all();
	if (!latest || latest.startedAt < now - MAX_AGE) return null;
	const load = (id: number) => parentMap(db.select().from(scanLinks).where(eq(scanLinks.scanId, id)).all()
		.map((l) => ({ source: l.sourceIeee, target: l.targetIeee, lqi: l.lqi ?? 0, relationship: l.relationship ?? -1 })), typeOf);
	return { at: latest.startedAt, parents: load(latest.id), previous: prev ? load(prev.id) : null };
}
