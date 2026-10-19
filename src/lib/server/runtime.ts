import { ensureAdmin, getAuth } from './auth';
import { loadConfig, type Config } from './config';
import { getDb, type Db } from './db';
import { startActive } from './active/loop';
import { startEngine } from './engine';
import { startHeartbeat } from './heartbeat';
import type { Counters } from './issues/lifecycle';
import { startCollector } from './mqtt/collector';
import type { Requester } from './mqtt/request';
import { startOutbox } from './notify/outbox';
import { applyEffects, loadDevices } from './store';
import { createState, type AppState } from './types';

export type Runtime = { config: Config; db: Db; state: AppState; requester: Requester };
type G = { __meshpulse?: Runtime };

export function startRuntime(): Runtime {
	const g = globalThis as G; // survives Vite HMR module reloads
	if (g.__meshpulse) return g.__meshpulse;
	const config = loadConfig();
	const db = getDb();
	const state = createState(Date.now());
	loadDevices(db, state);
	ensureAdmin(getAuth(), config.adminEmail, config.adminPassword)
		.then((r) => {
			if (r === 'skipped') console.warn('auth: ADMIN_EMAIL or ADMIN_PASSWORD not set, nobody can log in');
			else console.log(`auth: admin account ${r}`);
		})
		.catch((e) => console.error('auth: admin seeding failed', e));
	const dirty = new Set<string>();
	const counters: Counters = { seen: new Map(), missing: new Map() };
	const collector = startCollector({ config, state, onEffects: (effects) => applyEffects(db, effects, dirty) });
	const stops = [
		collector.stop,
		startEngine({ db, state, counters, config, dirty }).stop,
		startOutbox({ db, secretKey: config.secretKey }).stop,
		startHeartbeat({ state, db, config }).stop,
		startActive({ db, state, requester: collector.requester, config }).stop
	];
	// adapter-node closes the HTTP server on SIGTERM, then emits this; timers and MQTT would keep the process alive
	process.once('sveltekit:shutdown', () => {
		for (const stop of stops) void stop();
	});
	return (g.__meshpulse = { config, db, state, requester: collector.requester });
}

export function getRuntime(): Runtime {
	const rt = (globalThis as G).__meshpulse;
	if (!rt) throw new Error('runtime not started');
	return rt;
}
