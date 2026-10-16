import { loadConfig, type Config } from './config';
import { getDb, type Db } from './db';
import { startEngine } from './engine';
import { startHeartbeat } from './heartbeat';
import type { Counters } from './issues/lifecycle';
import { startCollector } from './mqtt/collector';
import { startOutbox } from './notify/outbox';
import { applyEffects, loadDevices } from './store';
import { createState, type AppState } from './types';

export type Runtime = { config: Config; db: Db; state: AppState };
type G = { __meshpulse?: Runtime };

export function startRuntime(): Runtime {
	const g = globalThis as G; // survives Vite HMR module reloads
	if (g.__meshpulse) return g.__meshpulse;
	const config = loadConfig();
	const db = getDb();
	const state = createState(Date.now());
	loadDevices(db, state);
	const dirty = new Set<string>();
	const counters: Counters = { seen: new Map(), missing: new Map() };
	startCollector({ config, state, onEffects: (effects) => applyEffects(db, effects, dirty) });
	startEngine({ db, state, counters, config, dirty });
	startOutbox({ db, secretKey: config.secretKey });
	startHeartbeat({ state, db, config });
	return (g.__meshpulse = { config, db, state });
}

export function getRuntime(): Runtime {
	const rt = (globalThis as G).__meshpulse;
	if (!rt) throw new Error('runtime not started');
	return rt;
}
