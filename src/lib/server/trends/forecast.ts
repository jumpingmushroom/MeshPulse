const D = 86_400_000;

/** Days from `now` until the least-squares battery line reaches `targetPct`; null without a falling trend over `minDays` or beyond a year. */
export function forecastDaysLeft(points: { t: number; battery: number }[], now: number, targetPct: number, minDays: number): number | null {
	if (points.length < 2) return null;
	const ts = points.map((p) => p.t);
	if ((Math.max(...ts) - Math.min(...ts)) / D < minDays) return null;
	const n = points.length;
	const mt = ts.reduce((a, b) => a + b, 0) / n;
	const mb = points.reduce((a, p) => a + p.battery, 0) / n;
	const sxx = points.reduce((a, p) => a + (p.t - mt) ** 2, 0);
	const slope = points.reduce((a, p) => a + (p.t - mt) * (p.battery - mb), 0) / sxx; // % per ms
	if (!(slope < 0)) return null;
	const now_ = mb + slope * (now - mt);
	const days = Math.max(0, (now_ - targetPct) / -slope / D);
	return days > 365 ? null : days; // a nearly flat line (or float noise) is no forecast
}
