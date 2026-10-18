import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
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
			try {
				const m = JSON.parse(l);
				if (typeof m?.ts === 'number' && typeof m.topic === 'string') lines.push(m);
				else bad++;
			} catch { bad++; }
		}
		const report = replay(lines);
		const out = process.env.REPLAY_OUT || `${process.env.REPLAY}.report.txt`;
		const text = `${formatReport(report, process.env.TZ || 'Europe/Oslo')}\nSkipped malformed lines: ${bad}\n`;
		writeFileSync(out, text);
		// vitest hides console.log of passing tests
		process.stdout.write(`${text}Report written to ${out}\n`);
		expect(readFileSync(out, 'utf8')).toContain('Notifications');
	}, 600_000);
});
