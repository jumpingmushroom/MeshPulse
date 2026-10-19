import { randomUUID } from 'node:crypto';

export type RequestName = 'networkmap' | 'coordinator_check';
export interface Requester {
	request(name: RequestName, payload: object, timeoutMs: number): Promise<unknown>;
	onMessage(topic: string, payload: Buffer): void;
	busy(name: RequestName): boolean;
}

const NAMES: readonly string[] = ['networkmap', 'coordinator_check'];
type Pending = { name: RequestName; resolve: (d: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export function createRequester(publish: (topic: string, body: string) => Promise<void>, baseTopic: string): Requester {
	const pending = new Map<string, Pending>();
	const respPrefix = `${baseTopic}/bridge/response/`;
	return {
		request(name, payload, timeoutMs) {
			if (!NAMES.includes(name)) throw new Error(`request not allowed: ${name}`);
			return new Promise((resolve, reject) => {
				const transaction = randomUUID();
				const done = () => { clearTimeout(p.timer); pending.delete(transaction); };
				const p: Pending = {
					name,
					resolve: (d) => { done(); resolve(d); },
					reject: (e) => { done(); reject(e); },
					timer: setTimeout(() => p.reject(new Error('timeout')), timeoutMs)
				};
				pending.set(transaction, p);
				publish(`${baseTopic}/bridge/request/${name}`, JSON.stringify({ ...payload, transaction })).catch(() =>
					p.reject(new Error(`MQTT user needs publish on \`${baseTopic}/bridge/request/#\``))
				);
			});
		},
		onMessage(topic, payload) {
			if (!topic.startsWith(respPrefix)) return;
			try {
				const m = JSON.parse(payload.toString());
				const p = typeof m?.transaction === 'string' ? pending.get(m.transaction) : undefined;
				if (!p) return;
				if (m.status === 'error') p.reject(new Error(String(m.error ?? 'request failed')));
				else p.resolve(m.data);
			} catch {
				/* malformed response, ignore */
			}
		},
		busy: (name) => [...pending.values()].some((p) => p.name === name)
	};
}
