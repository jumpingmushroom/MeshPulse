import { fail } from '@sveltejs/kit';
import { and, desc, eq, ne } from 'drizzle-orm';
import { decrypt, encrypt } from '../../lib/server/crypto';
import { channels, outbox, scans, wifiAps, wifiAreas } from '../../lib/server/db/schema';
import type { Message } from '../../lib/server/notify/channel';
import { parseAppriseForm } from '../../lib/server/notify/apprise';
import { haTarget, haTokenKept, listNotifyServices, parseHomeAssistantForm } from '../../lib/server/notify/homeassistant';
import { isAddon } from '../../lib/server/addon';
import { WEBHOOK_RE } from '../../lib/server/notify/discord';
import { sendTest } from '../../lib/server/notify/outbox';
import { due, lastDay, setActive } from '../../lib/server/active/schedule';
import { lastPing } from '../../lib/server/heartbeat';
import { checkPrereqs } from '../../lib/server/prereqs';
import { getRuntime } from '../../lib/server/runtime';
import { DEFAULT_SETTINGS, getSettings, parseSettingsForm, saveFormSettings, saveSettings } from '../../lib/server/settings';
import { candidateAreas, parseAreasForm, saveAreas, suggestArea } from '../../lib/server/wifi/areas';
import { canKeepPassword, getWifiConfig, getWifiForm, saveWifiConfig } from '../../lib/server/wifi/config';
import { exclusive } from '../../lib/server/wifi/poller';
import { createUnifi } from '../../lib/server/wifi/unifi';
import type { Severity } from '../../lib/server/types';
import type { Actions, PageServerLoad } from './$types';

const NEW_CONTROLLER = 'Enter the password for the new controller';
const URL_RE = /^https?:\/\/[^\s/]+$/;
const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];
const channelOf = (kind: string) => getRuntime().db.select().from(channels).where(eq(channels.kind, kind)).get();
const discordChannel = () => channelOf('discord');

function activeInfo(kind: 'coordinator_check' | 'networkmap', at: '03:30' | '04:00') {
	const { db, config } = getRuntime();
	const now = Date.now();
	const last = db.select().from(scans).where(and(eq(scans.kind, kind), ne(scans.trigger, 'manual'))).orderBy(desc(scans.startedAt)).limit(1).get();
	// past `at` with no finished run today: the loop retries on its next tick
	const retrying = due(now, at, lastDay(db, kind), config.tz) !== null;
	const early = new Date(now).toLocaleTimeString('en-GB', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) < at;
	const next = retrying ? 'at the next check' : `${early ? 'today' : 'tomorrow'} at ${at}`;
	return { last: last ? { at: last.startedAt, status: last.status, reason: last.reason } : null, next };
}

/** Areas, APs with a hint against the saved areas, and area suggestions from device names. */
function areaSettings(db: ReturnType<typeof getRuntime>['db']) {
	const areas = db.select().from(wifiAreas).all();
	return {
		areas,
		aps: db.select().from(wifiAps).all().map((a) => ({ mac: a.mac, name: a.name, model: a.model, area: a.area, hint: a.area ? null : suggestArea(a.name, areas.map((r) => r.name)) })),
		suggested: candidateAreas([...getRuntime().state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator' && !d.tags.includes('ignore')).map((d) => d.friendlyName))
	};
}

/** The UniFi fields as typed (`values`, echoed back on errors, never the password) and normalised. */
function wifiForm(form: FormData) {
	const text = (k: string) => String(form.get(k) ?? '').trim();
	const values = { url: text('url'), site: text('site'), user: text('user'), wifiEnabled: form.get('wifiEnabled') === 'on' };
	return { values, url: values.url.replace(/\/+$/, ''), site: values.site || 'default', password: String(form.get('password') ?? '') };
}

async function testChannel<S extends string>(kind: string, section: S, name: string) {
	const { db, config } = getRuntime();
	const ch = channelOf(kind);
	if (!ch) return fail(400, { section, error: `Save the ${name} channel first.` });
	const r = await sendTest(db, ch.id, config.secretKey);
	return r.ok ? { section, tested: true } : fail(400, { section, error: `Test failed: ${r.error}` });
}

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const ch = discordChannel();
	return {
		settings: getSettings(db),
		defaults: DEFAULT_SETTINGS,
		heartbeat: { configured: !!(getSettings(db).heartbeatUrl || getRuntime().config.heartbeatUrl), last: lastPing() },
		// the webhook URL holds a token: never send it to the browser
		channel: ch ? { configured: !!ch.config?.webhookUrl, mentionCritical: ch.config?.mentionCritical === true, weeklyDigest: ch.config?.weeklyDigest !== false,
			minSeverity: ch.minSeverity, enabled: ch.enabled } : null,
		homeassistant: (() => {
			const h = channelOf('homeassistant'); // the token never goes to the browser
			return { addon: isAddon(), ...(h ? { url: String(h.config?.url ?? ''), tokenSet: !!h.config?.token, services: (h.config?.services as string[] | undefined) ?? [],
				weeklyDigest: h.config?.weeklyDigest === true, minSeverity: h.minSeverity, enabled: h.enabled, saved: true } : { url: '', tokenSet: false, services: [], weeklyDigest: false, minSeverity: 'warning', enabled: true, saved: false }) };
		})(),
		apprise: (() => {
			const a = channelOf('apprise'); // the stored urls hold tokens: send only whether they exist
			return a ? { apiUrl: String(a.config?.apiUrl ?? ''), key: String(a.config?.key ?? ''), urlsConfigured: !!a.config?.urls, weeklyDigest: a.config?.weeklyDigest === true,
				minSeverity: a.minSeverity, enabled: a.enabled } : null;
		})(),
		active: { check: activeInfo('coordinator_check', '03:30'), scan: activeInfo('networkmap', '04:00'), devices: [...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator').length },
		wifi: { ...getWifiForm(db), enabled: getSettings(db).wifiEnabled, status: { ...state.wifi } },
		areas: areaSettings(db),
		prereqs: checkPrereqs(state.bridge.info),
		failed: db.select().from(outbox).where(eq(outbox.status, 'failed')).orderBy(desc(outbox.createdAt)).limit(50).all()
			.map((r) => ({ id: r.id, createdAt: r.createdAt, title: (r.message as Message).title, lastError: r.lastError }))
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const r = parseSettingsForm(form);
		if ('error' in r) return fail(400, { section: 'settings', error: r.error, errors: r.errors, values: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, String(form.get(k) ?? '')])) });
		saveFormSettings(getRuntime().db, r.settings);
		return { section: 'settings', saved: true };
	},
	saveActive: async ({ request }) => {
		const { db, config } = getRuntime();
		const form = await request.formData();
		setActive(db, { activeCoordinatorCheck: form.get('activeCoordinatorCheck') === 'on', activeNetworkScan: form.get('activeNetworkScan') === 'on' }, Date.now(), config.tz);
		return { section: 'active', saved: true };
	},
	saveWifi: async ({ request }) => {
		const { db, config } = getRuntime();
		const { values, url, site, password } = wifiForm(await request.formData());
		if (url && !URL_RE.test(url)) return fail(400, { section: 'wifi', error: 'The controller URL must look like https://192.168.1.1', wifiValues: values });
		if (!password && getWifiForm(db).passwordSet && !canKeepPassword(db, { url, site })) return fail(400, { section: 'wifi', error: NEW_CONTROLLER, wifiValues: values });
		if (values.wifiEnabled && (!url || !values.user || (!password.trim() && !canKeepPassword(db, { url, site })))) return fail(400, { section: 'wifi', error: 'Enter the URL, user and password before enabling.', wifiValues: values });
		saveWifiConfig(db, config.secretKey, { url, site, user: values.user, password });
		saveSettings(db, { wifiEnabled: values.wifiEnabled });
		return { section: 'wifi', saved: true };
	},
	testWifi: async ({ request }) => {
		const { db, config } = getRuntime();
		const { values, url, site, password: typed } = wifiForm(await request.formData());
		if (!url || !URL_RE.test(url) || !values.user) return fail(400, { section: 'wifi', error: 'Enter the controller URL (like https://192.168.1.1) and user to test.', wifiValues: values });
		// a typed password wins; the stored one only for the same controller and site; nothing is saved
		const password = typed || (canKeepPassword(db, { url, site }) ? getWifiConfig(db, config.secretKey)?.password : '') || '';
		if (!password) return fail(400, { section: 'wifi', error: getWifiForm(db).passwordSet ? NEW_CONTROLLER : 'Enter the password to test.', wifiValues: values });
		const r = await exclusive(async () => {
			const client = createUnifi({ url, site, user: values.user, password });
			try {
				await client.devices(); // one login and one stat/device call
				return { ok: true as const, text: client.describe() };
			} catch (e) {
				return { ok: false as const, text: e instanceof Error ? e.message : String(e) };
			} finally {
				await client.logout();
			}
		});
		if (!r) return fail(400, { section: 'wifi', error: 'A poll is running — try again in a moment', wifiValues: values });
		return r.ok ? { section: 'wifi', tested: r.text, wifiValues: values } : fail(400, { section: 'wifi', error: r.text, wifiValues: values });
	},
	saveAreas: async ({ request }) => {
		const r = parseAreasForm(await request.formData());
		if ('error' in r) return fail(400, { section: 'areas', error: r.error });
		saveAreas(getRuntime().db, r.areas, r.apAreas);
		return { section: 'areas', saved: true };
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
		const values = { config: { webhookUrl, mentionCritical: form.get('mentionCritical') === 'on', weeklyDigest: form.get('weeklyDigest') === 'on' }, minSeverity, enabled: form.get('enabled') === 'on' };
		if (ch) db.update(channels).set(values).where(eq(channels.id, ch.id)).run();
		else db.insert(channels).values({ kind: 'discord', name: 'Discord', ...values }).run();
		return { section: 'channel', saved: true };
	},
	test: () => testChannel('discord', 'channel', 'Discord'),
	saveApprise: async ({ request }) => {
		const { db, config } = getRuntime();
		const form = await request.formData();
		const minSeverity = SEVERITIES.find((s) => s === form.get('minSeverity'));
		const ch = channelOf('apprise');
		if (!minSeverity) return fail(400, { section: 'apprise', error: 'Pick a minimum severity.' });
		const r = parseAppriseForm(form, !!ch?.config?.urls);
		if ('error' in r) return fail(400, { section: 'apprise', error: r.error });
		const urls = r.urls ? encrypt(r.urls, config.secretKey) : r.key ? undefined : ch?.config?.urls; // empty keeps the stored one
		const values = { config: { weeklyDigest: form.get('weeklyDigest') === 'on', apiUrl: r.apiUrl, ...(r.key ? { key: r.key } : {}), ...(urls ? { urls } : {}) }, minSeverity, enabled: form.get('enabled') === 'on' };
		if (ch) db.update(channels).set(values).where(eq(channels.id, ch.id)).run();
		else db.insert(channels).values({ kind: 'apprise', name: 'Apprise', ...values }).run();
		return { section: 'apprise', saved: true };
	},
	testApprise: () => testChannel('apprise', 'apprise', 'Apprise'),
	saveHomeAssistant: async ({ request }) => {
		const { db, config } = getRuntime();
		const form = await request.formData();
		const minSeverity = SEVERITIES.find((s) => s === form.get('minSeverity'));
		if (!minSeverity) return fail(400, { section: 'homeassistant', error: 'Pick a minimum severity.' });
		const ch = channelOf('homeassistant');
		const r = parseHomeAssistantForm(form, haTokenKept(ch?.config, String(form.get('url') ?? '')), isAddon());
		if ('error' in r) return fail(400, { section: 'homeassistant', error: r.error });
		if (!r.services.length) return fail(400, { section: 'homeassistant', error: 'Load the notify services and pick at least one.' });
		const token = r.token ? encrypt(r.token, config.secretKey) : r.url ? ch?.config?.token : undefined; // empty keeps the stored one (same URL only)
		const values = { config: { weeklyDigest: form.get('weeklyDigest') === 'on', services: r.services, ...(r.url ? { url: r.url } : {}), ...(token ? { token } : {}) },
			minSeverity, enabled: form.get('enabled') === 'on' };
		if (ch) db.update(channels).set(values).where(eq(channels.id, ch.id)).run();
		else db.insert(channels).values({ kind: 'homeassistant', name: 'Home Assistant', ...values }).run();
		return { section: 'homeassistant', saved: true, services: r.services };
	},
	loadHaServices: async ({ request }) => {
		const { config } = getRuntime();
		const form = await request.formData();
		const ch = channelOf('homeassistant');
		const url = String(form.get('url') ?? '').trim().replace(/\/+$/, '');
		const typed = String(form.get('token') ?? '').trim();
		// the stored token is only ever sent to the URL it was saved for
		const stored = haTokenKept(ch?.config, url) ? decrypt(String(ch!.config!.token), config.secretKey) : '';
		const t = haTarget(url ? { url, token: typed || stored } : {});
		if (!t) return fail(400, { section: 'homeassistant', error: isAddon() ? 'Home Assistant is not reachable from the add-on.' : 'Enter the Home Assistant URL and a token first.' });
		try {
			return { section: 'homeassistant', available: await listNotifyServices(t), services: form.getAll('services').map(String) };
		} catch (e) {
			return fail(400, { section: 'homeassistant', error: `Could not load notify services: ${e instanceof Error ? e.message : String(e)}` });
		}
	},
	testHomeAssistant: () => testChannel('homeassistant', 'homeassistant', 'Home Assistant')
};

