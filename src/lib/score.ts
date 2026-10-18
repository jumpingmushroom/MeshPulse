import type { Status } from './views';
import type { Severity } from './server/types';

/** Network score at or above which the status can be green. */
export const GREEN = 85;
const COST: Record<Severity, number> = { critical: 25, warning: 8, info: 1 };
const score = (issues: { severity: Severity }[]) => Math.max(0, 100 - issues.reduce((n, i) => n + COST[i.severity], 0));

/** Per device: its own unresolved issues, children included. */
export const deviceScore = score;

/** Network: top-level issues only (one incident, one deduction). Green needs >= 85 and no critical; red is < 60 or any critical. */
export function networkScore(issues: { severity: Severity; parentIssueId: number | null }[]): { score: number; status: Status } {
	const top = issues.filter((i) => i.parentIssueId === null);
	const s = score(top);
	const status = s < 60 || top.some((i) => i.severity === 'critical') ? 'red' : s >= GREEN && !top.some((i) => i.severity === 'warning') ? 'green' : 'amber';
	return { score: s, status };
}
