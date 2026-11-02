import type { Status } from './views';
import type { Severity } from './server/types';

/** Network score at or above which the status can be green. */
export const GREEN = 85;
const COST: Record<Severity, number> = { critical: 25, warning: 8, info: 1 };
const score = (issues: { severity: Severity }[]) => Math.max(0, 100 - issues.reduce((n, i) => n + COST[i.severity], 0));
/** Share of a device lost to its worst issue: a mesh with every device critical scores 0, every device warning 50. */
const WEIGHT: Record<Severity, number> = { critical: 1, warning: 0.5, info: 0.1 };
export const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

/** Per device: its own unresolved issues, children included. */
export const deviceScore = score;

type ScoredIssue = { severity: Severity; parentIssueId: number | null; rule?: string; ieee?: string | null; state?: string };

/**
 * Network: top-level issues that are not acknowledged (one incident, one deduction; an acknowledged issue is accepted).
 * Network-wide issues cost 25/8/1 each; device issues cost the share of the `devices` watched devices they affect,
 * so a dozen warnings on a big mesh is not a dead network. Green needs >= 85 and no warning; red is < 60 or any critical.
 */
export function networkScore(issues: ScoredIssue[], devices: number): { score: number; status: Status } {
	// Wi-Fi issues stay listed and notified but are not Zigbee health
	const top = issues.filter((i) => i.parentIssueId === null && i.state !== 'acknowledged' && !i.rule?.startsWith('wifi.'));
	const worst = new Map<string, Severity>();
	for (const i of top) {
		if (!i.ieee) continue;
		const w = worst.get(i.ieee);
		if (!w || RANK[i.severity] > RANK[w]) worst.set(i.ieee, i.severity);
	}
	const share = [...worst.values()].reduce((n, s) => n + WEIGHT[s], 0) / Math.max(devices, worst.size, 1);
	const s = Math.max(0, Math.round(score(top.filter((i) => !i.ieee)) - 100 * share));
	const status = s < 60 || top.some((i) => i.severity === 'critical') ? 'red' : s >= GREEN && !top.some((i) => i.severity === 'warning') ? 'green' : 'amber';
	return { score: s, status };
}
