// shortcut: in-memory per-process limiter, resets on restart; move to a shared store if MeshPulse ever runs multiple instances
export function createLimiter(max: number, windowMs: number) {
	const failures = new Map<string, number[]>();
	const recent = (key: string, now: number) => (failures.get(key) ?? []).filter((t) => now - t < windowMs);
	return {
		blocked: (key: string, now: number) => recent(key, now).length >= max,
		fail: (key: string, now: number) => {
			for (const k of failures.keys()) if (!recent(k, now).length) failures.delete(k); // forget IPs that stopped trying
			failures.set(key, [...recent(key, now), now]);
		},
		reset: (key: string) => void failures.delete(key),
		size: () => failures.size
	};
}

export const loginLimiter = createLimiter(10, 15 * 60_000);
