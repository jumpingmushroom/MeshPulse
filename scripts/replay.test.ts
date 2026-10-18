import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import type { MqttMsg } from '../src/lib/server/types';
import { formatReport, replay } from './replay';

// REPLAY=<capture.jsonl> npm run replay
describe.skipIf(!process.env.REPLAY)('replay of a real capture', () => {
	it('produces a report', async () => {
		const lines: MqttMsg[] = [];
		let bad = 0;
		for await (const l of createInterface({ input: createReadStream(process.env.REPLAY!), crlfDelay: Infinity })) {
			if (!l.trim()) continue;
			try { lines.push(JSON.parse(l)); } catch { bad++; }
		}
		const report = replay(lines);
		console.log(`${formatReport(report, process.env.TZ || 'Europe/Oslo')}\nSkipped malformed lines: ${bad}`);
		expect(report.messages).toBe(lines.length);
	}, 600_000);
});
