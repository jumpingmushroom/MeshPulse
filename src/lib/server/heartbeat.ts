import type { Config } from './config';
import type { Db } from './db';
import { getSettings } from './settings';
import type { AppState, MonitorState } from './types';

export const isHealthy = (m: MonitorState, now: number): boolean =>
	m.connected && m.lastRulesRunAt !== null && now - m.lastRulesRunAt <= 120_000;

export async function heartbeatTick(
	{ state, url, fetch: fetchFn = fetch }: { state: AppState; url?: string; fetch?: typeof fetch },
	now: number
): Promise<'sent' | 'skipped'> {
	if (!url || !isHealthy(state.monitor, now)) return 'skipped';
	// the URL may carry a token, so log only the host
	const host = URL.canParse(url) ? new URL(url).host : '<invalid url>';
	try {
		const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
		if (res.ok) return 'sent';
		console.warn(`heartbeat: ${host} returned ${res.status}`);
	} catch (e) {
		console.warn(`heartbeat: request to ${host} failed`, (e as Error).name);
	}
	return 'skipped';
}

export function startHeartbeat({ state, db, config }: { state: AppState; db: Db; config: Config }): { stop(): void } {
	const timer = setInterval(() => {
		try {
			const url = getSettings(db).heartbeatUrl || config.heartbeatUrl;
			void heartbeatTick({ state, url }, Date.now()).catch(() => {});
		} catch (e) {
			console.error('heartbeat: tick failed', e);
		}
	}, 60_000);
	return { stop: () => clearInterval(timer) };
}
