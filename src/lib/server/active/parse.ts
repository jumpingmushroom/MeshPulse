/** Missing router ieees from a `bridge/response/coordinator_check` data object. */
export function parseCoordinatorCheck(data: unknown): string[] {
	const list = (data as { missing_routers?: unknown } | null)?.missing_routers;
	if (!Array.isArray(list)) throw new Error('Unexpected coordinator_check response');
	return list.map((r) => {
		const ieee = (r as { ieee_address?: unknown } | null)?.ieee_address;
		if (typeof ieee !== 'string') throw new Error('Unexpected coordinator_check response');
		return ieee;
	});
}

export interface MapNode { ieee: string; type: string; failed: boolean }
export interface MapLink { source: string; target: string; lqi: number; depth: number; relationship: number }

/** Nodes and links from a `bridge/response/networkmap` data object (raw, routes: false). */
export function parseNetworkmap(data: unknown): { nodes: MapNode[]; links: MapLink[] } {
	const bad = () => new Error('Unexpected networkmap response');
	const v = (data as { value?: { nodes?: unknown; links?: unknown } } | null)?.value;
	if (!v || !Array.isArray(v.nodes) || !Array.isArray(v.links)) throw bad();
	const num = (x: unknown) => { if (typeof x !== 'number') throw bad(); return x; };
	const nodes = v.nodes.map((n: { ieeeAddr?: unknown; type?: unknown; failed?: unknown }) => {
		if (typeof n?.ieeeAddr !== 'string') throw bad();
		return { ieee: n.ieeeAddr, type: String(n.type ?? ''), failed: Array.isArray(n.failed) && n.failed.length > 0 };
	});
	const links = v.links.map((l: { source?: { ieeeAddr?: unknown }; target?: { ieeeAddr?: unknown }; lqi?: unknown; linkquality?: unknown; depth?: unknown; relationship?: unknown }) => {
		const source = l?.source?.ieeeAddr, target = l?.target?.ieeeAddr;
		if (typeof source !== 'string' || typeof target !== 'string') throw bad();
		return { source, target, lqi: num(l.lqi ?? l.linkquality), depth: num(l.depth), relationship: num(l.relationship) };
	});
	return { nodes, links };
}
