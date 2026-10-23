type BatteryType = { type: string; cells: number };

/** Battery-powered by the reported power source, or by any battery or voltage reading (some devices report no power source). */
export const isBatteryPowered = (d: { powerSource: string | null; battery: number | null; voltage: number | null }) =>
	d.powerSource === 'Battery' || d.battery !== null || d.voltage !== null;

export const KNOWN_TYPES = ['CR2032', 'CR2450', 'CR2477', 'CR1632', 'CR123A', 'CR2', 'AAA', 'AA', '9V'] as const;

/**
 * Battery per Zigbee2MQTT definition model (`devices.model`); `vendor|model` keys win where two vendors share a model.
 * Only models whose battery is confirmed by the source in the comment; anything unconfirmed is left out, not guessed.
 */
export const BATTERY_TYPES: Record<string, BatteryType> = {
	'MCCGQ11LM': { type: 'CR1632', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/MCCGQ11LM.html
	'WSDCGQ11LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/WSDCGQ11LM.html
	'RTCGQ11LM': { type: 'CR2450', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/RTCGQ11LM.html
	'RTCGQ14LM': { type: 'CR2450', cells: 2 }, // Aqara: https://www.aqara.com/en/product/motion-sensor-p1/
	'WXKG11LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.mediaworld.it/it/product/_interruttore-wireless-aqara-wxkg11lm-compatibile-homekit-batteria-cr2032-protocollo-zigbee-158242549.html
	'WXKG13LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.buchmann.ch/en/aqara-wirless-wireless-switch-mini-t1-1x-cr2032-p-562011.html
	'VOCKQJK11LM': { type: 'CR2450', cells: 2 }, // Aqara: https://www.domadoo.fr/en/devices/5751-aqara-tvoc-air-quality-monitor-zigbee-30-vockqjk11lm-6970504214644.html
	'WSDCGQ01LM': { type: 'CR2032', cells: 1 }, // Xiaomi: https://store.mectronica.it/en/mi-smart-home-system/1654-mi-smart-home-temperature-humidity-zigbee-battery-powered-for-mi-smart-home-system-6970244522801.html
	'E2202': { type: 'AAA', cells: 1 }, // IKEA: https://www.ikea.com/jo/en/p/badring-water-leakage-sensor-smart-60504352/
	'E1812': { type: 'CR2032', cells: 1 }, // IKEA: https://www.zigbee2mqtt.io/devices/E1812.html
	'9290012607': { type: 'AAA', cells: 2 }, // Philips: https://www.zigbee2mqtt.io/devices/9290012607.html
	'324131092621': { type: 'CR2450', cells: 1 }, // Philips: https://www.zigbee2mqtt.io/devices/324131092621.html
	'TS0601_soil_3': { type: 'AAA', cells: 2 }, // Tuya: https://www.zigbee2mqtt.io/devices/TS0601_soil_3.html
	'V3-BTZB/V3-BTZBE': { type: 'CR123A', cells: 4 }, // Danalock: https://bydemes.com/en/products/intrusion/vesta-alarm/zigbee-devices/SALTO-025
	'ZG-204ZM': { type: 'AAA', cells: 2 }, // HOBEIAN: https://smarthomescene.com/reviews/zigbee-battery-powered-presence-sensor-zg-204zm-review
	'4512771': { type: 'AAA', cells: 2 }, // Namron: https://www.elektroimportoren.no/docs/lib/4512771-Brukerveiledning-5.pdf
	'E1743': { type: 'CR2032', cells: 1 }, // IKEA: https://www.zigbee2mqtt.io/devices/E1743.html
	'E1525/E1745': { type: 'CR2032', cells: 2 }, // IKEA: https://www.zigbee2mqtt.io/devices/E1525_E1745.html
	'E1524/E1810': { type: 'CR2032', cells: 1 }, // IKEA: https://www.zigbee2mqtt.io/devices/E1524_E1810.html
	'E2201': { type: 'AAA', cells: 1 }, // IKEA: https://www.zigbee2mqtt.io/devices/E2201.html
	'WXKG01LM': { type: 'CR2032', cells: 1 }, // Xiaomi: https://www.zigbee2mqtt.io/devices/WXKG01LM.html
	'DJT11LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/DJT11LM.html
	'MFKZQ01LM': { type: 'CR2450', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/MFKZQ01LM.html
	'SJCGQ11LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/SJCGQ11LM.html
	'MCCGQ01LM': { type: 'CR1632', cells: 1 }, // Xiaomi: https://www.zigbee2mqtt.io/devices/MCCGQ01LM.html
	'RTCGQ01LM': { type: 'CR2450', cells: 1 }, // Xiaomi: https://www.zigbee2mqtt.io/devices/RTCGQ01LM.html
	'SJCGQ13LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/SJCGQ13LM.html
	'WXKG07LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/WXKG07LM.html
	'WXCJKG11LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/WXCJKG11LM.html
	'WXKG06LM': { type: 'CR2032', cells: 1 }, // Aqara: https://www.zigbee2mqtt.io/devices/WXKG06LM.html
	'929002398602': { type: 'CR2032', cells: 1 }, // Philips: https://www.zigbee2mqtt.io/devices/929002398602.html
	'SNZB-01': { type: 'CR2450', cells: 1 }, // SONOFF: https://www.zigbee2mqtt.io/devices/SNZB-01.html
	'SNZB-02': { type: 'CR2450', cells: 1 }, // SONOFF: https://www.zigbee2mqtt.io/devices/SNZB-02.html
	'SNZB-02D': { type: 'CR2450', cells: 1 }, // SONOFF: https://www.zigbee2mqtt.io/devices/SNZB-02D.html
	'SNZB-02P': { type: 'CR2477', cells: 1 }, // SONOFF: https://www.zigbee2mqtt.io/devices/SNZB-02P.html
	'SNZB-01P': { type: 'CR2477', cells: 1 }, // SONOFF: https://www.zigbee2mqtt.io/devices/SNZB-01P.html
	'SNZB-02WD': { type: 'CR2477', cells: 1 }, // SONOFF: https://www.zigbee2mqtt.io/devices/SNZB-02WD.html
	'SNZB-03P': { type: 'CR2477', cells: 1 }, // SONOFF: https://www.multitronic.fi/en/products/4633386
	'HS1SA-E': { type: 'CR123A', cells: 1 }, // Heiman: https://smarthomescene.com/reviews/heiman-zigbee-smoke-sensor-and-alarm-review/
	'HS1CA-E': { type: 'CR123A', cells: 1 }, // Heiman: https://smarthomescene.com/reviews/heiman-zigbee-carbon-monoxide-sensor-review/
};

export function lookup(table: Record<string, BatteryType>, vendor: string | null, model: string | null): BatteryType | null {
	if (!model) return null;
	return table[`${vendor}|${model}`] ?? table[model] ?? null;
}

export const builtinBattery = (vendor: string | null, model: string | null) => lookup(BATTERY_TYPES, vendor, model);

/** The user's override (devices.battery_type/battery_cells) always wins over the built-in table. */
export function batteryOf(d: { vendor: string | null; model: string | null; batteryType: string | null; batteryCells: number | null }):
	{ type: string; cells: number; source: 'override' | 'builtin' } | null {
	if (d.batteryType) return { type: d.batteryType, cells: d.batteryCells ?? 1, source: 'override' };
	const b = builtinBattery(d.vendor, d.model);
	return b && { ...b, source: 'builtin' };
}
