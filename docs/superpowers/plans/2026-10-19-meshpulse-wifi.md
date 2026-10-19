# MeshPulse Wi-Fi Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll any UniFi controller read-only for 2.4 GHz AP channels and airtime, flag APs overlapping the Zigbee channel, attach Wi-Fi context to Zigbee issues, and show it on a Wi-Fi page.

**Architecture:** A small UniFi client (both controller kinds) behind a 5-min poller (`startWifi`, beside the engine) writes `wifi_aps`/`wifi_samples` and `wifi_channel` events. Pure functions do overlap maths, area suggestions and the Wi-Fi snapshot; rules read `RuleContext.wifi`; the engine enriches newly opening Zigbee findings with a `wifi` evidence block.

**Tech Stack:** SvelteKit 3 (adapter-node), Svelte 5 runes, TypeScript strict, Vitest 4, Drizzle + better-sqlite3, Node `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-19-meshpulse-wifi-design.md`

## Global Constraints

- Built for any UniFi setup: UniFi OS consoles (`POST /api/auth/login`, API under `/proxy/network/api/s/<site>/…`, CSRF token) and self-hosted Network Applications (`POST /api/login`, API under `/api/s/<site>/…`); any site (default `default`); any AP and device naming. Nothing depends on a naming convention.
- Read-only towards UniFi: only the login, `GET …/stat/device`, and logout on shutdown. TLS verification disabled only for the configured controller host.
- Off by default (`wifiEnabled: false`); poll every 5 min; request timeout 15 s; never retry inside a poll (no login hammering).
- Password encrypted with `SECRET_KEY` via `encrypt`/`decrypt` (`src/lib/server/crypto.ts`), write-only (never sent to the browser).
- Thresholds: busy ≥ 60 % (`wifiBusyPct`) for 15 min; clear < 40 % (`wifiClearPct`) for 30 min. Samples kept 30 days.
- Frequencies: `zigbeeMHz(c) = 2405 + 5 (c − 11)`; `wifiMHz(n) = 2407 + 5 n` (n 1–13), `wifiMHz(14) = 2484`; overlap when |Δ| < width/2 + 1.
- Copy: overlap summary "<AP> uses Wi-Fi channel N, which overlaps Zigbee channel C"; action "Move the AP's 2.4 GHz radio to channel X in UniFi" (X = the non-overlapping channels among 1, 6, 11 joined with " or "); correlation line "Wi-Fi may be involved: <AP> on channel N (overlaps Zigbee C) was P % busy" or "… changed channel at HH:MM". Never "caused by".
- Areas optional and user-defined; suggestions are hints never applied without saving; no areas ⇒ "whole network".
- No new dependency. Server code relative imports; SvelteKit 3 `$app/env`; Svelte 5 runes; pages `<div class="page">` inside the layout's `<main>`; only classes from `src/app.css`.
- No request to the user's controller without the user's go-ahead in chat (the account and `/root/unifi-probe.env` already exist; capturing the fixture is approved as part of Task 1).
- Before each merge: `npx vitest run`, `npm run check`, `npm run build` pass.

## Review Focus

1. Wrong password / controller down for hours — one login attempt per 5-min poll, never a retry loop that could lock the account. Pinned in Task 2.
2. An AP without a 2.4 GHz radio (5 GHz-only, or radio disabled) — listed, ignored by rules, no crash. Pinned in Tasks 1 and 3.
3. Zigbee channel unknown (no `bridge/info` yet) — no overlap issue, page/tile say "Zigbee channel unknown". Pinned in Task 3.
4. An AP removed from UniFi — absent from a successful poll ⇒ its overlap/busy issues resolve; a renamed AP keeps its area (keyed by MAC). Pinned in Task 3.
5. A device matching two areas — correlation lists each nearby AP once. Pinned in Task 4.

---

## Milestone 2 — Client, poller, storage (branch `feat/wifi-m02-poller`)

### Task 1: UniFi client and parser

**Files:** Create `src/lib/server/wifi/unifi.ts`, `src/lib/server/wifi/unifi.test.ts`, `src/lib/server/wifi/fixtures/stat-device.json`.

**Interfaces — Produces:**
- `type ControllerKind = 'unifi-os' | 'network-app'`
- `interface WifiAp { mac: string; name: string; model: string; radio24: { channel: number; width: number; cuTotal: number | null; cuSelfRx: number | null; cuSelfTx: number | null; numSta: number | null; txPower: number | null } | null }`
- `parseDevices(json: unknown): WifiAp[]` — `type === 'uap'` only; `radio24` from `radio_table` entry with `radio: 'ng'` merged with the matching `radio_table_stats` entry (by `radio`); `width` from `ht` (number or numeric string, default 20); throws `Error('Unexpected stat/device response')` on a wrong shape.
- `createUnifi(opts: { url: string; site: string; user: string; password: string; transport?: Transport; timeoutMs?: number }): { devices(): Promise<WifiAp[]>; kind(): ControllerKind | null; version(): string | null; logout(): Promise<void> }` — first call logs in: try `POST /api/auth/login` (UniFi OS), on 404 try `POST /api/login` (Network App); remembers kind, cookie, `x-csrf-token`; on 401 from `stat/device` logs in once more and retries once, then throws. Errors (exact messages): `'Wrong user or password'` (401/400 on login), `'This account uses MFA — create a local account without MFA'` (login response mentions MFA/2FA, e.g. `meta.msg` containing `2fa`/`mfa`), `'Unknown site "<site>"'` (`api.err.NoSiteContext` / 400 on site path), `'Controller not reachable: <reason>'` (network error/timeout), `'Unexpected stat/device response'`. Transport: `type Transport = (req: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }) => Promise<{ status: number; headers: Record<string, string | string[]>; body: string }>`; the default transport uses Node's built-in `node:https`/`node:http` `request` with `rejectUnauthorized: false` for the configured host only (self-signed consoles), no new dependency. `createUnifi` takes `transport?: Transport` instead of `fetch`; tests inject a fake.

- [ ] **Step 0 (controller):** capture a real `stat/device` response read-only with the existing account into `fixtures/stat-device.json` (already approved).
- [ ] **Step 1: Failing tests:** `parseDevices` on the fixture → 6 APs with the probe's channels (6, 1, 6, 11, 1, 11) and `cuTotal` numbers; Review Focus 2 — an AP whose `radio_table` has only `na` → `radio24: null`; non-uap devices excluded; garbage → throws. Client with a fake transport: UniFi OS path (login → CSRF → `/proxy/network/api/s/default/stat/device`); Network App path (404 on `/api/auth/login` → `/api/login` → `/api/s/<site>/stat/device`); site other than `default` in the path; 401 then re-login once; each error message above.
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** verify tests, check, build. **Step 5:** commit `feat: add a read-only UniFi client`.

### Task 2: Settings, storage and poller

**Files:** Modify `src/lib/server/db/schema.ts` (+ migration via `npx drizzle-kit generate`), `src/lib/server/settings.ts`, `src/lib/server/retention.ts`, `src/lib/server/types.ts` (EventKind `wifi_channel`), `src/lib/server/events-page.ts` (label "Wi-Fi channel"), `src/lib/views.ts` (`formatDetail` for `wifi_channel`: "<ap>: channel A → B"), `src/lib/server/runtime.ts`, `src/routes/settings/+page.server.ts`, `src/routes/settings/+page.svelte`. Create `src/lib/server/wifi/poller.ts` (+ test), `src/lib/server/wifi/config.ts` (+ test).

**Interfaces — Produces:**
- Tables `wifiAps` (`mac` PK, `name`, `model`, `area` nullable, `lastSeen`), `wifiSamples` (`ts`, `mac`, `channel`, `width`, `cuTotal`, `cuSelfRx`, `cuSelfTx`, `numSta`, `txPower`; index `(mac, ts)`), `wifiAreas` (`name` PK, `match`).
- `DEFAULT_SETTINGS` gains `wifiEnabled: false`, `wifiBusyPct: 60`, `wifiClearPct: 40` (both in the PCT list; validation `wifiClearPct < wifiBusyPct`).
- `wifi/config.ts`: `getWifiConfig(db, secretKey): { url: string; site: string; user: string; password: string } | null` and `saveWifiConfig(db, secretKey, input: { url: string; site: string; user: string; password?: string })` — raw `settings` row `wifiConfig` (JSON; password stored encrypted; empty password keeps the stored one), like `weeklyDigestWeek` is raw.
- `poller.ts`: `pollWifi(deps: { db; state; config; client }, now): Promise<{ ok: true; aps: number } | { ok: false; error: string }>` — writes `wifiAps` (upsert by MAC, name/model/lastSeen; never touches `area`), one `wifiSamples` row per AP with a 2.4 GHz radio, a `wifi_channel` event when channel or width differs from that AP's previous sample. `startWifi(deps): { stop(): void }` — every 5 min when `wifiEnabled`, one poll at a time (in-flight flag), keeps `state.wifi = { lastOkAt: number | null; failures: number; lastError: string | null }`. Disabling stops polling; re-enabling creates a fresh client.
- Settings: section "Wi-Fi (UniFi)" (sub-menu entry) with Enabled, URL, Site, User, Password (write-only), thresholds, "Test connection" action (one `devices()` call; shows "Connected to <UniFi OS|Network Application>, site <s>: N access points" or the error), last poll status. The area UI comes in Task 3.

- [ ] **Step 1: Failing tests:** config round-trip (password encrypted at rest, empty keeps it, never in the page data); poller writes APs/samples/event on channel change; Review Focus 1 — with a client that always rejects, 12 polls (one hour) make exactly 12 login attempts and `failures` counts up, no retries in between; retention prunes 31-day samples.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** verify. **Step 5:** commit `feat: poll UniFi for 2.4 GHz radios`.

Milestone 2 merge: PR `feat: read-only UniFi poller`.

## Milestone 3 — Overlap, areas, rules (branch `feat/wifi-m03-rules`)

### Task 3: Overlap maths, areas and rules

**Files:** Create `src/lib/server/wifi/overlap.ts`, `src/lib/server/wifi/areas.ts`, `src/lib/server/wifi/snapshot.ts` (+ tests), `src/lib/server/rules/wifi.ts` (+ test). Modify `src/lib/server/rules/types.ts` (RuleIds + `RuleContext.wifi`), `rules/index.ts`, `src/lib/views.ts` (`RULE_LABELS`: "Wi-Fi overlaps Zigbee", "Busy Wi-Fi channel", "UniFi unreachable"), `src/lib/server/engine.ts`, settings page (areas + AP table).

**Interfaces — Produces:**
- `zigbeeMHz(c: number): number`, `wifiMHz(n: number): number`, `overlaps(zigbeeChannel: number, wifiChannel: number, widthMHz: number): boolean`, `freeChannels(zigbeeChannel: number): number[]` (non-overlapping among 1, 6, 11 at 20 MHz).
- `suggestArea(apName: string, areas: string[]): string | null` (spec rules: whole word, else unique in-order letters of a 3+-letter first token), `candidateAreas(deviceNames: string[], max = 20): string[]` (most common leading words — one word, or two when the second is "room" — appearing in ≥ 2 names), `areaOf(friendlyName: string, areas: { name: string; match: string }[]): string[]` (all areas whose `match` occurs, case-insensitive).
- `WifiSnapshot = { zigbeeChannel: number | null; fresh: boolean; aps: { mac: string; name: string; area: string | null; channel: number | null; width: number; overlaps: boolean; cuTotal: number | null; cuMaxHour: number | null; busyFor: number; clearFor: number; changedAt: number | null }[] }` built by `loadWifiSnapshot(db, state, now)`; `fresh` = a successful poll within 30 min. `busyFor`/`clearFor` = minutes the AP has continuously been ≥ busy / < clear threshold.
- `RuleContext.wifi?: WifiSnapshot & { enabled: boolean; failures: number; lastError: string | null }`.
- Rules (in `rules/wifi.ts`): `wifi.channel_overlap` (Warning, per AP mac as the issue key's ieee slot, `minRuns: 1`, `resolveRuns: 1`, notify), `wifi.busy_air` (Info, not notified; busyFor ≥ 15 → fire; hold until clearFor ≥ 30), `wifi.unreachable` (Info, network-level, not notified; failures ≥ 3). Off ⇒ none. Not fresh ⇒ return the currently open overlap/busy keys unchanged (hold). Zigbee channel null ⇒ no overlap/busy findings. AP absent from the latest successful poll ⇒ no finding (resolves).

- [ ] **Step 1: Failing tests:** overlap table (Zigbee 11 vs Wi-Fi 1 → true, 6 → false, 11 → false; Zigbee 25 vs Wi-Fi 11 → true at 20 MHz; 40 MHz widens); `freeChannels(11)` = [6, 11]; `suggestArea`: "Kitchen AP" → Kitchen, "AP Basement" → Basement, "bas-wap-upro-01" → Basement, "lvr-wap-ulr-01" → Living room, "dtc-…" → Datacenter, "U6-Lite" → null, "AP-1" → null, "70:a7:41:…" → null, ambiguous "ba" (Bathroom, Basement) → null; `candidateAreas` on sample names ("Living room lamp", "Living room sofa", "Basement stairs lamp", "Basement door") → ["Living room", "Basement"]; rules: fire, hold when stale, resolve on channel move, Review Focus 3 (Zigbee channel null), Review Focus 4 (AP absent, renamed AP keeps area by MAC), Review Focus 2 (AP with `radio24: null` ignored).
- [ ] **Step 2:** FAIL. **Step 3:** implement; engine loads the snapshot once per run.
- [ ] **Step 4: Settings:** area table (add, rename, remove; match defaults to name), "Suggest areas from device names" (adds `candidateAreas` as unsaved rows), AP table (name, model, area select incl. "Whole network", suggestion hint with an "Apply" button). Saved via a form action.
- [ ] **Step 5:** verify; commit `feat: Wi-Fi overlap rules and areas`.

Milestone 3 merge: PR `feat: Wi-Fi overlap rules and areas`.

## Milestone 4 — Correlation (branch `feat/wifi-m04-correlation`)

### Task 4: Wi-Fi context on Zigbee issues

**Files:** Create `src/lib/server/wifi/correlate.ts` (+ test). Modify `src/lib/server/engine.ts`, `src/lib/views.ts` (evidence label "Wi-Fi at the time").

**Interfaces — Produces:** `withWifi(findings: Finding[], open: Set<string>, snap: (RuleContext['wifi']) | undefined, areaOfDevice: (ieee: string) => string[], busyPct: number, tz: string, now: number): Finding[]` — for findings of `lqi.weak`, `lqi.degrading`, `route.failures`, `device.offline`, `device.flapping`, `network.route_errors`, `network.mass_offline` whose key is **not yet open**: adds `evidence.wifi` (APs in the device's areas, or all APs for network-level findings or devices with no area; each AP once) with channel, overlaps, cuTotal, cuMaxHour, changedAt (last 24 h); `"unavailable"` when not fresh; appends the spec's correlation line to `summary` when an overlapping AP's `cuMaxHour ≥ busyPct` or `changedAt` within the last hour. Wi-Fi off ⇒ findings unchanged. Engine calls it before lifecycle.

- [ ] **Step 1: Failing tests:** device in an area with an overlapping busy AP → evidence + line "Wi-Fi may be involved: bas-wap-upro-01 on channel 1 (overlaps Zigbee 11) was 72 % busy"; network issue → all APs; already-open key → untouched; stale → "unavailable", no line; channel change 20 min ago → "changed channel at HH:MM"; Review Focus 5 — device matching two areas sharing one AP lists it once; Wi-Fi off → identical findings.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** verify; issue page renders the `wifi` block via `KV` (list of AP rows). **Step 5:** commit `feat: Wi-Fi context on Zigbee issues`.

Milestone 4 merge: PR `feat: Wi-Fi context on Zigbee issues`.

## Milestone 5 — UI (branch `feat/wifi-m05-ui`)

### Task 5: Wi-Fi page, Overview tile, device page line

**Files:** Create `src/routes/wifi/+page.server.ts`, `+page.svelte`, `src/lib/wifi-band.ts` (+ test). Modify `src/routes/+page.server.ts`, `+page.svelte`, `src/routes/devices/[ieee]/+page.server.ts`, `+page.svelte`, `src/app.css` (only the band-diagram rules).

**Interfaces — Produces:** `bandLayout(zigbeeChannel: number | null, aps: { name: string; channel: number; width: number; overlaps: boolean }[], w: number): { zigbee: { x: number } | null; bars: { name: string; x: number; width: number; overlaps: boolean; row: number }[] }` — 2400–2484 MHz across `w`; bars stacked into rows so none overlap visually.

- [ ] **Step 1: Failing tests:** `bandLayout` positions (channel 1 at 20 MHz spans 2402–2422), Zigbee 11 marker at 2405, two APs on the same channel in different rows, null Zigbee channel → no marker.
- [ ] **Step 2:** FAIL. **Step 3: Page** `/wifi` per spec UI (header, band diagram, AP table with 24 h `Sparkline` of `cu_total`, "Overlaps Zigbee" tag, last channel change, Zigbee devices in area linked to `/devices?q=<match>`, "—" without area); empty states: Wi-Fi off (what it does + link to Settings), never polled, last poll failed (error). Overview tile "Wi-Fi 2.4 GHz" (hidden when off; "Zigbee channel unknown" when null). Device page line "Nearby Wi-Fi: <AP> · channel N (overlaps) · P % busy" per AP in its areas.
- [ ] **Step 4:** verify; **Step 5:** commit `feat: Wi-Fi page`.

Milestone 5 merge: PR `feat: Wi-Fi page`.

## Milestone 6 — Docs, deploy, switch-on (branch `feat/wifi-m06-deploy`)

### Task 6: Docs and rollout (controller-led)

- [ ] README: "Wi-Fi interference (UniFi, optional)" — what it does, creating a local View Only account without MFA, both controller kinds, site, areas optional. CLAUDE.md: `wifi/` modules, tables, `/wifi`. Spec link in the authority line.
- [ ] Verify; PR `docs: describe Wi-Fi correlation`; merge; deploy.
- [ ] With the user: enter the account in Settings, Test connection, enable; check the first poll creates overlap Warnings for the two channel-1 APs (basement, shed) and nothing else; screenshot `/wifi`, the tile and Settings on live data.
