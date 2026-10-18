export interface RouteError {
	kind: 'command_failed' | 'ping_failed';
	code: string | null;
	ieee: string | null;
	name: string | null;
	final: boolean;
}

const PUBLISH = /^Publish '(?:set|get)' '[^']+' to '(.+?)' failed: /;
const PING = /^Failed to ping '(.+?)' \(attempt (\d+)\/(\d+), /;
const IEEE = /ZCL command (0x[0-9a-f]{16})\/\d+ /;
const STATUS = /Data request failed with error: '([A-Z_]+)'/;

/** Route/delivery failure from a Z2M 2.x (Z-Stack) `bridge/logging` payload, else null. Patterns: docs/superpowers/research/2026-10-18-z2m-route-errors.md */
export function parseRouteError(payload: unknown): RouteError | null {
	const raw = typeof payload === 'object' && payload !== null ? (payload as { message?: unknown }).message : null;
	// MQTT publish echoes carry device payloads that may contain the same words
	if (typeof raw !== 'string' || raw.startsWith('z2m:mqtt:')) return null;
	const m = raw.replace(/^z2m: /, ''); // some setups prefix the namespace
	const pub = PUBLISH.exec(m);
	const ping = pub ? null : PING.exec(m);
	if (!pub && !ping) return null;
	const code = STATUS.exec(m)?.[1] ?? (/Timeout after \d+ms/.test(m) ? 'TIMEOUT' : null);
	return {
		kind: pub ? 'command_failed' : 'ping_failed',
		code,
		ieee: IEEE.exec(m)?.[1] ?? null,
		name: (pub ?? ping)![1],
		final: !ping || ping[2] === ping[3]
	};
}
