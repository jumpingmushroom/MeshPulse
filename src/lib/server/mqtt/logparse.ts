export interface RouteError {
	kind: 'command_failed' | 'ping_failed';
	code: string | null;
	ieee: string | null;
	name: string | null;
	final: boolean;
	/** ping attempts in the cycle (n of i/n); null for publish failures */
	attempts: number | null;
}

const PUBLISH = /^Publish '(?:set|get)' '[^']+' to '(.+?)' failed: /;
const PING = /^Failed to ping '(.+?)' \(attempt (\d+)\/(\d+), /;
const IEEE = /ZCL command (0x[0-9a-f]{16})\/\d+ /;
const STATUS = /Data request failed with error: '([A-Z_]+)'/;
// congestion at the coordinator, or a sleepy end device not polling: not a routing failure
const NOT_ROUTING = ['MAC_CHANNEL_ACCESS_FAILURE', 'BUFFER_FULL', 'MAC_NO_RESOURCES', 'MAC_TRANSACTION_EXPIRED'];

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
	// a publish failing without a delivery code is an automation or converter error
	if ((pub && code === null) || (code && NOT_ROUTING.includes(code))) return null;
	return {
		kind: pub ? 'command_failed' : 'ping_failed',
		code,
		ieee: IEEE.exec(m)?.[1] ?? null,
		name: (pub ?? ping)![1],
		final: !ping || ping[2] === ping[3],
		attempts: ping ? Number(ping[3]) : null
	};
}
