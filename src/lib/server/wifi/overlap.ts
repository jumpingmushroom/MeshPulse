export const zigbeeMHz = (c: number) => 2405 + 5 * (c - 11);
export const wifiMHz = (n: number) => (n === 14 ? 2484 : 2407 + 5 * n);

export const overlaps = (zigbeeChannel: number, wifiChannel: number, widthMHz: number) =>
	Math.abs(zigbeeMHz(zigbeeChannel) - wifiMHz(wifiChannel)) < widthMHz / 2 + 1;

/** The non-overlapping channels among 1, 6, 11 at 20 MHz. */
export const freeChannels = (zigbeeChannel: number) => [1, 6, 11].filter((c) => !overlaps(zigbeeChannel, c, 20));
