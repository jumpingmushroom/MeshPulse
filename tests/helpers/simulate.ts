import { evaluate, newIssue, type IssueRow, type Notify } from '../../src/lib/server/issues/lifecycle';
import { route } from '../../src/lib/server/mqtt/route';
import { evaluateRules, issueKey, type EventRow } from '../../src/lib/server/rules/index';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/server/settings';
import { createState, type AppState, type MqttMsg } from '../../src/lib/server/types';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/**
 * In-memory router → rules → lifecycle on fixture time, one run every 60 s from the first message.
 * The broker counts as connected from the start; `hooks` (keyed by fixture-time ms) change what fixtures can't express.
 */
export function simulate(msgs: MqttMsg[], opts: { until: number; settings?: Partial<Settings>; hooks?: Record<number, (s: AppState) => void> }) {
	const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
	const sorted = [...msgs].sort((a, b) => a.ts - b.ts);
	const start = sorted[0].ts;
	const state = createState(start);
	Object.assign(state.monitor, { connected: true, connectedAt: start });
	const timeline = [
		...sorted.map((m) => ({ ts: m.ts, run: () => route(state, m, 'zigbee2mqtt') })),
		...Object.entries(opts.hooks ?? {}).map(([ts, hook]) => ({ ts: Number(ts), run: () => (hook(state), []) }))
	].sort((a, b) => a.ts - b.ts);

	const events: EventRow[] = [];
	const issues: IssueRow[] = [];
	const notifies: (Notify & { at: number })[] = [];
	const counters = { seen: new Map<string, number>(), missing: new Map<string, number>() };
	let next = 0;
	for (let now = start + MIN; now <= opts.until; now += MIN) {
		for (; next < timeline.length && timeline[next].ts <= now; next++)
			for (const fx of timeline[next].run()) if (fx.kind === 'event') events.push({ id: events.length + 1, ...fx.event });
		const open = issues.filter((i) => i.state !== 'resolved');
		const recent = events.filter((e) => e.ts >= now - DAY);
		const findings = evaluateRules({ now, state, events: recent, settings, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))),
			history: { hourly: new Map(), baselines: new Map() } });
		const r = evaluate({ findings, issues: open, counters, settings, now, mutedUntil: (ieee) => state.devices.get(ieee)?.mutedUntil ?? null });
		for (const f of r.opens)
			issues.push({ id: issues.length + 1, ...newIssue(f, now, r.notify.some((n) => n.key === issueKey(f.rule, f.ieee))) });
		for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
		notifies.push(...r.notify.map((n) => ({ ...n, at: now })));
		state.monitor.lastRulesRunAt = now;
	}
	return { issues, notifies, events, state };
}
