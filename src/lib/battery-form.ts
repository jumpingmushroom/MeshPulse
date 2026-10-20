import { KNOWN_TYPES } from './battery-types';

type Parsed = { type: string | null; cells: number | null } | { field: 'type' | 'other' | 'cells'; message: string };

/** Device page battery override form; the character rule keeps markup and Discord mentions out of pages and the digest. */
export function parseBatteryForm(form: FormData): Parsed {
	if (form.get('reset') === '1') return { type: null, cells: null };
	const pick = String(form.get('type') ?? '');
	let type: string;
	if (pick === 'Other') {
		type = String(form.get('other') ?? '').trim();
		if (!/^[A-Za-z0-9 -]{1,20}$/.test(type)) return { field: 'other', message: 'Use 1-20 letters, digits, spaces or -' };
		// "cr2032" typed as Other is the known CR2032, so the shopping list groups it with the rest
		type = KNOWN_TYPES.find((k) => k.toLowerCase() === type.toLowerCase()) ?? type;
	} else if ((KNOWN_TYPES as readonly string[]).includes(pick)) type = pick;
	else return { field: 'type', message: 'Choose a battery type' };
	const cells = Number(form.get('cells'));
	if (!Number.isInteger(cells) || cells < 1 || cells > 8) return { field: 'cells', message: 'Cells must be 1-8' };
	return { type, cells };
}
