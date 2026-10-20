import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// In-page links must go through resolve() so they work under the Home Assistant ingress prefix.
// Notification links (src/lib/server/notify) use the absolute PUBLIC_URL and are not in-page links.
const BAD = [/href="\//, /href=\{`\//, /action="\//, /goto\(\s*['"`]\//, /fetch\(\s*['"`]\//, /redirect\(\s*\d+,\s*['"`]\//];

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return e.name === 'notify' ? [] : walk(p);
		return /\.(svelte|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
	});
}

describe('root-relative paths', () => {
	it('none in routes or lib', () => {
		const hits = ['src/routes', 'src/lib'].flatMap(walk).flatMap((f) =>
			readFileSync(f, 'utf8').split('\n').flatMap((l, i) => (BAD.some((r) => r.test(l)) ? [`${f}:${i + 1}: ${l.trim()}`] : []))
		);
		expect(hits).toEqual([]);
	});
});
