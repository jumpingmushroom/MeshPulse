import { ne } from 'drizzle-orm';
import { issues } from '../../lib/server/db/schema';
import { getRuntime } from '../../lib/server/runtime';
import { deviceRows } from '../../lib/views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	return { rows: deviceRows(state, db.select({ ieee: issues.ieee }).from(issues).where(ne(issues.state, 'resolved')).all()) };
};
