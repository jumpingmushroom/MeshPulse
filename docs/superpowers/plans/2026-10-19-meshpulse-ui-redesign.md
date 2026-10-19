# MeshPulse UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every MeshPulse page after the user's Claude Design mockup, on live data, dark and light.

**Architecture:** The mockup's stylesheet becomes the global `src/app.css`; pages are rewritten to its classes; repeated pieces are small Svelte components in `src/lib/components/`. New logic lives in pure helpers in `src/lib/views.ts` (unit-tested) and two small server helpers; rules, lifecycle and schema do not change.

**Tech Stack:** SvelteKit 3 (adapter-node), Svelte 5 runes, TypeScript strict, Vitest 4, Drizzle + better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-10-19-meshpulse-ui-redesign-design.md` (mockup: `docs/superpowers/design/meshpulse-mockup.html`)

## Global Constraints

- No dependency beyond the stack; no external font host — Inter woff2 served from `static/fonts/`.
- Read-only on MQTT. No network map, no "Network map" button, no "Active features" (Q10). No battery cell type, no shopping list (Q11). No `seasonal` tag. No theme switch.
- Rules, lifecycle and DB schema unchanged. Loaders may add fields from existing tables.
- Works without JS: filters, sorting, tabs, paging, density are links / GET forms; collapsing is `<details>`. JS-only: Copy button, the seconds counter.
- Server code uses relative imports. SvelteKit 3: `$app/env`. Svelte 5 runes.
- Copy is the mockup's unless this plan pins different text. Live values replace the mockup's sample values.
- Chatty help text: "Leaves this device out of the 'dominant' check."
- Before each merge: `npx vitest run`, `npm run check`, `npm run build` all pass.

## Mockup reference

The mockup is a bundle; Task 1 Step 1 extracts its parts to
`docs/superpowers/design/`:

- `meshpulse.css` — the MeshPulse stylesheet (the template's second `<style>` block)
- `mockup-app.js` — the mockup's page code (`text/x-dc` script): the markup and copy for every page, per `page === '…'` branch
- `icons.svg` — the `<symbol>` sprite

Implementers read the matching branch of `mockup-app.js` for markup and copy. To view a page:
serve the mockup HTML over HTTP and open `?page=<overview|devices|device|issues|issue|batteries|events|settings|login>&s=<healthy|attention|critical|stale|learning>&theme=<dark|light>`.

## Review Focus

1. A device with no samples at all (new or never reporting LQI) — every column and chart shows "—", never `NaN` or `0`. Pinned in Task 5 (`deviceStats` test) and Task 3 (`peakQuiet([])`).
2. MQTT lost while pages are open — top bar says Stale and the strip shows; the Overview still renders from the frozen state. Pinned in Task 1 (`navSummary` stale test).
3. An issue whose rule has no chart, or whose device was removed — Issue page renders without chart and without the mute panel. Pinned in Task 4 (`chartFor` test).
4. Settings form with several bad values — every bad field is marked, nothing saved, typed values kept. Pinned in Task 8 (`parseSettingsForm` errors test).
5. Names with HTML or very long names (Z2M friendly names are user text) — rendered as text, wrap without breaking the table. Svelte escapes; checked in screenshots with the longest live name.

---

## Milestone 1 — Foundation (branch `feat/ui-m1-foundation`)

### Task 1: Stylesheet, fonts, icons, top bar, stale strip

**Files:**
- Create: `docs/superpowers/design/meshpulse.css`, `docs/superpowers/design/mockup-app.js`, `docs/superpowers/design/icons.svg` (extracted, reference only)
- Replace: `src/app.css`
- Create: `static/fonts/inter-latin-{400,500,600}.woff2`, `src/lib/components/Icons.svelte`
- Modify: `src/routes/+layout.svelte`, `src/routes/+layout.server.ts`, `src/lib/views.ts`
- Test: `src/lib/views.test.ts`

**Interfaces:**
- Produces: `navSummary(open: { severity: Severity; parentIssueId: number | null }[], monitor: { connected: boolean; downSince: number | null }): { count: number; worst: Severity | null; stale: boolean; staleSince: number | null }` in `src/lib/views.ts`. Layout data gains `nav: ReturnType<typeof navSummary>` and `lastMessageAt: number | null` (the value `/api/health` reports).
- Produces: icon ids from the sprite (`#i-ok`, `#i-warn`, `#i-crit`, `#i-info`, …) usable as `<svg class="icon"><use href="#i-warn" /></svg>`.

- [ ] **Step 1: Extract the mockup parts.** From `docs/superpowers/design/meshpulse-mockup.html`: the manifest is JSON in `<script type="__bundler/manifest">`; the template is a JSON string in `<script type="__bundler/template">`. In the template, the second `<style>` block is `meshpulse.css`; the `<script type="text/x-dc">` body is `mockup-app.js`; the `<symbol>`s inside the hidden `<svg>` are `icons.svg`. Font assets are manifest entries with `mime: font/woff2`; take the three Latin subsets (unicode-range starting `U+0000-00FF`) for weights 400, 500, 600.
- [ ] **Step 2: Write the failing test** in `src/lib/views.test.ts`:

```ts
describe('navSummary', () => {
	const i = (severity: Severity, parentIssueId: number | null = null) => ({ severity, parentIssueId });
	it('counts top-level issues and picks the worst severity', () => {
		expect(navSummary([i('warning'), i('critical', 1), i('info')], { connected: true, downSince: null }))
			.toEqual({ count: 2, worst: 'warning', stale: false, staleSince: null });
	});
	it('is stale while MQTT is down', () => {
		expect(navSummary([], { connected: false, downSince: 1000 })).toEqual({ count: 0, worst: null, stale: true, staleSince: 1000 });
	});
});
```

- [ ] **Step 3: Run** `npx vitest run src/lib/views.test.ts` — FAIL (navSummary not defined).
- [ ] **Step 4: Implement `navSummary`.** Children (non-null `parentIssueId`) are not counted, matching the score rule.
- [ ] **Step 5: Port the stylesheet.** `src/app.css` = `meshpulse.css` minus `.map` rules, with `@font-face` reduced to the three Latin files at `/fonts/inter-latin-<w>.woff2`. `Icons.svelte` renders the sprite in a hidden `<svg>`.
- [ ] **Step 6: Rewrite the layout** to the mockup's top bar (`.topnav`, `.brand`, `.navlinks`, `.nav-count` with the worst severity's class, `.nav-end`, `.updated`): six links, Sign out form unchanged. `.updated` shows "Updated N s ago", counting from the last load with a 1 s `$effect` interval; server-rendered text is "Updated HH:MM:SS". When `nav.stale`: `.updated` reads "Stale · last update HH:MM" and a `.stale-note` strip under the bar reads "MeshPulse lost its MQTT connection N min ago. Nothing on this page is live — data is frozen at HH:MM." The 15 s `invalidateAll` stays. The root element is `<div class="mp">`.
- [ ] **Step 7: Verify** `npx vitest run`, `npm run check`, `npm run build` pass; open the dev server and confirm the bar renders on every page (old page bodies may look plain — they are restyled in later tasks).
- [ ] **Step 8: Commit** `feat: port the design stylesheet and top bar`

### Task 2: Shared components and labels

**Files:**
- Create: `src/lib/components/{SevBadge,IssueRow,Tile,ScoreRing,Sparkline,KV}.svelte`
- Modify: `src/lib/components/LineChart.svelte`, `src/lib/views.ts`
- Test: `src/lib/views.test.ts`

**Interfaces:**
- Consumes: icon ids from Task 1.
- Produces in `src/lib/views.ts`:
  - `RULE_LABELS: Record<RuleId, string>` — every `RuleId` in `src/lib/server/rules/types.ts` (import the type only), e.g. `'battery.low': 'Battery low'`, `'lqi.weak': 'Weak link'`, `'device.offline': 'Device offline'`, `'network.mass_offline': 'Mass offline'`.
  - `scoreLabel(status: Status): 'Good' | 'Fair' | 'Poor'` (green/amber/red).
  - `groupedSummary(children: { rule: string }[]): string` — e.g. `"7 grouped issues: 1 device offline, 6 device silent"`; counts per rule label, lower-cased, in descending count; singular "1 grouped issue: …".
- Produces components (props):
  - `SevBadge { severity: Severity; large?: boolean }` — `.sev .is-crit|.is-warn|.is-info`, icon + "Critical" / "Warning" / "Info".
  - `IssueRow { issue: { id: number; severity: Severity; state: string; summary: string; action?: string; ieee: string | null; deviceName?: string; rule: string; openedAt: number }; now: number; children?: { id: number; summary: string; rule: string }[] }` — `.issue` markup from the mockup; action line only if `action` given; children in `<details class="issue-children">` with `groupedSummary` as `<summary>`.
  - `Tile { label: string; value: string; total?: string; sub?: string; tone?: 'ok' | 'warn' | 'crit'; wide?: boolean }` with a default snippet slot for extra content (sparkline).
  - `ScoreRing { status: Status | 'learning'; score: number }` — ring arc proportional to `score`, label from `scoreLabel` or "Learning", caption "Health score"; no number shown.
  - `Sparkline { d: string; w: number; h: number; label: string }` — `.spark` SVG with `aria-label`.
  - `KV { rows: [string, string | { text: string; href: string }[]][] }` — `.kv` definition list; list values render as links.
  - `LineChart` — same props as today plus `band` drawing (already in `buildSeries`), restyled to the mockup's `.chart` markup: head with title and `.chart-now`, legend row from `refs` plus "Average" and "Min–max" when a band exists.

- [ ] **Step 1: Write the failing tests:**

```ts
it('labels every rule', () => {
	for (const id of ['bridge.offline', 'battery.stale', 'network.storm'] as const) expect(RULE_LABELS[id]).toBeTruthy();
});
it('scoreLabel', () => { expect([scoreLabel('green'), scoreLabel('amber'), scoreLabel('red')]).toEqual(['Good', 'Fair', 'Poor']); });
it('groupedSummary counts per rule, most first', () => {
	const c = (rule: string) => ({ rule });
	expect(groupedSummary([c('device.offline'), c('device.flapping'), c('device.offline')])).toBe('3 grouped issues: 2 device offline, 1 device flapping');
	expect(groupedSummary([c('device.offline')])).toBe('1 grouped issue: 1 device offline');
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the three helpers, then the six components and the `LineChart` restyle.
- [ ] **Step 4: Verify** tests, check, build pass. Existing pages that use `LineChart` still render.
- [ ] **Step 5: Commit** `feat: add shared design components`

Milestone 1 merge: PR `feat: design foundation`, squash-merge.

## Milestone 2 — Overview and issues (branch `feat/ui-m2-issues`)

### Task 3: Overview

**Files:**
- Modify: `src/routes/+page.server.ts`, `src/routes/+page.svelte`, `src/lib/views.ts`
- Test: `src/lib/views.test.ts`

**Interfaces:**
- Consumes: Task 2 components, `networkScore`, `counters`, `checkPrereqs`.
- Produces in `src/lib/views.ts`:
  - `banner(top: { severity: Severity; summary: string; action: string }[]): { tone: 'ok' | 'warn' | 'crit'; kicker: string; title: string; sub: string }` — `top` is the sorted top-level open issues.
  - `learning(firstHour: number | null, now: number, days = 3): { hours: number; done: boolean }`.
  - `peakQuiet(points: { t: number; v: number }[], tz: string): { now: number | null; peak: string; quiet: string } | null` — `null` for fewer than 2 points.

- [ ] **Step 1: Write the failing tests** (exact copy):

```ts
describe('banner', () => {
	const w = { severity: 'warning' as const, summary: 'Weak link', action: 'Move a router closer' };
	const c = { severity: 'critical' as const, summary: 'Zigbee bridge is offline', action: 'Check the Zigbee2MQTT container' };
	it('all good', () => expect(banner([])).toEqual({ tone: 'ok', kicker: 'All good', title: 'All good', sub: 'No open issues.' }));
	it('warnings', () => expect(banner([w, w])).toEqual({ tone: 'warn', kicker: 'Needs attention', title: '2 unresolved issues', sub: 'Nothing critical. Start with: Move a router closer.' }));
	it('one warning', () => expect(banner([w]).title).toBe('1 unresolved issue'));
	it('critical', () => expect(banner([c, w])).toEqual({ tone: 'crit', kicker: 'Critical', title: 'Zigbee bridge is offline', sub: '1 critical issue and 1 warning. Start with: Check the Zigbee2MQTT container.' }));
});
it('learning', () => {
	expect(learning(null, 0)).toEqual({ hours: 0, done: false });
	expect(learning(0, 2 * 3_600_000)).toEqual({ hours: 2, done: false });
	expect(learning(0, 72 * 3_600_000)).toEqual({ hours: 72, done: true });
});
it('peakQuiet', () => {
	expect(peakQuiet([], 'Europe/Oslo')).toBeNull();
	const H = 3_600_000, t = Date.UTC(2026, 9, 18, 5);
	expect(peakQuiet([{ t, v: 312 }, { t: t + H, v: 40 }, { t: t + 2 * H, v: 142 }], 'Europe/Oslo')).toEqual({ now: 142, peak: '312/min at 07:00', quiet: '08:00' });
});
```

(Times are the points' hours formatted `HH:MM` in `tz`; 05:00 UTC is 07:00 in Oslo on 18 Oct.)

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement the helpers.** Info issues count toward "unresolved"; the critical sub counts criticals and warnings (`N critical issue(s) and N warning(s)`, omit the warnings part when 0). Append "." to the action unless it ends in punctuation.
- [ ] **Step 4: Loader.** Add: `banner`, `learning` (first `samples_hourly.hour`, `min()`), `peakQuiet` over `networkMsgPerMin`, issues with `action`, `rule`, `ieee`, device name, and children with `rule`; `nextBattery` = soonest `battery_days_left` baseline ≤ 30 with its device name; offline/unknown counts.
- [ ] **Step 5: Page** after the mockup's overview: `.banner` (tone class, icon, kicker, title, sub; learning bar when `!learning.done`; `ScoreRing` with status `'learning'` when not done), prerequisite `.prereq` box per failing prereq with its YAML in `.prereq-code` and a Copy button (`navigator.clipboard.writeText`; hidden without JS), "Open issues N" with "All issues →", `IssueRow` list, four `Tile`s, `.statusline`.
- [ ] **Step 6: Verify** tests, check, build. **Step 7: Commit** `feat: redesign the overview`

### Task 4: Issues list and issue page

**Files:**
- Create: `src/lib/server/device-history.ts`
- Modify: `src/routes/issues/+page.server.ts`, `src/routes/issues/+page.svelte`, `src/routes/issues/[id]/+page.server.ts`, `src/routes/issues/[id]/+page.svelte`, `src/routes/devices/[ieee]/+page.server.ts`, `src/lib/views.ts`
- Test: `src/lib/views.test.ts`, `src/lib/server/device-history.test.ts`

**Interfaces:**
- Produces: `deviceCharts(db: Db, ieee: string, range: '24h' | '7d' | '30d', settings: Settings, now: number): { lqi: ChartProps; battery: ChartProps | null; voltage: ChartProps | null; msgs: ChartProps }` in `src/lib/server/device-history.ts` — moved out of the device loader unchanged (`ChartProps` = the object it builds for `LineChart` today), plus `msgs` (hourly `msg_count / 60`, unit `/min`). The device loader calls it; behaviour unchanged.
- Produces: `chartFor(rule: string): 'battery' | 'lqi' | 'msgs' | null` in `src/lib/views.ts` — `battery.*` → `'battery'`; `lqi.*` and `route.failures` → `'lqi'`; `device.storm`, `device.dominant` → `'msgs'`; else `null`.
- Produces: `EVIDENCE_LABELS: Record<string, string>` used by `evidenceRows` (unknown keys unchanged).

- [ ] **Step 1: Write the failing tests:** `chartFor('battery.low') === 'battery'`, `chartFor('route.failures') === 'lqi'`, `chartFor('device.storm') === 'msgs'`, `chartFor('bridge.offline') === null`; `deviceCharts` on an in-memory DB with no samples returns charts whose `points` are empty and `latest` undefined (Review Focus 1).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `chartFor`, extract `deviceCharts`, add `msgs`.
- [ ] **Step 4: Issues list.** URL params `tab=open|acknowledged|resolved` (default open), `rule=<RuleId>|all`, `sev=critical|warning|info|all`; tab counts; rule `<select>` + severity `.seg` in one GET form; `IssueRow` without action. Intro: "Acknowledging stops reminders. An issue stays listed until MeshPulse sees it resolve."
- [ ] **Step 5: Issue page** after the mockup: crumb "← Issues", `SevBadge` + state + rule label, summary as `h1`, "Opened … (N ago) · open for …" (resolved: "· resolved …"), `.issue-action` "Suggested action" box, "Evidence" `KV`, the `chartFor` chart for the issue's device over 7 d (none if `null` or no device), parent link / children list, side panel: Acknowledge (hidden when acknowledged or resolved) with "Stops reminders. The issue stays open until it resolves.", mute select + button + status for the device (hidden without a device), "Open device page →".
- [ ] **Step 6: Verify** tests, check, build. **Step 7: Commit** `feat: redesign issues and the issue page`

Milestone 2 merge: PR `feat: redesign overview and issues`.

## Milestone 3 — Devices (branch `feat/ui-m3-devices`)

### Task 5: Devices list

**Files:**
- Create: `src/lib/server/device-stats.ts`
- Modify: `src/routes/devices/+page.server.ts`, `src/routes/devices/+page.svelte`, `src/lib/views.ts`
- Test: `src/lib/server/device-stats.test.ts`, `src/lib/views.test.ts`

**Interfaces:**
- Produces: `deviceStats(db: Db, now: number): Map<string, { lqi24: number | null; lqiBase: number | null; msgH: number | null }>` — mean `lqiAvg` and mean `msgCount` over the last 24 full hours of `samples_hourly`, `lqi_mean` from `baselines`.
- Produces: `DeviceRow` gains `lqi24`, `lqiBase`, `msgH` (`deviceRows(state, open, stats?)`); `SortKey` gains `'msgH'`.
- Produces: `filterRows(rows: DeviceRow[], f: { q: string; routers: boolean; battery: boolean; offline: boolean; issues: boolean }): DeviceRow[]` — case-insensitive name match; checked chips AND together.

- [ ] **Step 1: Write the failing tests:** `deviceStats` on an empty DB → empty map; with two hourly rows for one device → their means; `filterRows` with `q: 'attic'` matches "Attic plug" only; `routers + issues` returns routers with `openIssues > 0` only.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Page** after the mockup: title + "N devices · N routers · N on battery", Compact/Comfortable links (`density=comfortable`), GET form with search and chip checkboxes (counts from unfiltered rows), sortable headers as links (`sort`, `dir`), table `.dt` with the columns of the spec, LQI meter, issue rows with severity edge, ignored rows `.muted`, `.dcards` for narrow screens. No Network map button.
- [ ] **Step 5: Verify; Commit** `feat: redesign the devices list`

### Task 6: Device page

**Files:**
- Modify: `src/routes/devices/[ieee]/+page.server.ts`, `src/routes/devices/[ieee]/+page.svelte`

**Interfaces:**
- Consumes: `deviceCharts` (Task 4), components (Task 2), `deviceScore`.

- [ ] **Step 1: Page** after the mockup: crumb, name, badges (type, model · vendor, power source, "Health N"), "Online · seen N ago"; "Open issues for this device" `IssueRow`s; History with 24 h / 7 d / 30 d `.seg` links; LQI chart, Battery and Voltage charts side by side (battery devices only); recent events: last 10 as `.timeline`, "Show all N events" → `/events?device=<ieee>`; side panel: Battery forecast (days to target, "Empty around <date>", Now, Last swap or "—"), "Alerts for this device" mute, Ignore and Chatty toggles with the spec's help text.
- [ ] **Step 2: Verify** existing device route tests, check, build. **Step 3: Commit** `feat: redesign the device page`

Milestone 3 merge: PR `feat: redesign devices`.

## Milestone 4 — Batteries and Events (branch `feat/ui-m4-batteries-events`)

### Task 7: Batteries and Events

**Files:**
- Modify: `src/routes/batteries/+page.server.ts`, `src/routes/batteries/+page.svelte`, `src/routes/events/+page.svelte`, `src/lib/views.ts`
- Test: `src/lib/views.test.ts`

**Interfaces:**
- Produces: `BatteryRow` gains `trend: string` (sparkline path of the last 30 days' hourly battery, empty when < 2 points); `splitBatteries(rows: BatteryRow[], days = 30): { soon: BatteryRow[]; later: BatteryRow[]; none: BatteryRow[] }` — `soon` ≤ days, `later` > days, both by days left ascending; `none` without a forecast, by name.

- [ ] **Step 1: Failing test** for `splitBatteries` with rows at 6, 55 and no forecast.
- [ ] **Step 2: Run, implement, pass.**
- [ ] **Step 3: Batteries page:** "N battery devices · N need a new battery within 30 days."; "Buy within 30 days N" and "Later N" tables (Days left, Empty around, Battery, Voltage, 30-day trend, Last swap); `none` rows at the end of Later with "—". No Cell column, no shopping list.
- [ ] **Step 4: Events page:** "Raw log, newest first. Kept for 90 days · N events."; Kind `<select>` and device filter in one GET form; table Time, Kind (icon + `EVENT_KINDS` label), Device, Detail; `.pager`.
- [ ] **Step 5: Verify; Commit** `feat: redesign batteries and events`

Milestone 4 merge: PR `feat: redesign batteries and events`.

## Milestone 5 — Settings and login (branch `feat/ui-m5-settings`)

### Task 8: Settings and login

**Files:**
- Modify: `src/lib/server/settings.ts`, `src/routes/settings/+page.server.ts`, `src/routes/settings/+page.svelte`, `src/routes/login/+page.svelte`
- Test: `src/lib/server/settings.test.ts`

**Interfaces:**
- Produces: `parseSettingsForm(form): { settings: Settings } | { error: string; errors: { field: keyof Settings; message: string }[] }` — collects every bad field (range and positivity per field; each ordering check reports on its first field: batteryCriticalPct, causingBatteryPct, voltageCritical, flappingClearBelow, silenceMinH, lqiWeak, lqiRecoverPct, routeFailClear, netRouteClearFactor, forecastWarnDays, massOfflineClearPct, lqiMinHours, churnWindowH, netChurnWindowMin, backlogClear, stormClearFactor, stormMinPerMin, dominantClearPct, stormSustainMin). `error` = first message (existing tests keep passing).
- The settings action returns `fail(400, { section: 'settings', error, errors, values: Object.fromEntries(form) })`.

- [ ] **Step 1: Failing test:** `batteryCriticalPct: '30'` and `graceMin: 'x'` → `errors` has two entries, fields `batteryCriticalPct` and `graceMin` (Review Focus 4).
- [ ] **Step 2: Run, implement, pass.**
- [ ] **Step 3: Settings page** after the mockup: `.settings-layout` with `.subnav` anchors (Thresholds, Quiet hours, Notifications, Heartbeat, Zigbee2MQTT, Failed notifications; error count badge on Thresholds); threshold groups Bridge, Availability, Battery, Link quality, Routes, Forecast and reminders, Churn, Storms, Mass offline, Battery escalation, MQTT backlog — every numeric key of `DEFAULT_SETTINGS` exactly once, each `.field` with label, `.input-unit` unit and one help line; failed save: `.form-error` "N setting(s) need fixing. Nothing was saved; your other changes are kept below." and `.field-error` per field, values from `form.values`; Discord and Apprise `.channel` panels with the existing fields plus Weekly digest; Heartbeat; prerequisites `.checklist`; failed notifications table. No Active features.
- [ ] **Step 4: Login page** after the mockup's `.login` (art panel + form panel); same form fields and action.
- [ ] **Step 5: Verify** tests, check, build. **Step 6: Commit** `feat: redesign settings and login`

Milestone 5 merge: PR `feat: redesign settings and login`.

## Milestone 6 — Deploy (branch `feat/ui-m6-deploy`)

### Task 9: Docs and deploy

- [ ] **Step 1:** README screenshots/description and CLAUDE.md (`src/lib/components/` list, `device-history.ts`, `device-stats.ts`, mockup location) updated.
- [ ] **Step 2:** Verify tests, check, build; PR `docs: describe the redesign`, squash-merge.
- [ ] **Step 3:** Rebuild the image on Unraid and recreate the container (established procedure); check `/api/health` and every page in a browser, dark and light.

Per milestone, before merge, the controller screenshots every changed page on live data in dark and light and compares it with the mockup.
