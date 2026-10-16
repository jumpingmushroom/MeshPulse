import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { encrypt } from '../../lib/server/crypto';
import { channels, outbox } from '../../lib/server/db/schema';
import type { Message } from '../../lib/server/notify/channel';
import { WEBHOOK_RE } from '../../lib/server/notify/discord';
import { sendTest } from '../../lib/server/notify/outbox';
import { checkPrereqs } from '../../lib/server/prereqs';
import { getRuntime } from '../../lib/server/runtime';
import { getSettings, parseSettingsForm, saveSettings } from '../../lib/server/settings';
import type { Severity } from '../../lib/server/types';
import type { Actions, PageServerLoad } from './$types';

const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];
const discordChannel = () => getRuntime().db.select().from(channels).where(eq(channels.kind, 'discord')).get();

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const ch = discordChannel();
	return {
		settings: getSettings(db),
		// the webhook URL holds a token: never send it to the browser
		channel: ch ? { configured: !!ch.config?.webhookUrl, mentionCritical: ch.config?.mentionCritical === true,
			minSeverity: ch.minSeverity, enabled: ch.enabled } : null,
		prereqs: checkPrereqs(state.bridge.info),
		failed: db.select().from(outbox).where(eq(outbox.status, 'failed')).orderBy(desc(outbox.createdAt)).limit(50).all()
			.map((r) => ({ id: r.id, createdAt: r.createdAt, title: (r.message as Message).title, lastError: r.lastError }))
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const r = parseSettingsForm(await request.formData());
		if ('error' in r) return fail(400, { section: 'settings', error: r.error });
		saveSettings(getRuntime().db, r.settings);
		return { section: 'settings', saved: true };
	},
	saveChannel: async ({ request }) => {
		const { db, config } = getRuntime();
		const form = await request.formData();
		const url = String(form.get('webhookUrl') ?? '').trim();
		const minSeverity = SEVERITIES.find((s) => s === form.get('minSeverity'));
		const ch = discordChannel();
		if (!minSeverity) return fail(400, { section: 'channel', error: 'Pick a minimum severity.' });
		if (url && !WEBHOOK_RE.test(url)) return fail(400, { section: 'channel', error: 'The webhook URL must start with https://discord.com/api/webhooks/' });
		const webhookUrl = url ? encrypt(url, config.secretKey) : ch?.config?.webhookUrl; // empty keeps the stored one
		if (!webhookUrl) return fail(400, { section: 'channel', error: 'Enter the Discord webhook URL.' });
		const values = { config: { webhookUrl, mentionCritical: form.get('mentionCritical') === 'on' }, minSeverity, enabled: form.get('enabled') === 'on' };
		if (ch) db.update(channels).set(values).where(eq(channels.id, ch.id)).run();
		else db.insert(channels).values({ kind: 'discord', name: 'Discord', ...values }).run();
		return { section: 'channel', saved: true };
	},
	test: async () => {
		const { db, config } = getRuntime();
		const ch = discordChannel();
		if (!ch) return fail(400, { section: 'channel', error: 'Save the Discord channel first.' });
		const r = await sendTest(db, ch.id, config.secretKey);
		return r.ok ? { section: 'channel', tested: true } : fail(400, { section: 'channel', error: `Test failed: ${r.error}` });
	}
};
