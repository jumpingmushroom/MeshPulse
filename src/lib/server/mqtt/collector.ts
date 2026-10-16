import mqtt from 'mqtt';
import type { Config } from '../config';
import type { AppState, Effect } from '../types';
import { route } from './route';

export function startCollector({ config, state, onEffects }: {
	config: Config;
	state: AppState;
	onEffects: (effects: Effect[]) => void;
}) {
	const client = mqtt.connect(config.mqttUrl, {
		username: config.mqttUsername,
		password: config.mqttPassword,
		reconnectPeriod: 5000
	});
	const down = () => {
		state.monitor.connected = false;
		state.monitor.downSince ??= Date.now();
	};
	client.on('connect', () => {
		state.monitor.connected = true;
		state.monitor.downSince = null;
		state.monitor.connectedAt = Date.now();
		const topic = `${config.baseTopic}/#`;
		client.subscribe(topic, (err, granted) => {
			if (err) console.error(`MQTT: subscribe to ${topic} failed:`, err.message);
			else if (granted?.some((g) => g.qos === 128))
				console.error(`subscribe to ${topic} was rejected by the broker — check the MQTT user ACL`);
		});
	});
	client.on('close', down);
	client.on('offline', down);
	// refused connections arrive as an AggregateError with an empty message
	client.on('error', (e) => console.error('MQTT error:', e.message || (e as NodeJS.ErrnoException).code || String(e)));
	client.on('message', (topic, payload, packet) => {
		try {
			const fx = route(state, { ts: Date.now(), topic, payload, retain: packet.retain }, config.baseTopic);
			if (fx.length) onEffects(fx);
		} catch (e) {
			console.warn('collector: failed to handle message', topic, e);
		}
	});
	return { client, stop: () => client.endAsync() };
}
