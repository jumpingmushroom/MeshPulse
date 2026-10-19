import { getSettings } from '../settings';
import { runActive, type ActiveDeps } from './run';
import { due, lastDay } from './schedule';

export function startActive(deps: ActiveDeps): { stop(): void } {
	const timer = setInterval(async () => {
		const now = Date.now();
		try {
			// the only scheduled path to a request: feature on and due
			if (getSettings(deps.db).activeCoordinatorCheck && due(now, '03:30', lastDay(deps.db, 'coordinator_check'), deps.config.tz))
				await runActive(deps, 'coordinator_check', 'scheduled', now);
		} catch (e) {
			console.error('active: coordinator check failed', e);
		}
	}, 60_000);
	return { stop: () => clearInterval(timer) };
}
