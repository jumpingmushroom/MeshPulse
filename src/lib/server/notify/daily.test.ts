import { describe, expect, it } from 'vitest';
import { DOOR, HALL, LAMP, TEMP, ctx } from '../../../../tests/helpers/ctx';
import { openDb, type Db } from '../db';
import { channels, issues, outbox, settings } from '../db/schema';
import type { IssueRow } from '../issues/lifecycle';
import { sendDaily } from './daily';

const TZ = 'Europe/Oslo';
const Z = (s: string) => Date.parse(s);
const S = { summaryTime: '09:00' };
const NINE = Z('2026-11-03T08:00:00Z'); // 09:00 CET

const add = (db: Db, p: Partial<IssueRow>) => db.insert(issues).values({
	rule: 'device.offline', ieee: LAMP, severity: 'warning', state: 'open', openedAt: NINE - 86_400_000, updatedAt: NINE, resolvedAt: null,
	summary: 's', action: '', evidence: {}, lastNotifiedAt: NINE - 86_400_000, parentIssueId: null, ...p
}).run();
const channel = (db: Db, minSeverity: 'info' | 'warning' | 'critical' = 'info') =>
	db.insert(channels).values({ kind: 'discord', name: 'd', config: {}, minSeverity, enabled: true }).returning().get().id;
const sent = (db: Db) => db.select().from(outbox).all();

describe('sendDaily', () => {
	it('lists announced, open, top-level issues once a day at the summary time, criticals first', () => {
		const db = openDb(':memory:');
		const state = ctx().state;
		channel(db);
		add(db, { summary: 'Lamp offline' });
		add(db, { rule: 'battery.low', ieee: DOOR, severity: 'critical', summary: 'Door battery 5%' });
		add(db, { ieee: HALL, state: 'acknowledged', summary: 'accepted' });
		add(db, { ieee: TEMP, lastNotifiedAt: null, summary: 'still inside the notification delay' });
		add(db, { rule: 'lqi.weak', ieee: HALL, parentIssueId: 1, summary: 'child' });
		add(db, { rule: 'bridge.restarted', ieee: null, severity: 'info', summary: 'info' });
		add(db, { ieee: HALL, state: 'resolved', resolvedAt: NINE, summary: 'gone' });

		sendDaily(db, state, NINE - 60_000, TZ, false, S);
		expect(sent(db)).toEqual([]);
		sendDaily(db, state, NINE, TZ, false, S);
		expect(sent(db)).toHaveLength(1);
		expect(sent(db)[0]).toMatchObject({ kind: 'digest', severity: 'critical', dedupeKey: 'daily:2026-11-03:1', status: 'pending',
			message: { title: 'Still open: 2 issues', fields: [{ name: 'Critical (1)', value: '• Door battery 5%' }, { name: 'Warning (1)', value: '• Lamp offline' }] } });
		sendDaily(db, state, NINE + 3_600_000, TZ, false, S);
		expect(sent(db)).toHaveLength(1);
		expect(db.select().from(settings).all()).toContainEqual({ key: 'dailySummaryDay', value: '2026-11-03' });
	});

	it('waits out quiet hours, skips muted and ignored devices and channels above the severity, sends nothing when all is clear', () => {
		const db = openDb(':memory:');
		const state = ctx().state;
		channel(db, 'critical');
		add(db, { summary: 'warning only' });
		sendDaily(db, state, NINE, TZ, true, S);
		expect(db.select().from(settings).all()).toEqual([]); // quiet: not counted as sent
		state.devices.get(LAMP)!.tags = ['ignore'];
		add(db, { ieee: HALL, severity: 'critical', summary: 'muted' });
		state.devices.get(HALL)!.mutedUntil = NINE + 1;
		sendDaily(db, state, NINE, TZ, false, S);
		expect(sent(db)).toEqual([]);
	});
});
