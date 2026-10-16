export type Config = {
	mqttUrl: string;
	mqttUsername?: string;
	mqttPassword?: string;
	baseTopic: string;
	databasePath: string;
	publicUrl?: string;
	tz: string;
	secretKey: string;
	heartbeatUrl?: string;
	adminEmail?: string;
	adminPassword?: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	if (!env.SECRET_KEY) throw new Error('SECRET_KEY is required');
	return {
		mqttUrl: env.MQTT_URL || 'mqtt://mosquitto:1883',
		mqttUsername: env.MQTT_USERNAME || undefined,
		mqttPassword: env.MQTT_PASSWORD || undefined,
		baseTopic: env.Z2M_BASE_TOPIC || 'zigbee2mqtt',
		databasePath: env.DATABASE_PATH || '/data/meshpulse.db',
		publicUrl: env.PUBLIC_URL || undefined,
		tz: env.TZ || 'Europe/Oslo',
		secretKey: env.SECRET_KEY,
		heartbeatUrl: env.HEARTBEAT_URL || undefined,
		adminEmail: env.ADMIN_EMAIL || undefined,
		adminPassword: env.ADMIN_PASSWORD || undefined
	};
}
