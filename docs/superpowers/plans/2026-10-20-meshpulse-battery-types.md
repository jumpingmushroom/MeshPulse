# MeshPulse Battery Types and Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MeshPulse knows each device's battery (built-in table plus a per-device override) and shows a shopping list grouped by battery type on the Batteries page and in the weekly digest.

**Architecture:** A pure lookup module `src/lib/battery-types.ts` (table + `builtinBattery` + `batteryOf`). Two nullable override columns on `devices`, loaded into `DeviceState` and written by a device-page action. `batteryRows` carries type and rechargeable flag; a pure `shoppingList(rows)` groups them for the page and the digest.

**Tech Stack:** SvelteKit 3, Svelte 5, TS strict, Drizzle + better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-meshpulse-battery-types-design.md`

## Global Constraints

- No new npm dependency; no runtime network requests.
- Server code uses relative imports. Pages use only classes from `src/app.css`; no `<main>` in pages.
- Type names exactly: `CR2032`, `CR2450`, `CR2477`, `CR1632`, `CR123A`, `CR2`, `AAA`, `AA`, `9V`; anything else is free text.
- Override form: `Other` text 1-20 characters of letters, digits, spaces and `-`; cells 1-8. Override always wins over the table; override cells default to 1.
- A table entry needs a confirmed source (Zigbee2MQTT device page or manufacturer spec) as a trailing comment; unconfirmed models are left out, never guessed.
- Due = `BatteryRow.low` or `daysLeft <= 30`. Rechargeable = device tag `rechargeable`.
- The repo is public: no personal data (names, IPs) in fixtures, tests or comments.
- Conventional commits, no AI attribution.

Ruling against the spec: the spec gives `shoppingList(rows, devices, days)`. The plan puts `type` and `rechargeable` on `BatteryRow` (computed in `batteryRows`, which already has each `DeviceState`), so the signature is `shoppingList(rows: BatteryRow[], days = 30)`. Same output, one less argument.

## Review Focus

1. A device not yet interviewed (`model` and `vendor` null): `builtinBattery` returns null, the device is "Unknown", nothing throws. Test in Task 1.
2. `Other` text with markup or Discord markdown (`<b>`, `**x**`, `@everyone`): rejected by the character rule, so it never reaches the page or the digest. Test in Task 2.
3. A due rechargeable device with no known type: listed under Recharge only, not under Type unknown. Test in Task 3.
4. A due device whose battery percentage is null but `battery_low` is true: due (via `low`), listed. Test in Task 3.
5. Reset with no override set, or a POST for an unknown ieee: no error page, no write (404 for unknown ieee, as the other device actions do). Test in Task 2.

---

### Task 1: Battery table and lookup

**Files:**
- Create: `src/lib/battery-types.ts`, `src/lib/battery-types.test.ts`

**Interfaces:**
- Produces: `type BatteryType = { type: string; cells: number }`; `BATTERY_TYPES: Record<string, BatteryType>`; `KNOWN_TYPES = ['CR2032','CR2450','CR2477','CR1632','CR123A','CR2','AAA','AA','9V'] as const`; `lookup(table: Record<string, BatteryType>, vendor: string | null, model: string | null): BatteryType | null` and `builtinBattery(vendor, model)` = `lookup(BATTERY_TYPES, vendor, model)` (looks up `` `${vendor}|${model}` `` then `model`); `batteryOf(d: { vendor: string | null; model: string | null; batteryType: string | null; batteryCells: number | null }): { type: string; cells: number; source: 'override' | 'builtin' } | null`.

- [ ] **Step 1: Research the entries.** For each model below and for common battery models of IKEA, Aqara/Xiaomi, Philips Hue, Sonoff, Tuya and Heiman (aim for 60-100 total), confirm the battery type and cell count on its Zigbee2MQTT device page (`https://www.zigbee2mqtt.io/devices/<model>.html`) or the manufacturer's spec sheet. Required models (all battery devices on the reference network): `MCCGQ11LM`, `WSDCGQ11LM`, `RTCGQ11LM`, `RTCGQ14LM`, `WXKG11LM`, `WXKG13LM`, `VOCKQJK11LM`, `WSDCGQ01LM`, `E2202`, `E1812`, `9290012607`, `324131092621`, `TS0601_soil_3`, `V3-BTZB/V3-BTZBE`, `HBR2917E`, `ZG-204ZM`, `4512771`. In the report, list each required model as confirmed (type, cells, source) or unconfirmed (left out, why).

- [ ] **Step 2: Write the failing tests** in `battery-types.test.ts`:
  - `vendor|model beats model`: `lookup({ 'Acme|X1': { type: 'AA', cells: 2 }, X1: { type: 'AAA', cells: 1 } }, 'Acme', 'X1')` → `{ type: 'AA', cells: 2 }`; vendor `'Other'` → `{ type: 'AAA', cells: 1 }`.
  - `known model`: `builtinBattery('Aqara', 'WSDCGQ11LM')` equals the researched entry.
  - `null vendor and model give null` (Review Focus 1); `unknown model gives null`.
  - `override beats the table`: `batteryOf({ vendor: 'Aqara', model: 'WSDCGQ11LM', batteryType: 'AA', batteryCells: 2 })` → `{ type: 'AA', cells: 2, source: 'override' }`; `batteryCells: null` → `cells: 1`.
  - `table fallback`: no override → `source: 'builtin'`.
  - `every entry is valid`: each value has a non-empty `type`, integer `cells` 1-8.

- [ ] **Step 3:** Run `npx vitest run src/lib/battery-types.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement** `battery-types.ts` with the researched table, one source URL comment per entry.

- [ ] **Step 5:** Run the test file, then `npm run check`. Expected: PASS, 0 errors.

- [ ] **Step 6: Commit** `feat: built-in battery type table`

### Task 2: Per-device override

**Files:**
- Modify: `src/lib/server/db/schema.ts` (`batteryType: text('battery_type')`, `batteryCells: integer('battery_cells')` on `devices`); new migration from `npx drizzle-kit generate`
- Modify: `src/lib/server/types.ts` (`DeviceState.batteryType: string | null`, `batteryCells: number | null`), `src/lib/server/mqtt/route.ts` (new-device literal sets both null), `src/lib/server/store.ts`, `src/lib/server/store.test.ts`
- Modify: `src/routes/devices/[ieee]/+page.server.ts`, `src/routes/devices/[ieee]/+page.svelte`
- Create: `src/lib/battery-form.ts`, `src/lib/battery-form.test.ts`

**Interfaces:**
- Consumes: `batteryOf`, `KNOWN_TYPES` (Task 1).
- Produces: `setBatteryType(db: Db, state: AppState, ieee: string, type: string | null, cells: number | null): boolean` in `store.ts` (writes both columns and memory, like `setTag`); `parseBatteryForm(form: FormData): { type: string | null; cells: number | null } | { field: 'type' | 'other' | 'cells'; message: string }` in `battery-form.ts` (`reset=1` → both null).

- [ ] **Step 1: Write the failing tests.**
  - `battery-form.test.ts`: `type=CR2032, cells=1` → `{ type: 'CR2032', cells: 1 }`; `type=Other, other='LR44 x3'` → `{ type: 'LR44 x3', cells }`; `other` of `''`, 21 characters, `'<b>'`, `'**x**'`, `'@everyone'` → `{ field: 'other', message: 'Use 1-20 letters, digits, spaces or -' }` (Review Focus 2); `cells` of `0`, `9`, `'x'` → `{ field: 'cells', message: 'Cells must be 1-8' }`; unknown `type` value → `{ field: 'type', ... }`; `reset=1` → `{ type: null, cells: null }`.
  - `store.test.ts`: `setBatteryType` writes memory and DB, `loadDevices` reloads both fields; returns false for an unknown ieee; setting null clears both.

- [ ] **Step 2:** Run both test files. Expected: FAIL.

- [ ] **Step 3: Implement** schema columns + migration, `DeviceState` fields (load in `loadDevices`; `flushDevices` does not write them, like tags), route literal, `setBatteryType`, `parseBatteryForm`.

- [ ] **Step 4: Device page.** Load adds `battery: batteryOf(d)` for battery devices. Action `batteryType`: `getDevice(params.ieee)` (404 for unknown, Review Focus 5), `parseBatteryForm`, `fail(400, { batteryError: { field, message } })` on error, else `setBatteryType`. Panel, after the Rechargeable switch, inside `{#if d.batteryPowered}`: text `CR2032 ×1 · built-in list` / `AAA ×2 · set by you` / `Unknown`; a form with the type select (`KNOWN_TYPES` + `Other`), an `Other` text input shown when `Other` is selected, a cells number input (min 1, max 8), Save, and a `Reset to built-in` button (`name="reset" value="1"`) only when the source is `override`. Same form classes as the existing Chatty/Rechargeable forms.

- [ ] **Step 5:** `npm test -- --run`, `npm run check`. Expected: pass.

- [ ] **Step 6: Commit** `feat: per-device battery type override`

### Task 3: Shopping list on the Batteries page and in the digest

**Files:**
- Modify: `src/lib/views.ts` (`BatteryRow` gains `batteryType` and `rechargeable`; `batteryRows` fills them; new `shoppingList`), `src/lib/views.test.ts`
- Modify: `src/routes/batteries/+page.server.ts`, `src/routes/batteries/+page.svelte`, `src/lib/server/notify/weekly.ts` (+ its test file)

**Interfaces:**
- Consumes: `batteryOf` (Task 1), `DeviceState.batteryType/batteryCells` (Task 2).
- Produces: `BatteryRow.batteryType: { type: string; cells: number } | null`, `BatteryRow.rechargeable: boolean`; `shoppingList(rows: BatteryRow[], days = 30): { buy: { type: string; count: number; devices: { ieee: string; name: string }[] }[]; recharge: { ieee: string; name: string }[]; unknown: { ieee: string; name: string }[] }`.

- [ ] **Step 1: Write the failing tests** in `views.test.ts`:
  - `sums cells per type`: three due rows `CR2032 ×1`, `CR2032 ×1`, `AAA ×2` and one due `AAA ×2` → `buy` = `[{ type: 'AAA', count: 4, ... }, { type: 'CR2032', count: 2, ... }]` (count descending, then type).
  - `not due rows are left out`: `low: false, daysLeft: 45` excluded; `daysLeft: 30` included.
  - `rechargeables go to recharge only`, including one with `batteryType: null` (Review Focus 3).
  - `unknown types go to unknown`.
  - `battery null but low via battery_low is due` (Review Focus 4): a row built by `batteryRows` from a device with `battery: null, batteryLow: true` and a known model lands in `buy`.
  - `empty`: no due rows → all three arrays empty.
  - Weekly digest test: with a due `CR2032` device and a due rechargeable, the batteries field reads `CR2032 ×1 (1 device)` then `Recharge: <name>`; field name `Batteries to buy`.

- [ ] **Step 2:** Run the test files. Expected: FAIL.

- [ ] **Step 3: Implement** `batteryRows` additions (via `batteryOf(d)` and `d.tags.includes('rechargeable')`), `shoppingList`, the digest field (groups as `${type} ×${count} (${n} device|devices)`, then `Recharge: a, b`, then `Type unknown: c`, one per line).

- [ ] **Step 4: Batteries page.** Load adds `shopping: shoppingList(rows)`. Above the existing sections, a `<section aria-labelledby="bat-shop">` titled `Shopping list`: blocks `Buy`, `Recharge`, `Type unknown` (each only when non-empty; device names link to `/devices/<ieee>`; unknown ones add "set the type"), or `Nothing to buy in the next 30 days.` when all are empty. The table gets a `Type` column after Name: `CR2032 ×1` or `—`.

- [ ] **Step 5:** `npm test -- --run`, `npm run check`. Expected: pass.

- [ ] **Step 6: Commit** `feat: battery shopping list grouped by type`

### Task 4: Live check (controller)

- [ ] Preview with the live DB (`REF=<branch> /tmp/mp-preview.sh up`): every battery model on the reference network shows a type on its device page (list any `Unknown`); set and reset one override; screenshot the Batteries page shopping list. Then the final whole-branch review, merge, version bump to `0.2.0`, tag `v0.2.0`, deploy.
