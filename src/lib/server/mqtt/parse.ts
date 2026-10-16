/** Fixtures hand over parsed JSON; live MQTT hands over Buffers/strings. */
export function parseJson(payload: unknown): unknown {
	const s = Buffer.isBuffer(payload) ? payload.toString() : payload;
	if (typeof s !== 'string') return s;
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}

export function parseAvailability(p: unknown): 'online' | 'offline' | null {
	const v = typeof p === 'object' && p !== null ? (p as { state?: unknown }).state : p;
	if (typeof v !== 'string') return null;
	const s = v.trim().toLowerCase();
	return s === 'online' || s === 'offline' ? s : null;
}

export function parseLastSeen(v: unknown, fallback: number): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string') {
		const t = Date.parse(v);
		if (!Number.isNaN(t)) return t;
	}
	return fallback;
}

export function normaliseVoltage(v: unknown): number | null {
	if (typeof v !== 'number' || !Number.isFinite(v)) return null;
	return v > 100 ? v / 1000 : v;
}
