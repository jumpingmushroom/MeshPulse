/** Initial editable state of the Settings area table, computed once (no effect writes what it reads). */
export function initAreaRows(areas: { name: string; match: string }[], aps: { mac: string; area: string | null }[]) {
	const rows = areas.map((a, i) => ({ id: `s${i}`, ...a }));
	return { rows, apSel: Object.fromEntries(aps.map((a) => [a.mac, rows.find((r) => r.name === a.area)?.id ?? ''])) as Record<string, string> };
}
