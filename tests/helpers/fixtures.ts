import { readFileSync } from 'node:fs';
import type { MqttMsg } from '../../src/lib/server/types';

export function loadFixture(name: string): MqttMsg[] {
	return readFileSync(`tests/fixtures/${name}.jsonl`, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as MqttMsg);
}
