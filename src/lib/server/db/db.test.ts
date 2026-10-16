import { describe, expect, it } from 'vitest';
import { openDb } from './index';
import { issues } from './schema';
import { getSettings, saveSettings } from '../settings';

const issue = (o: Partial<typeof issues.$inferInsert> = {}) => ({
	rule: 'device_offline',
	ieee: '0x01',
	severity: 'warning' as const,
	state: 'open' as const,
	openedAt: 1,
	updatedAt: 1,
	summary: 's',
	action: 'a',
	...o
});

describe('db', () => {
	it('opens in-memory db with all tables', () => {
		const db = openDb(':memory:');
		const rows = db.$client
			.prepare("select name from sqlite_master where type = 'table'")
			.all() as { name: string }[];
		const names = rows.map((r) => r.name);
		for (const t of ['devices', 'samples', 'events', 'issues', 'outbox', 'channels', 'settings', 'user', 'session', 'account', 'verification'])
			expect(names).toContain(t);
	});

	it('allows only one unresolved issue per rule and device', () => {
		const db = openDb(':memory:');
		const first = db.insert(issues).values(issue()).returning().get();
		expect(() => db.insert(issues).values(issue()).run()).toThrow();
		db.update(issues).set({ state: 'resolved' }).run();
		expect(() => db.insert(issues).values(issue()).run()).not.toThrow();
		expect(first.ieeeKey).toBe('0x01');
		db.insert(issues).values(issue({ rule: 'bridge_offline', ieee: null })).run();
		expect(() => db.insert(issues).values(issue({ rule: 'bridge_offline', ieee: null })).run()).toThrow();
	});

	it('settings round-trip', () => {
		const db = openDb(':memory:');
		saveSettings(db, { batteryLowPct: 30 });
		expect(getSettings(db).batteryLowPct).toBe(30);
		expect(getSettings(db).graceMin).toBe(15);
	});
});
