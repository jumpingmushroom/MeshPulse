import { wifiMHz, zigbeeMHz } from './wifi-freq';

const LO = 2400;
const SPAN = 84;

/** 2400-2484 MHz across `w`; each AP a bar of its width, stacked into rows so bars never overlap. */
export function bandLayout(zigbeeChannel: number | null, aps: { name: string; channel: number; width: number; overlaps: boolean }[], w: number) {
	const px = (mhz: number) => ((mhz - LO) / SPAN) * w;
	const ends: number[] = []; // right edge per row
	const bars = aps.map((a) => {
		const x = Math.max(0, px(wifiMHz(a.channel) - a.width / 2));
		return { name: a.name, x, width: Math.min(w, px(wifiMHz(a.channel) + a.width / 2)) - x, overlaps: a.overlaps, row: 0 };
	});
	// rows are assigned left to right so a row's last bar is its rightmost
	for (const b of [...bars].sort((p, q) => p.x - q.x)) {
		b.row = ends.findIndex((e) => e <= b.x);
		if (b.row < 0) b.row = ends.length;
		ends[b.row] = b.x + b.width;
	}
	return { zigbee: zigbeeChannel === null ? null : { x: px(zigbeeMHz(zigbeeChannel)) }, bars };
}
