import { json } from '@sveltejs/kit';
import { isHealthy } from '../../../lib/server/heartbeat';
import { getRuntime } from '../../../lib/server/runtime';

export function GET() {
	const { state } = getRuntime();
	const { monitor, bridge } = state;
	return json(
		{ mqtt: monitor.connected, lastMessageAt: bridge.lastLiveAt, lastRulesRunAt: monitor.lastRulesRunAt },
		{ status: isHealthy(monitor, Date.now()) ? 200 : 503 }
	);
}
