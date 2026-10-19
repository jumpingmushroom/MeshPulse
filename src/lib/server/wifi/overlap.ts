import { wifiMHz, zigbeeMHz } from '../../wifi-freq';
export { wifiMHz, zigbeeMHz };

export const overlaps = (zigbeeChannel: number, wifiChannel: number, widthMHz: number) =>
	Math.abs(zigbeeMHz(zigbeeChannel) - wifiMHz(wifiChannel)) < widthMHz / 2 + 1;

/** The non-overlapping channels among 1, 6, 11 at 20 MHz. */
export const freeChannels = (zigbeeChannel: number) => [1, 6, 11].filter((c) => !overlaps(zigbeeChannel, c, 20));
