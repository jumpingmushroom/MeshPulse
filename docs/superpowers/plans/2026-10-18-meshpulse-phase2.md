# MeshPulse Phase 2 (Trends) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hourly rollups and baselines, link-quality, route-error and battery-forecast rules, Device and Batteries pages with SVG charts, and an Apprise channel to the running MeshPulse MVP.

**Architecture:** An hourly job (in `startEngine`, next to prune) rolls raw samples and an in-memory message counter into `samples_hourly`, then recomputes `baselines` (LQI mean/stddev, network route errors per hour, and battery days-left). The 60 s rules read a small `history` snapshot (last 24 h of hourly rows + all baselines) added to `RuleContext`, plus `route_error` events already in `ctx.events`. Pages read the same tables.

**Tech Stack:** unchanged — SvelteKit 3 / Svelte 5, TypeScript strict, Drizzle + better-sqlite3, mqtt.js, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-meshpulse-phase2-design.md` (Phase 2 design; wins over `docs/SPEC.md`). Research: `docs/superpowers/research/2026-10-18-z2m-route-errors.md`.

## Global Constraints

- Read-only on MQTT; storage keyed by IEEE; timestamps UTC epoch ms; display in `TZ`.
- Server code uses relative imports. SvelteKit 3: `$app/env`. No new dependency.
- Severity `'info' | 'warning' | 'critical'`. New rule ids exactly: `lqi.weak`, `lqi.degrading`, `route.failures`, `network.route_errors`, `battery.forecast`.
- `lqi.weak` is never Critical. `battery.forecast` never notifies.
- Retention: `samples_hourly` 365 days; route-error events use the existing 90-day event retention.
- New settings and defaults (exact): `lqiWeak 30, lqiWeakClear 40, lqiMinHours 6, lqiDegradePct 25, lqiRecoverPct 10, baselineMinDays 3, routeFailWarn 5, routeFailCrit 20, routeFailClear 2, netRouteFactor 3, netRouteMin 10, netRouteClearFactor 1.5, forecastTargetPct 10, forecastWarnDays 21, forecastClearDays 30, forecastMinDays 7`.
- Git: branch per milestone `feat/p2-mNN-<slug>`, conventional commits, squash-merged PRs, no AI attribution. Paseo ticket per milestone (T02–T09).

## Review Focus

1. Sleepy end devices with LQI in only 1–5 of the last 24 hours → no `lqi.*` finding (Task 2, `needs data in at least 6 hours`).
2. Battery that reports in steps or stays flat (100, 100, 67…) or was just swapped → no forecast from a flat or post-swap-only < 7-day series (Task 3, `flat series has no forecast`, `swap resets the fit`).
3. Route error naming a device that is unknown or removed → counted network-wide, no crash, no device issue (Task 7, `unknown device counts network-wide only`).
4. Chart with 0 or 1 data points or long gaps → shows "No data" / breaks the line at gaps, never emits `NaN` in SVG (Task 5, `buildSeries handles empty, single and gapped input`).
5. Apprise API down or returning 4xx, and Apprise URLs containing tokens → retries then failed, tokens never in `lastError` or the browser (Task 4, `redacts apprise urls in errors`).

---

## File map

```
src/lib/server/db/schema.ts            + samplesHourly, baselines
src/lib/server/trends/rollup.ts        rollupHours(db, state, now), computeBaselines(db, now)
src/lib/server/trends/forecast.ts      forecastDaysLeft(points, now, targetPct, minDays)
src/lib/server/trends/history.ts       loadHistory(db, now) -> History
src/lib/server/rules/lqi.ts            lqiWeak, lqiDegrading
src/lib/server/rules/route.ts          routeFailures, networkRouteErrors
src/lib/server/rules/forecast.ts       batteryForecast
src/lib/server/mqtt/logparse.ts        parseRouteError(payload)
src/lib/server/notify/apprise.ts       apprise: Channel, toApprisePayload()
src/lib/chart.ts                        buildSeries(), niceTicks()
src/lib/components/LineChart.svelte     SVG chart
src/routes/devices/[ieee]/              Device page
src/routes/batteries/                   Batteries page
```

---

### Task 1: Hourly rollups and baselines (Milestone 02, T02)

**Files:**
- Modify: `src/lib/server/db/schema.ts`, `src/lib/server/types.ts` (AppState.msgCounts), `src/lib/server/mqtt/route.ts` (count live device messages), `src/lib/server/engine.ts` (hourly job), `src/lib/server/retention.ts`, `drizzle/` (generated)
- Create: `src/lib/server/trends/rollup.ts`
- Test: `src/lib/server/trends/rollup.test.ts`, `src/lib/server/retention.test.ts`, `src/lib/server/mqtt/route.test.ts`

**Interfaces:**
- Produces:
  - Tables: `samplesHourly { ieee, hour, lqiMin, lqiAvg, lqiMax, batteryMin, voltageMin, msgCount }` PK (ieee, hour); `baselines { ieee ('' = network), metric, value: real, days: integer, computedAt }` PK (ieee, metric).
  - `type BaselineMetric = 'lqi_mean' | 'lqi_stddev' | 'route_errors_hourly' | 'battery_days_left'`.
  - `AppState.msgCounts: Map<string, number>` keyed `` `${ieee}|${hourStart}` ``; `createState` initialises it.
  - `hourStart(ts: number): number` (floor to the hour, UTC) exported from `rollup.ts`.
  - `rollupHours(db: Db, state: AppState, now: number): void` — for each complete hour in `[hourStart(now) − 48 h, hourStart(now))` that has samples or counts: upsert one `samples_hourly` row per device (min/avg/max of `samples.lqi`, min battery, min voltage, count from `msgCounts`, then delete those counter keys). Never touches the current hour.
  - `computeBaselines(db: Db, now: number): void` — window `[now − 8 d, now − 24 h)`: per device `lqi_mean`, `lqi_stddev` (population) of `lqi_avg`, `days` = distinct UTC days with data; network `route_errors_hourly` = mean route_error events per hour over the window (0 when none), `days` = distinct days in the window with any event or sample. Upsert, `computedAt = now`. (`battery_days_left` is added by Task 3.)
  - Engine: `startEngine` runs `rollupHours` then `computeBaselines` when `hourStart(now) > lastTrendHour` (in-memory, own try/catch like prune).
- Router: every live (non-retained) message on a known device topic increments `state.msgCounts`.

- [ ] **Step 1:** `git switch -c feat/p2-m02-rollups`. Failing tests in `rollup.test.ts` (in-memory DB via `openDb(':memory:')`):
  - `rolls up a complete hour` — 3 samples at 10:05/10:20/10:50 with lqi 100/80/90, battery 60/59/58 → one row: `lqiMin 80, lqiAvg 90, lqiMax 100, batteryMin 58`, `msgCount` = counter value 7, counter key removed.
  - `never rolls up the current hour` and `rerun is idempotent` (second call → same single row).
  - `catch-up is bounded to 48 h` (sample 50 h ago → no row).
  - `baseline excludes the last 24 h` — `now` = 2026-10-18T12:00Z; hourly rows with lqi_avg 100 every hour in `[now − 8 d, now − 24 h)` and lqi_avg 10 every hour in the last 24 h → `lqi_mean 100`, `lqi_stddev 0`, `days 8` (the window touches 8 UTC calendar days: Oct 10 12:00 → Oct 17 12:00).
  - `network route_errors_hourly is the mean per hour` — 48 route_error events spread over the window of 144 h → `value ≈ 0.333`.
- [ ] **Step 2:** route.test.ts `counts live device messages per hour` (2 live + 1 retained in one hour → count 2). retention.test.ts `prunes samples_hourly after 365 days`.
- [ ] **Step 3:** Run → FAIL. Implement schema, `npx drizzle-kit generate --name=phase2_trends`, rollup, router counter, engine hourly job, retention. Run `npx vitest run` → PASS; `npm run check` → 0 errors.
- [ ] **Step 4:** Commit `feat: add hourly rollups and baselines`.

### Task 2: History snapshot, link-quality rules, notify flag (Milestone 03, T03)

**Files:**
- Create: `src/lib/server/trends/history.ts`, `src/lib/server/rules/lqi.ts`
- Modify: `src/lib/server/rules/types.ts`, `src/lib/server/rules/index.ts`, `src/lib/server/issues/lifecycle.ts`, `src/lib/server/engine.ts`, `src/lib/server/settings.ts` (+ form validation), `src/routes/settings/+page.svelte` (threshold fields), `tests/helpers/ctx.ts`, `tests/helpers/simulate.ts`
- Test: `src/lib/server/rules/lqi.test.ts`, `src/lib/server/trends/history.test.ts`, `src/lib/server/issues/lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, `BaselineMetric`.
- Produces:
  - `interface HourlyRow { hour: number; lqiMin: number|null; lqiAvg: number|null; lqiMax: number|null; batteryMin: number|null; voltageMin: number|null; msgCount: number }`
  - `interface History { hourly: Map<string, HourlyRow[]>; baselines: Map<string, { value: number; days: number }> }` — `hourly` holds the last 24 h per device, ascending; `baselines` keyed `` `${ieee}|${metric}` `` (network: `` `|route_errors_hourly` ``).
  - `loadHistory(db: Db, now: number): History`; `baselineOf(h: History, ieee: string, metric: BaselineMetric)`.
  - `RuleContext.history: History` (engine loads it each run; test helpers default to empty maps).
  - `RuleId` adds all five new ids; `RULE_DEFAULTS` entries gain `notify: boolean` (all existing true). New: `lqi.weak`/`lqi.degrading` `{minRuns 2, resolveRuns 2, deviceLevel true, notify true}`.
  - Lifecycle: when `RULE_DEFAULTS[rule].notify` is false, opens/updates/resolves happen but no `Notify` is emitted and `lastNotifiedAt` stays null.
  - Settings: add the Task-2 keys from Global Constraints (`lqi*`, `baselineMinDays`); validation: `lqiWeak < lqiWeakClear`, all > 0, `lqiDegradePct`/`lqiRecoverPct` 0–100.
- Rule behaviour (spec table): averages are means of `lqiAvg` over hours with data; "≥ 6 hours with data" applies to both rules; stop windows use the last 12 hours.

- [ ] **Step 1:** `git switch -c feat/p2-m03-lqi`. Failing tests in `lqi.test.ts`:
  - `lqi.weak fires below 30 with 6+ hours of data` (6 hours avg 25 → warning); `needs data in at least 6 hours` (5 hours avg 10 → nothing); `never critical` (avg 5 → severity warning); `stops only above 40 over 12 h` (open + 12 h avg 35 → still fires; 41 → stops).
  - `lqi.degrading fires 25% below baseline` (baseline 100, days 3, 24 h avg 74 → warning; 76 → nothing); `needs 3 days of baseline` (days 2 → nothing); `recovers within 10%` (open, 12 h avg 91 → stops; 89 → fires).
  - `removed, ignored and muted handling unchanged` via `evaluateRules`.
- [ ] **Step 2:** `history.test.ts`: `loads last 24 h ascending and all baselines`. Add `battery.forecast` to `RULE_DEFAULTS` now with `{ minRuns 1, resolveRuns 2, deviceLevel true, notify false }` (its rule comes in Task 3), and `route.failures` `{2, 2, true, true}`, `network.route_errors` `{2, 2, false, true}`. `lifecycle.test.ts`: `notify:false rule opens and resolves silently` — a `battery.forecast` finding opens after 1 run with no Notify and `lastNotifiedAt` null; when missing for 2 runs it resolves with no Notify.
- [ ] **Step 3:** Run → FAIL; implement; run all → PASS; `npm run check` clean. Commit `feat: add link-quality rules and history snapshot`.

### Task 3: Battery forecast (Milestone 04, T04)

**Files:**
- Create: `src/lib/server/trends/forecast.ts`, `src/lib/server/rules/forecast.ts`
- Modify: `src/lib/server/trends/rollup.ts` (`computeBaselines` adds `battery_days_left`), `src/lib/server/rules/index.ts`, settings (+ form)
- Test: `src/lib/server/trends/forecast.test.ts`, `src/lib/server/rules/forecast.test.ts`

**Interfaces:**
- Produces:
  - `forecastDaysLeft(points: { t: number; battery: number }[], now: number, targetPct: number, minDays: number): number | null` — least-squares line; `null` when span < `minDays`, slope ≥ 0, or < 2 points; otherwise days from `now` until the line reaches `targetPct` (0 when already below).
  - `computeBaselines` writes `battery_days_left` per battery device: points = `samples_hourly.batteryMin` over the last 30 days **after the latest `battery_swap` event**; `days` = span in days. No row (delete stale) when `null`.
  - Rule `batteryForecast`: `battery.forecast` fires (info) when `battery_days_left` ≤ `forecastWarnDays`; when open, stops only when > `forecastClearDays` or the baseline row is gone. Summary e.g. `"Battery in Kitchen sensor runs out in about 18 days"`, action `"Buy a replacement battery"`, evidence `{ daysLeft, basedOnDays }`.

- [ ] **Step 1:** `git switch -c feat/p2-m04-forecast`. Failing tests: `forecast.test.ts` — `steady 1%/day from 40 reaches 10 in 30 days`; `flat series has no forecast`; `less than 7 days has no forecast`; `already below target returns 0`. Rollup baseline test `swap resets the fit` (decline 80→20 over 20 days, swap event, then 3 days at 100 → no `battery_days_left` row). Rule tests: fires at 21, not at 22; open stays at 25, stops at 31; info severity; and through lifecycle **no notify**.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean. Commit `feat: add battery forecast`.

### Task 4: Apprise channel (Milestone 05, T05)

**Files:**
- Create: `src/lib/server/notify/apprise.ts`
- Modify: `src/lib/server/notify/outbox.ts` (register `apprise` in `CHANNELS`; redact Apprise URLs too), `src/routes/settings/+page.server.ts` (+ actions `saveApprise`, `testApprise`), `src/routes/settings/+page.svelte`
- Test: `src/lib/server/notify/apprise.test.ts`, `src/lib/server/notify/outbox.test.ts`, settings validation test

**Interfaces:**
- Consumes: `Channel`, `Message`, `ChannelError`, `encrypt/decrypt`, `sendTest`.
- Produces:
  - Channel config `{ apiUrl: string; key?: string; urls?: string /* encrypted, newline-separated */ }`, kind `'apprise'`.
  - `toApprisePayload(m: Message): { title: string; body: string; type: 'failure'|'warning'|'info'|'success'; format: 'markdown'; urls?: string }` — type: critical→failure, warning→warning, info→info, resolved→success; body = summary, blank line, `**Suggested action:** …` if any, fields as `- **name:** value`, link if `url`.
  - Send: `key` set → `POST {apiUrl}/notify/{key}`; else `POST {apiUrl}/notify` with `urls`. Non-2xx → `ChannelError` (429 with `Retry-After` → `retryAfterMs`).
  - Settings form: `apiUrl` must be `http(s)://…`; `key` matches `^[A-Za-z0-9_-]{1,64}$`; exactly one of key/urls; urls never returned to the browser (show "configured"); empty urls field keeps the stored value; minSeverity + enabled like Discord.
- Existing redaction (`https?://\S+`) must also cover Apprise schemes in errors: redact `\b[a-z][a-z0-9+.-]*://\S+` in `lastError` and test results.

- [ ] **Step 1:** `git switch -c feat/p2-m05-apprise`. Failing tests: `maps severities to apprise types`; `posts to /notify/<key> with a stored key`; `posts urls to /notify when no key`; `429 sets retryAfterMs`; `redacts apprise urls in errors` (`tgram://123:abc/…` in an error → `<url>`); settings `rejects both key and urls`, `rejects non-http apiUrl`.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean.
- [ ] **Step 3:** No live send here; the real Send test through the user's apprise-api happens in Task 8.
- [ ] **Step 4:** Commit `feat: add Apprise channel`.

### Task 5: Device page and charts (Milestone 06, T06)

**Files:**
- Create: `src/lib/chart.ts`, `src/lib/components/LineChart.svelte`, `src/routes/devices/[ieee]/+page.server.ts`, `src/routes/devices/[ieee]/+page.svelte`
- Modify: `src/routes/devices/+page.svelte` (names link), `src/routes/issues/[id]/+page.svelte` (device name links), `src/lib/server/store.ts` (`setIgnored(db, state, ieee, on)`), `src/app.css`
- Test: `src/lib/chart.test.ts`, `src/lib/server/store.test.ts`

**Interfaces:**
- Produces:
  - `type Point = { t: number; v: number | null; lo?: number | null; hi?: number | null }`
  - `buildSeries(points: Point[], box: { w: number; h: number; t0: number; t1: number; y0: number; y1: number }, maxGapMs: number): { line: string; band: string; empty: boolean }` — SVG path strings; a new `M` segment after any gap > `maxGapMs` or null value; `empty` when no finite values; never contains `NaN`.
  - `niceTicks(min: number, max: number, count: number): number[]`.
  - `LineChart.svelte` props: `{ title, unit, points: Point[], t0, t1, y0, y1, maxGapMs, refs?: { y: number; label: string }[], summary: string }` — renders `<figure>` with `<svg role="img" aria-label={summary}>`, `<figcaption>`, "No data" when empty.
  - Device page load `?range=24h|7d|30d` (default 24h): 24h from raw `samples` (maxGap 30 min), 7d/30d from `samples_hourly` (maxGap 3 h); LQI (avg + min/max band, refs: baseline mean if any, `lqiWeak`), battery % and voltage (battery devices only), messages/hour (hourly only; 24 h uses hourly too); forecast from `battery_days_left`, last swap from events; last 50 events for the device; open issues. 404 for unknown IEEE.
  - Actions: `mute` (reuse `muteUntil`), `ignore` (`setIgnored` writes tags json and `state.devices` in memory).
  - Before charts, read the `dataviz` skill and follow its palette and mark rules.

- [ ] **Step 1:** `git switch -c feat/p2-m06-device`. Failing tests: `buildSeries handles empty, single and gapped input` (empty → `empty: true`, `line === ''`; single point → `M x,y` only; gap > maxGap → two `M` segments; null value breaks the line; output has no `NaN`); `niceTicks(0, 255, 5)` → `[0, 50, 100, 150, 200, 250]`; store `setIgnored toggles tag in DB and memory`.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean.
- [ ] **Step 3:** Browser check (controller): screenshot a router and a battery device page on 24h and 7d. Commit `feat: add device page with charts`.

### Task 6: Batteries page and navigation (Milestone 07, T07)

**Files:**
- Create: `src/routes/batteries/+page.server.ts`, `src/routes/batteries/+page.svelte`
- Modify: `src/routes/+layout.svelte` (menu: Overview, Devices, Batteries, Issues, Settings), `src/lib/views.ts` (`batteryRows`)
- Test: `src/lib/views.test.ts`

**Interfaces:**
- Produces: `batteryRows(devices: DeviceState[], daysLeft: Map<string, number>, lastSwap: Map<string, number>): BatteryRow[]` — battery-powered, non-removed devices; sorted by days left ascending, devices without a forecast last (then by battery % ascending). Page shows name (link), battery %, voltage, days left ("—" when none), last swap, 30-day sparkline (`LineChart` small variant or `buildSeries` inline).

- [ ] **Step 1:** `git switch -c feat/p2-m07-batteries`. Failing tests: `sorts by days left, unknown last`; `excludes mains and removed devices`.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean; screenshot. Commit `feat: add batteries page`.

### Task 7: Log parser and route rules (Milestone 08, T08)

Starts after the 24 h recording on Unraid finishes (`/mnt/user/appdata/meshpulse-capture/z2m-*.jsonl`). The controller extracts its `bridge/logging` lines into `tests/fixtures/z2m-logging.jsonl` before dispatch (all distinct message shapes that contain `fail`, `error`, `timeout`, `MAC_`, `NWK_`, plus 20 ordinary lines).

**Files:**
- Create: `src/lib/server/mqtt/logparse.ts`, `src/lib/server/rules/route.ts`, `tests/fixtures/z2m-logging.jsonl`
- Modify: `src/lib/server/mqtt/route.ts` (handle `bridge/logging`), `src/lib/server/types.ts` (`EventKind` + `'route_error'`; `AppState.pingFails: Map<string, number>` for dedupe), `src/lib/server/rules/index.ts`, settings (+ form)
- Test: `src/lib/server/mqtt/logparse.test.ts`, `src/lib/server/mqtt/route.test.ts`, `src/lib/server/rules/route.test.ts`

**Interfaces:**
- Produces:
  - `parseRouteError(payload: unknown): { kind: 'command_failed' | 'ping_failed'; code: string | null; ieee: string | null; name: string | null; final: boolean } | null` — patterns from the research file, confirmed against the fixture; `final` true for ping attempt `n/n`.
  - Router: `bridge/logging` → parse; resolve IEEE (direct, else `byName`); `ping_failed` counts only when `final` or, if attempts are not numbered, once per device per 60 s; emits event `{ kind: 'route_error', ieee (or null), detail: { kind, code } }`.
  - Rules: `route.failures` per device (count of `route_error` events in `ctx.events` for the device): warning ≥ `routeFailWarn`, critical ≥ `routeFailCrit`, when open stops at < `routeFailClear`. `network.route_errors` (not device-level): errors in the last hour > `netRouteFactor` × `route_errors_hourly` and ≥ `netRouteMin`, baseline days ≥ `baselineMinDays`; when open stops when each of the last 2 hours < `netRouteClearFactor` × baseline.

- [ ] **Step 1:** `git switch -c feat/p2-m08-route`. Failing tests: parser — every research example line; every fixture line that is a real failure parses, every ordinary fixture line returns `null`; `ping retries count once`. Router — `unknown device counts network-wide only` (event with `ieee: null`, no throw). Rules — route.failures 4 → none, 5 → warning, 20 → critical, open + 1 → stops; network — 30 errors/h with baseline 5 and days 3 → warning; 9/h with baseline 0.5 → none (min 10); days 2 → none.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean. Commit `feat: add route-error parsing and rules`.

### Task 8: Deploy and docs (Milestone 09, T09)

**Files:** Modify `README.md` (features, Batteries/Device pages, Apprise setup, thresholds), `CLAUDE.md` (file map: trends/, chart.ts, components/, new rules), `unraid/meshpulse.xml` (no change expected).

- [ ] **Step 1:** `git switch -c feat/p2-m09-deploy`. Update docs. Run `npx vitest run`, `npm run check`, `npm run build` → all green. Commit `docs: describe Phase 2 features`; PR; merge.
- [ ] **Step 2 (controller):** rebuild the image on Unraid and recreate the MeshPulse container from its template (same procedure as the MVP deploy); verify healthy, `samples_hourly` rows appear after the next full hour, the Device and Batteries pages load, and an Apprise Send test succeeds through `http://192.168.3.3:8001` once the user has entered a key or URLs.
