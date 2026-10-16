import type { Settings } from '../settings';

type Quiet = Pick<Settings, 'quietEnabled' | 'quietStart' | 'quietEnd'>;

const minutes = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
};

export function isQuietHours(now: number, settings: Quiet, tz: string): boolean {
	if (!settings.quietEnabled) return false;
	const local = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
	const m = minutes(local);
	const start = minutes(settings.quietStart);
	const end = minutes(settings.quietEnd);
	return start <= end ? m >= start && m < end : m >= start || m < end; // window may wrap midnight
}

export const quietHoursEnded = (prev: number, now: number, settings: Quiet, tz: string) =>
	isQuietHours(prev, settings, tz) && !isQuietHours(now, settings, tz);
