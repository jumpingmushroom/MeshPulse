import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import mqtt from 'mqtt';

const base = process.env.Z2M_BASE_TOPIC ?? 'zigbee2mqtt';
const out = process.argv[2] ?? `captures/${new Date().toISOString()}.jsonl`;
mkdirSync(dirname(out), { recursive: true });

const client = mqtt.connect(process.env.MQTT_URL ?? 'mqtt://localhost:1883', {
	username: process.env.MQTT_USERNAME,
	password: process.env.MQTT_PASSWORD
});
let count = 0;

client.on('connect', () => client.subscribe(`${base}/#`));
client.on('error', (e) => console.error(e.message));
client.on('message', (topic, buf, packet) => {
	const raw = buf.toString();
	let payload: unknown = raw;
	try {
		payload = JSON.parse(raw);
	} catch {
		// non-JSON payloads are kept as the raw string
	}
	// sync append: shortcut: blocks on slow disks, fine at Z2M message rates
	appendFileSync(out, JSON.stringify({ ts: Date.now(), topic, payload, retain: packet.retain }) + '\n');
	count++;
});

console.log(`Recording ${base}/# to ${out} (Ctrl+C to stop)`);
setInterval(() => console.log(`${count} messages captured`), 60_000);
process.on('SIGINT', () => {
	client.end(false, () => {
		console.log(`Stopped after ${count} messages`);
		process.exit(0);
	});
});
