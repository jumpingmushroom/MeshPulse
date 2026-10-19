import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type SecretSource = 'env' | 'file' | 'generated' | 'memory';

/** Env key wins; else <data dir>/secret.key, generated on first run. */
export function resolveSecretKey(
	envKey: string | undefined,
	databasePath: string
): { key: string; source: SecretSource } {
	if (envKey) return { key: envKey, source: 'env' };
	const key = randomBytes(32).toString('base64');
	if (databasePath === ':memory:') return { key, source: 'memory' };
	const file = join(dirname(databasePath), 'secret.key');
	try {
		const saved = readFileSync(file, 'utf8').trim();
		if (saved) return { key: saved, source: 'file' };
	} catch {
		// missing file: generate below
	}
	try {
		writeFileSync(file, key, { mode: 0o600 });
	} catch (e) {
		throw new Error(
			`Cannot write the secret key to ${file}: ${(e as Error).message}. Set SECRET_KEY or make the data folder writable.`
		);
	}
	return { key, source: 'generated' };
}

export type Config = {
	mqttUrl: string;
	mqttUsername?: string;
	mqttPassword?: string;
	baseTopic: string;
	databasePath: string;
	publicUrl?: string;
	tz: string;
	secretKey: string;
	secretSource: SecretSource;
	heartbeatUrl?: string;
	adminEmail?: string;
	adminPassword?: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const databasePath = env.DATABASE_PATH || '/data/meshpulse.db';
	const secret = resolveSecretKey(env.SECRET_KEY || undefined, databasePath);
	return {
		mqttUrl: env.MQTT_URL || 'mqtt://mosquitto:1883',
		mqttUsername: env.MQTT_USERNAME || undefined,
		mqttPassword: env.MQTT_PASSWORD || undefined,
		baseTopic: env.Z2M_BASE_TOPIC || 'zigbee2mqtt',
		databasePath,
		publicUrl: env.PUBLIC_URL || undefined,
		tz: env.TZ || 'Europe/Oslo',
		secretKey: secret.key,
		secretSource: secret.source,
		heartbeatUrl: env.HEARTBEAT_URL || undefined,
		adminEmail: env.ADMIN_EMAIL || undefined,
		adminPassword: env.ADMIN_PASSWORD || undefined
	};
}
