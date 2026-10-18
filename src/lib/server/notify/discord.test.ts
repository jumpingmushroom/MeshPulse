import { describe, expect, it } from 'vitest';
import type { IssueRow } from '../issues/lifecycle';
import type { DeviceState } from '../types';
import { toMessage } from './channel';
import { toDiscordPayload, WEBHOOK_RE } from './discord';

const T = Date.parse('2026-10-16T10:00:00Z');
const issue = (p: Partial<IssueRow> = {}): IssueRow => ({
	id: 7, rule: 'battery.low', ieee: '0x1', severity: 'warning', state: 'open', openedAt: T, updatedAt: T, resolvedAt: null,
	summary: 'Battery low in Bad sensor', action: 'Replace the battery', evidence: {}, lastNotifiedAt: null, parentIssueId: null, ...p
});
const dev = { friendlyName: 'Bad sensor', lqi: 42, battery: 12, voltage: null, lastSeenAt: T } as DeviceState;

describe('discord', () => {
	it('critical open has red embed and @here when enabled', () => {
		const m = toMessage(issue({ severity: 'critical' }), 'open', dev);
		const p = toDiscordPayload(m, { mentionCritical: true });
		expect(p.content).toBe('@here');
		expect(p.embeds[0]).toMatchObject({ color: 0xe53935, title: 'Critical: Battery low in Bad sensor' });
		expect(toDiscordPayload(m, { mentionCritical: false }).content).toBeUndefined();
	});
	it('resolved is green, no mention', () => {
		const m = toMessage(issue({ severity: 'critical', state: 'resolved', evidence: { durationMs: (3 * 60 + 12) * 60_000 } }), 'resolved', dev);
		expect(m.title).toBe('Resolved: Battery low in Bad sensor');
		expect(m.summary).toContain('after 3 h 12 min');
		const p = toDiscordPayload(m, { mentionCritical: true });
		expect(p.content).toBeUndefined();
		expect(p.embeds[0]).toMatchObject({ color: 0x43a047 });
	});
	it('allowed_mentions only parses everyone when mentioning', () => {
		const crit = toMessage(issue({ severity: 'critical' }), 'escalate', dev);
		expect(toDiscordPayload(crit, { mentionCritical: true }).allowed_mentions).toEqual({ parse: ['everyone'] });
		expect(toDiscordPayload(toMessage(issue(), 'open', dev), { mentionCritical: true }).allowed_mentions).toEqual({ parse: [] });
	});
	it('links to PUBLIC_URL/issues/<id>', () => {
		const p = toDiscordPayload(toMessage(issue(), 'open', dev, 'https://mp.example/'), { mentionCritical: false });
		expect(p.embeds[0]).toMatchObject({ url: 'https://mp.example/issues/7' });
		expect(toMessage(issue(), 'open', dev).url).toBeUndefined();
	});
	it('has device fields, omitting unknown values, and the suggested action', () => {
		const m = toMessage(issue(), 'open', dev, undefined, 'Europe/Oslo');
		expect(m.fields).toEqual([
			{ name: 'Device', value: 'Bad sensor' },
			{ name: 'LQI', value: '42' },
			{ name: 'Battery', value: '12%' },
			{ name: 'Last seen', value: expect.stringContaining('12:00') }
		]);
		expect(toMessage(issue(), 'open', { ...dev, lqi: null, battery: 12, voltage: 2.9, lastSeenAt: null }).fields.map((f) => f.value)).toEqual(['Bad sensor', '12% / 2.9 V']);
		expect(toMessage(issue({ ieee: null }), 'open', null).fields).toEqual([]);
		const e = toDiscordPayload(toMessage(issue(), 'open', dev), { mentionCritical: false }).embeds[0] as { description: string; color: number };
		expect(e.description).toBe('Battery low in Bad sensor\n\n**Suggested action:** Replace the battery');
		expect(e.color).toBe(0xffb300);
	});
});

it('accepts only Discord webhook URLs', () => {
	expect(WEBHOOK_RE.test('https://discord.com/api/webhooks/1/abc')).toBe(true);
	expect(WEBHOOK_RE.test('https://discordapp.com/api/webhooks/1/abc')).toBe(true);
	for (const u of ['http://discord.com/api/webhooks/1/a', 'https://evil.com/api/webhooks/1/a', 'https://discord.com.evil.com/api/webhooks/1', 'https://discord.com/api/webhooks/'])
		expect(WEBHOOK_RE.test(u)).toBe(false);
});
