import { getSettings } from '../settings';
import { runActive, type ActiveDeps } from './run';
import { due, lastDay } from './schedule';

export function startActive(deps: ActiveDeps): { stop(): void } {
	let running = false;
	const timer = setInterval(async () => {
		if (running) return; // a slow request must not make later ticks write skipped rows
		running = true;
		const now = Date.now();
		try {
			// the only scheduled path to a request: feature on and due
			if (getSettings(deps.db).activeCoordinatorCheck && due(now, '03:30', lastDay(deps.db, 'coordinator_check'), deps.config.tz))
				await runActive(deps, 'coordinator_check', 'scheduled', now);
			if (getSettings(deps.db).activeNetworkScan && due(now, '04:00', lastDay(deps.db, 'networkmap'), deps.config.tz))
				await runActive(deps, 'networkmap', 'scheduled', now);
		} catch (e) {
			console.error('active: scheduled run failed', e);
		} finally {
			running = false;
		}
	}, 60_000);
	return { stop: () => clearInterval(timer) };
}
