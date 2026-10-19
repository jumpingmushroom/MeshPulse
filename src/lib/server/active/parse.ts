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
