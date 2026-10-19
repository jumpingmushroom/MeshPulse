import { eq } from 'drizzle-orm';
import type { Db } from '../db/index';
import { wifiAps, wifiAreas } from '../db/schema';

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function inOrder(abbr: string, full: string): boolean {
	let i = 0;
	for (const ch of full) if (ch === abbr[i]) i++;
	return i === abbr.length;
}

/** A hint only: the area named as whole words in the AP name, else a unique abbreviation in its first token. */
export function suggestArea(apName: string, areas: string[]): string | null {
	const ap = words(apName);
	const sole = (xs: string[]) => (xs.length === 1 ? xs[0] : null);
	const whole = sole(areas.filter((a) => {
		const w = words(a);
		return w.length > 0 && ap.some((_, i) => w.every((x, j) => ap[i + j] === x));
	}));
	if (whole) return whole;
	const first = ap[0];
	if (!first || first.length < 3 || !/^\p{L}+$/u.test(first)) return null;
	return sole(areas.filter((a) => {
		const letters = words(a).join('');
		return letters[0] === first[0] && inOrder(first, letters);
	}));
}

/** Most common leading words (two when the second is "room") that start at least two names. */
export function candidateAreas(deviceNames: string[], max = 20): string[] {
	const seen = new Map<string, { label: string; n: number }>();
	for (const name of deviceNames) {
		const w = name.trim().split(/[\s/_]+/).filter(Boolean);
		if (!w[0] || !/^\p{L}/u.test(w[0])) continue;
		const label = w[1]?.toLowerCase() === 'room' ? `${w[0]} ${w[1]}` : w[0];
		const e = seen.get(label.toLowerCase());
		if (e) e.n++;
		else seen.set(label.toLowerCase(), { label, n: 1 });
	}
	return [...seen.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, max).map((e) => e.label); // stable sort keeps first-seen order on ties
}

export function areaOf(friendlyName: string, areas: { name: string; match: string }[]): string[] {
	const n = friendlyName.toLowerCase();
	return areas.filter((a) => a.match && n.includes(a.match.toLowerCase())).map((a) => a.name);
}

/** Replace the area list and every AP's area in one go; an AP area not in the list becomes null ("whole network"). */
export function saveAreas(db: Db, areas: { name: string; match: string }[], apAreas: Record<string, string | null>): void {
	const rows = new Map<string, string>();
	for (const a of areas) {
		const name = a.name.trim();
		if (name && !rows.has(name)) rows.set(name, a.match.trim() || name);
	}
	db.transaction((tx) => {
		tx.delete(wifiAreas).run();
		for (const [name, match] of rows) tx.insert(wifiAreas).values({ name, match }).run();
		for (const [mac, area] of Object.entries(apAreas)) tx.update(wifiAps).set({ area: area && rows.has(area) ? area : null }).where(eq(wifiAps.mac, mac)).run();
	});
}

/** Validates the Areas form. Rows carry a stable `areaId`, and an AP's select holds an id, so a rename keeps its APs. */
export function parseAreasForm(form: FormData): { error: string } | { areas: { name: string; match: string }[]; apAreas: Record<string, string | null> } {
	const ids = form.getAll('areaId').map(String);
	const names = form.getAll('areaName').map((v) => String(v).trim());
	const matches = form.getAll('areaMatch').map(String);
	const seen = new Set<string>();
	for (const n of names) {
		if (!n) return { error: 'Every area needs a name. Fill it in or remove the row.' };
		if (seen.has(n.toLowerCase())) return { error: `Area names must be unique, "${n}" appears twice.` };
		seen.add(n.toLowerCase());
	}
	const apAreas: Record<string, string | null> = {};
	for (const mac of form.getAll('apMac').map(String)) {
		const v = String(form.get(`ap:${mac}`) ?? '');
		const i = ids.indexOf(v);
		if (v && i < 0) return { error: 'An access point has an area that does not exist. Pick one from the list or Whole network.' };
		apAreas[mac] = v ? names[i] : null;
	}
	return { areas: names.map((name, i) => ({ name, match: matches[i] ?? '' })), apAreas };
}
