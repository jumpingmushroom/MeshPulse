import { eq } from 'drizzle-orm';
import { decrypt, encrypt } from '../crypto';
import type { Db } from '../db/index';
import { settings } from '../db/schema';

const KEY = 'wifiConfig';
export interface WifiConfig { url: string; site: string; user: string; password: string }

type Stored = WifiConfig; // password encrypted

const read = (db: Db): Stored | null => {
	const v = db.select().from(settings).where(eq(settings.key, KEY)).get()?.value as Partial<Stored> | undefined;
	return v && typeof v.url === 'string' && typeof v.password === 'string' ? { url: v.url, site: v.site ?? 'default', user: v.user ?? '', password: v.password } : null;
};

export function getWifiConfig(db: Db, secretKey: string): WifiConfig | null {
	const s = read(db);
	if (!s?.url || !s.user || !s.password) return null;
	try {
		return { ...s, password: decrypt(s.password, secretKey) };
	} catch {
		return null; // SECRET_KEY changed: treat as not configured, the user re-enters the password
	}
}

/** Non-secret fields for the page; the password never leaves the server. */
export function getWifiForm(db: Db): { url: string; site: string; user: string; passwordSet: boolean } {
	const s = read(db);
	return { url: s?.url ?? '', site: s?.site ?? 'default', user: s?.user ?? '', passwordSet: !!s?.password };
}

/** An empty password keeps the stored one. */
export function saveWifiConfig(db: Db, secretKey: string, input: { url: string; site: string; user: string; password?: string }): void {
	const password = input.password ? encrypt(input.password, secretKey) : (read(db)?.password ?? '');
	const value: Stored = { url: input.url, site: input.site, user: input.user, password };
	db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}
