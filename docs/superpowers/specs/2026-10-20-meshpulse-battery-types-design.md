# MeshPulse battery types and shopping list: design

## Goal

MeshPulse knows which battery each device takes and turns "low now or due within 30 days" into a shopping list grouped by battery type, on the Batteries page and in the weekly digest.

Decisions from brainstorming (Q1-Q2):
- Built-in lookup table plus a per-device override that always wins (Q1 A). No runtime fetching.
- Shopping list: due within 30 days, grouped by type; rechargeables listed separately as "Recharge"; unknown types listed with a link to set them (Q2 A).

## Out of scope

Stock counts, a horizon choice, fetching battery data from the internet, battery brands or prices, mains devices.

## Data

### Built-in table

`src/lib/battery-types.ts` exports:
- `type BatteryType = { type: string; cells: number }`
- `BATTERY_TYPES: Record<string, BatteryType>` keyed by the Zigbee2MQTT definition `model` (`devices.model`). Models are unique enough across vendors; where two vendors share a model string, the key is `vendor|model` and is checked first.
- `builtinBattery(vendor: string | null, model: string | null): BatteryType | null` (lookup `vendor|model`, then `model`).

Entries are the models whose battery can be confirmed from the Zigbee2MQTT device page or the manufacturer's spec, each with its source URL in a trailing comment. The first version covers every battery model on the reference network (Aqara MCCGQ11LM, WSDCGQ11LM, RTCGQ11LM, RTCGQ14LM, WXKG11LM, WXKG13LM, VOCKQJK11LM; Xiaomi WSDCGQ01LM; IKEA E2202, E1812; Philips 9290012607, 324131092621; Tuya TS0601_soil_3; Danalock V3-BTZB/V3-BTZBE; Datek HBR2917E; HOBEIAN ZG-204ZM; Namron 4512771) plus common models from IKEA, Aqara/Xiaomi, Philips Hue, Sonoff, Tuya and Heiman, about 60-100 in total. A model whose battery can't be confirmed is left out, not guessed.

Type names are normalised: `CR2032`, `CR2450`, `CR2477`, `CR1632`, `CR123A`, `CR2`, `AAA`, `AA`, `9V`, or free text for anything else.

### Override

`devices.battery_type` (text, nullable) and `devices.battery_cells` (integer, nullable), via a Drizzle migration. Both null means "use the built-in table". `DeviceState` gains `batteryType: string | null` and `batteryCells: number | null`, loaded and flushed like the other device columns.

`batteryOf(d: DeviceState): { type: string; cells: number; source: 'override' | 'builtin' } | null` in `src/lib/battery-types.ts`: the override when `batteryType` is set (cells default to 1), else the table, else null.

## Device page

For battery devices, a "Battery type" line in the side panel: `CR2032 ×1 · built-in list`, `AAA ×2 · set by you`, or `Unknown`. An edit form (same panel, same form styles as Chatty/Rechargeable):
- type: select of `CR2032, CR2450, CR2477, CR1632, CR123A, CR2, AAA, AA, 9V, Other`; `Other` shows a text field (1-20 characters, letters, digits, spaces and `-`).
- cells: number 1-8.
- Save, and "Reset to built-in" (shown only with an override) which clears both columns.

Action `batteryType` validates and writes both columns and the in-memory device; bad input returns `fail(400)` with a field message.

## Shopping list

`shoppingList(rows: BatteryRow[], devices: Map<string, DeviceState>, days = 30)` in `src/lib/views.ts` returns:
- `buy: { type: string; count: number; devices: { ieee: string; name: string }[] }[]`: devices due (low now, or `daysLeft <= days`), not tagged rechargeable, with a known type; `count` sums cells; sorted by count descending, then type.
- `recharge: { ieee: string; name: string }[]`: due devices tagged rechargeable.
- `unknown: { ieee: string; name: string }[]`: due devices without a known type.

"Due" reuses `BatteryRow.low` and `BatteryRow.daysLeft` from `batteryRows`.

Batteries page: a "Shopping list" section above the existing table, with three blocks (Buy, Recharge, Type unknown) shown only when non-empty, and "Nothing to buy in the next 30 days" when all are empty. Each Buy group shows `CR2032 ×3` and its device names as links. The existing table gets a "Type" column (`CR2032 ×1` or `—`).

Weekly digest: its batteries part lists the Buy groups (`CR2032 ×3 (3 devices)`), then Recharge and Type unknown device names.

## Testing

- `battery-types.test.ts`: `vendor|model` beats `model`; unknown model gives null; override beats the table; override without cells gives 1; every table entry has a type and cells ≥ 1.
- `views.test.ts` `shoppingList`: cells summed per type across devices; rechargeable due devices only in `recharge`; unknown types only in `unknown`; not-due devices excluded; sort order.
- Device action: valid select, valid Other text, bad text, cells out of range, reset clears both columns.
- Store: the two columns persist and reload.
- Live check on the preview: every battery model on the reference network shows a type; screenshot of the Batteries page.
