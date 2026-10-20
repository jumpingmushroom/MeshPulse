import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// In-page links must go through resolve() so they work under the Home Assistant ingress prefix.
// Notification links (src/lib/server/notify) use the absolute PUBLIC_URL and are not in-page links.
// Matched across line breaks; `//host` (protocol-relative) is not a root path.
const R = String.raw`\/(?!\/)`;
const BAD = [
	new RegExp(String.raw`(href|action)\s*=\s*\{?\s*['"\x60]` + R), // href="/x", href='/x', href={'/x'}, href={`/x`}, action="/x"
	new RegExp(String.raw`\b(goto|fetch)\(\s*['"\x60]` + R),
	new RegExp(String.raw`\bredirect\(\s*(\d+\s*,\s*)?['"\x60]` + R), // redirect(303, '/x') and redirect('/x')
	new RegExp(String.raw`\b(window\.)?location(\.href)?\s*=\s*['"\x60]` + R)
];

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return e.name === 'notify' ? [] : walk(p);
		return /\.(svelte|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
	});
}

const hitsIn = (text: string) => BAD.flatMap((r) => [...text.matchAll(new RegExp(r.source, 'g'))].map((m) => text.slice(0, m.index).split('\n').length));

describe('root-relative paths', () => {
	it('the patterns catch every spelling and leave relative and external links alone', () => {
		for (const bad of ['<a href="/x">', "<a href='/x'>", "<a href={'/x'}>", '<a href={`/x/${y}`}>', '<a\n  href="/x">', '<form action="/x?/y">',
			"goto('/x')", 'fetch(`/api`)', "redirect(303, '/x')", "redirect('/x')", "window.location = '/x'", "location.href = '/x'"])
			expect(hitsIn(bad), bad).not.toEqual([]);
		for (const ok of ['<a href="./x">', '<a href="?range=7d">', '<a href="//cdn.example">', '<a href="https://x">', '<a href={resolve(\'/x\')}>',
			"appRedirect(event, 303, '/x')", '<form action="?/save">'])
			expect(hitsIn(ok), ok).toEqual([]);
	});

	it('none in routes or lib', () => {
		const hits = ['src/routes', 'src/lib'].flatMap(walk).flatMap((f) => hitsIn(readFileSync(f, 'utf8')).map((line) => `${f}:${line}`));
		expect(hits).toEqual([]);
	});
});
