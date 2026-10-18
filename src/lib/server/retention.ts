import { and, eq, lt } from 'drizzle-orm';
import type { Db } from './db/index';
import { events, issues, outbox, samples, samplesHourly } from './db/schema';

const DAY = 86_400_000;

export function prune(db: Db, now: number): void {
	db.delete(samples).where(lt(samples.ts, now - 14 * DAY)).run();
	db.delete(samplesHourly).where(lt(samplesHourly.hour, now - 365 * DAY)).run();
	db.delete(events).where(lt(events.ts, now - 90 * DAY)).run();
	db.delete(issues).where(and(eq(issues.state, 'resolved'), lt(issues.resolvedAt, now - 90 * DAY))).run();
	db.delete(outbox).where(and(eq(outbox.status, 'sent'), lt(outbox.sentAt, now - 7 * DAY))).run();
}
