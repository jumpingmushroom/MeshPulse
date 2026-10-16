import { getRuntime } from '../lib/server/runtime';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({ tz: getRuntime().config.tz, user: locals.user?.email ?? null, now: Date.now() });
