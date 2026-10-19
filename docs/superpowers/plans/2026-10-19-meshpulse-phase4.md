# MeshPulse Phase 4 (Opt-in active features) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily coordinator check and a nightly (plus guarded manual) network scan, both off by default, feeding a `coordinator.missing_router` rule, real-parent router grouping and a network map page.

**Architecture:** One request module publishes only `networkmap` and `coordinator_check` on the existing MQTT connection and resolves on the matching `bridge/response`. A 60 s active loop (`startActive`, beside the engine) decides what is due (pure schedule + guard), runs it and records each run in `scans`/`scan_links`. Rules read the latest successful results through `RuleContext.active`; grouping reads real parents through a lifecycle input.

**Tech Stack:** SvelteKit 3 (adapter-node), Svelte 5 runes, TypeScript strict, Vitest 4, Drizzle + better-sqlite3, mqtt.js 5.

**Spec:** `docs/superpowers/specs/2026-10-19-meshpulse-phase4-design.md`

## Global Constraints

- Both features default **off** (`activeCoordinatorCheck: false`, `activeNetworkScan: false`); MeshPulse never enables them itself.
- Only two MQTT requests ever: `<base>/bridge/request/networkmap` with `{ "type": "raw", "routes": false }` and `<base>/bridge/request/coordinator_check` with `{}`; any other name throws before publishing.
- Timeouts: networkmap 10 min, coordinator_check 60 s. Times: coordinator check 03:30, network scan 04:00, in `TZ`.
- Guard skips when: MQTT disconnected; bridge not online; open `bridge.offline`, `monitor.mqtt_lost`, `network.mass_offline`, `network.storm`; Z2M or MeshPulse restarted < 60 min ago; a request of the same kind running. Manual scan: same guard + max one manual per 60 min.
- Retention 30 days for `scans` and `scan_links`. Real parents used only from a successful scan ≤ 48 h old.
- Copy: "These send requests into your Zigbee network. Everything else MeshPulse does is read-only. Off by default."; scan help "Runs at 04:00. A scan of N devices takes 2–4 minutes and briefly loads the mesh."; publish refusal "MQTT user needs publish on `zigbee2mqtt/bridge/request/#`"; missing router action "Re-pair <router> so the coordinator knows it again"; failing scan issue "Network scan keeps failing".
- No dependency beyond the stack. Server code uses relative imports; SvelteKit 3 `$app/env`; Svelte 5 runes; pages are `<div class="page">` inside the layout's `<main>`; only classes from `src/app.css`.
- No real scan or coordinator check against the user's network without the user's explicit go-ahead in chat.
- Before each merge: `npx vitest run`, `npm run check`, `npm run build` pass (`src/lib/server/auth.test.ts` may time out under host load — rerun alone).

## Review Focus

1. A response for another transaction, or a late response after a timeout — ignored, no crash, no double resolve. Pinned in Task 1.
2. MQTT drops in the middle of a scan — the run is recorded `failed`, and the "running" flag is cleared so tomorrow's run is not blocked. Pinned in Task 4.
3. The DST change night (Oslo, 25 Oct 2026, 03:00 → 02:00) — the 03:30 check and 04:00 scan each run exactly once. Pinned in Task 2.
4. A missing router that is `ignore`-tagged or no longer in Z2M's device list — no issue. Pinned in Task 3.
5. A device renamed between scans — not reported as "parent changed" (everything keyed by IEEE). Pinned in Task 5.

## Research note (Zigbee2MQTT 2.x responses)

- `bridge/response/networkmap`: `{ data: { type: "raw", routes: false, value: { nodes: [{ ieeeAddr, friendlyName, type, networkAddress, failed?: string[] , ... }], links: [{ source: { ieeeAddr, networkAddress }, target: { ieeeAddr, networkAddress }, linkquality, lqi?, depth, relationship, routes }] } }, status: "ok", transaction }`. Each link comes from the **target** router's neighbour table; `relationship` is the **source**'s relation to the target: `0` source is target's parent, `1` source is target's child, `2` sibling, `3` none, `4` previous child.
- `bridge/response/coordinator_check`: `{ data: { missing_routers: [{ ieee_address, friendly_name }] }, status: "ok", transaction }`.
- Tasks 3–4 build fixtures in this shape; the controller replaces them with real captures during rollout (Task 7) and any mismatch is fixed there.

---

## Milestone 2 — Requests and settings (branch `feat/p4-m02-requests`)

### Task 1: Request module

**Files:**
- Create: `src/lib/server/mqtt/request.ts`, `src/lib/server/mqtt/request.test.ts`
- Modify: `src/lib/server/mqtt/collector.ts` (hand `bridge/response/*` to the requester), `src/lib/server/runtime.ts` (keep the requester on the runtime)

**Interfaces:**
- Produces:
  - `type RequestName = 'networkmap' | 'coordinator_check'`
  - `interface Requester { request(name: RequestName, payload: object, timeoutMs: number): Promise<unknown>; onMessage(topic: string, payload: Buffer): void; busy(name: RequestName): boolean }`
  - `createRequester(publish: (topic: string, body: string) => Promise<void>, baseTopic: string): Requester` — resolves with the response's `data`; rejects with `Error(error text)` on `status: "error"`, `Error('timeout')` on timeout, and the publish error message mapped to "MQTT user needs publish on `zigbee2mqtt/bridge/request/#`" when the broker refuses.
  - `Runtime` gains `requester: Requester`.

- [ ] **Step 1: Failing tests** (`request.test.ts`, fake publish capturing topic/body, `vi.useFakeTimers()`):
  - resolves with `data` for the matching `transaction`; a response with another transaction is ignored.
  - `request('networkmap', …)` publishes to `zigbee2mqtt/bridge/request/networkmap`, body has a `transaction` string.
  - rejects `timeout` after `timeoutMs`; a late response after that is ignored (no throw).
  - rejects with the response `error` when `status: "error"`.
  - `request('permit_join' as never, …)` throws before publishing.
  - `busy('networkmap')` true while pending, false after settle.
- [ ] **Step 2: Run** `npx vitest run src/lib/server/mqtt/request.test.ts` — FAIL.
- [ ] **Step 3: Implement**; the collector calls `requester.onMessage` for topics starting `${base}/bridge/response/` (before `route`, which ignores them), and publishes via `client.publishAsync`.
- [ ] **Step 4: Verify** tests, check, build. **Step 5: Commit** `feat: add the bridge request module`

### Task 2: Settings, storage, schedule and guard

**Files:**
- Create: `drizzle/0004_*.sql` (via `npx drizzle-kit generate`), `src/lib/server/active/schedule.ts`, `src/lib/server/active/schedule.test.ts`
- Modify: `src/lib/server/db/schema.ts`, `src/lib/server/settings.ts`, `src/lib/server/retention.ts`, `src/routes/settings/+page.server.ts`, `src/routes/settings/+page.svelte`, `src/lib/settings-groups.ts` if needed

**Interfaces:**
- Produces:
  - Tables `scans` (`id`, `kind`, `trigger` `'scheduled'|'manual'`, `startedAt`, `finishedAt`, `status` `'ok'|'failed'|'skipped'`, `reason`, `nodes`, `links`, `missing` json `string[]`) and `scanLinks` (`scanId`, `sourceIeee`, `targetIeee`, `lqi`, `depth`, `relationship`), indexes on `scans(kind, startedAt)` and `scanLinks(scanId)`.
  - Settings `activeCoordinatorCheck: false`, `activeNetworkScan: false`, `activeCheckDay: ''`, `activeScanDay: ''` (local date `YYYY-MM-DD` of the last finished run, ok or failed).
  - `due(now: number, at: '03:30' | '04:00', lastDay: string, tz: string): string | null` — the local day to run, or null.
  - `activeGuard(state: AppState, open: Set<string>, now: number, busy: boolean): string | null` — the first matching reason, exact strings: `'MQTT is disconnected'`, `'Zigbee2MQTT bridge is not online'`, `'An outage is open (<rule>)'`, `'Zigbee2MQTT or MeshPulse restarted less than an hour ago'`, `'A request is already running'`.
  - `prune` deletes `scans` (and their links) older than 30 days.

- [ ] **Step 1: Failing tests:** `due` before 03:30 → null; at 03:31 with `lastDay` yesterday → today; with `lastDay` today → null; Review Focus 3: on 25 Oct 2026 Oslo, ticks every minute from 00:00 to 06:00 UTC with `lastDay` updated after each run → exactly one run day for 03:30 and one for 04:00. `activeGuard`: each reason in order, null when healthy. Retention: a 31-day-old scan and its links are pruned, a 29-day-old one kept.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**; generate the migration; a skipped run does **not** set the day (it retries next tick), a finished run does.
- [ ] **Step 4: Settings page** "Active features" section (after Failed notifications, in the sub-menu): the Global Constraints copy, two switches, each with its last run from `scans` (time, status, reason) and next run time; saving uses the existing settings save. Nothing runs yet.
- [ ] **Step 5: Verify; Commit** `feat: add active feature settings, storage and schedule`

Milestone 2 merge: PR `feat: request module and active feature settings`.

## Milestone 3 — Coordinator check (branch `feat/p4-m03-coordinator`)

### Task 3: Daily coordinator check and missing-router rule

**Files:**
- Create: `src/lib/server/active/run.ts`, `src/lib/server/active/parse.ts`, `src/lib/server/active/loop.ts`, tests beside them, `src/lib/server/rules/missing-router.ts` (+ test)
- Modify: `src/lib/server/runtime.ts` (start the loop), `src/lib/server/rules/types.ts` (`RuleId` + `RuleContext.active`), `src/lib/server/rules/index.ts` (RULES, RULE_DEFAULTS), `src/lib/server/engine.ts` (load `ctx.active`), `src/lib/views.ts` (`RULE_LABELS`)

**Interfaces:**
- Consumes: `Requester` (Task 1), `due`, `activeGuard`, tables and settings (Task 2).
- Produces:
  - `parseCoordinatorCheck(data: unknown): string[]` — missing router ieees; throws on an unexpected shape.
  - `runActive(deps: { db: Db; state: AppState; requester: Requester; config: Config }, kind: 'networkmap' | 'coordinator_check', trigger: 'scheduled' | 'manual', now: number): Promise<{ status: 'ok' | 'failed' | 'skipped'; reason?: string }>` — guard, request, parse, insert one `scans` row (and links for networkmap, Task 4), set the day setting on a finished scheduled run.
  - `startActive(deps): { stop(): void }` — every 60 s: if `activeCoordinatorCheck` and `due(…, '03:30', activeCheckDay)` → `runActive('coordinator_check', 'scheduled')`; skips are recorded once per day (update the day's skipped row instead of adding one per tick).
  - `RuleContext.active?: { missingRouters: string[] | null; scanFailStreak: number }` — `missingRouters` from the latest **ok** coordinator check (null if none).
  - Rule `coordinator.missing_router` (Warning, per router ieee, `minRuns: 1`, `resolveRuns: 1`, `deviceLevel: true`, `notify: true`), label "Missing from coordinator".

- [ ] **Step 1: Failing tests:** parser on the research-note shape; `runActive` with a fake requester: ok row with `missing`, failed row with reason on reject, skipped row with the guard reason and no request sent; feature off → loop never calls the requester. Rule: fires per missing router with the Global Constraints action; nothing when `missingRouters` is null; Review Focus 4 — no finding for an `ignore`-tagged router or an ieee not in `state.devices`; a later ok check without the router → no finding (lifecycle resolves); a newer failed check leaves `missingRouters` from the older ok one (no false resolve).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Verify** tests, check, build. **Step 5: Commit** `feat: add the daily coordinator check`

Milestone 3 merge: PR `feat: daily coordinator check`. Controller then deploys and asks the user to switch the check on (Task 7 rollout step 1).

## Milestone 4 — Network scan (branch `feat/p4-m04-scan`)

### Task 4: Nightly and manual network scan

**Files:**
- Modify: `src/lib/server/active/parse.ts`, `run.ts`, `loop.ts` (+ tests), `src/lib/server/rules/` (new `scan-failing.ts` + test, index, types), `src/lib/views.ts` (label)

**Interfaces:**
- Produces:
  - `parseNetworkmap(data: unknown): { nodes: { ieee: string; type: string; failed: boolean }[]; links: { source: string; target: string; lqi: number; depth: number; relationship: number }[] }` — throws on an unexpected shape (the run then fails).
  - `runActive(…, 'networkmap', …)` stores `scans` (nodes, links counts) and all `scanLinks` in one transaction.
  - `startActive` also runs the scan at 04:00 when `activeNetworkScan` is on.
  - `requestManualScan(deps, now): Promise<{ ok: true } | { ok: false; reason: string }>` — guard + `'A manual scan ran less than an hour ago'`; starts the scan without awaiting it.
  - `RuleContext.active.scanFailStreak` = consecutive failed **scheduled** networkmap runs since the last ok one; rule `active.scan_failing` (Info, network-level, `notify: true`) when ≥ 3, summary "Network scan keeps failing", resolves on the next ok scan. Label "Network scan failing".

- [ ] **Step 1: Failing tests:** parser on the research-note shape (failed node flagged, link fields mapped; `lqi` from `linkquality` when `lqi` absent); ok run stores links; Review Focus 2 — requester rejects mid-scan → row `failed`, `requester.busy('networkmap')` false afterwards and the next day's run proceeds; manual scan refused with each reason, allowed after 60 min; streak 3 → finding, ok scan → none.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Verify.** **Step 5: Commit** `feat: add the nightly network scan`

Milestone 4 merge: PR `feat: nightly network scan`. Controller then asks the user before one manual scan (Task 7 rollout step 2).

## Milestone 5 — Real parents (branch `feat/p4-m05-parents`)

### Task 5: Parent links in grouping and on the device page

**Files:**
- Create: `src/lib/server/active/parents.ts` (+ test)
- Modify: `src/lib/server/issues/grouping.ts`, `src/lib/server/issues/lifecycle.ts`, `src/lib/server/engine.ts`, `src/routes/devices/[ieee]/+page.server.ts`, `src/routes/devices/[ieee]/+page.svelte` (+ existing grouping tests)

**Interfaces:**
- Produces:
  - `parentMap(links: { source: string; target: string; lqi: number; relationship: number }[], typeOf: (ieee: string) => string | undefined): Map<string, { parent: string; lqi: number }>` — per research note: `relationship 1` on (source=X, target=R) or `relationship 0` on (source=R, target=X) makes R X's parent; else X's highest-LQI link to a Router/Coordinator.
  - `latestParents(db, typeOf, now): { at: number; parents: Map<…>; previous: Map<…> | null } | null` — latest ok networkmap ≤ 48 h old, plus the previous ok one.
  - `parentFor(child, candidates, devices, settings, realParent?: (ieee: string) => string | null)` — when `realParent(child.ieee)` returns an ieee, a router `device.offline` candidate matches only if it is that parent; when it returns null, the existing timing rule applies unchanged. Lifecycle input gains `realParent?`.

- [ ] **Step 1: Failing tests:** parentMap on both relationship directions and the LQI fallback; `latestParents` ignores a 49 h old scan; grouping: with a real parent, an end device attaches to its parent's offline issue and **not** to another router's that matches by timing; without a scan, existing timing tests still pass; Review Focus 5 — a device renamed between scans (same ieee, same parent) is not "changed".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Device page:** badge "Parent <name> · LQI n" linking to the parent, "· changed since previous scan" when the previous scan's parent differs; routers show "N devices route through this router". Hidden without a recent scan.
- [ ] **Step 5: Verify; Commit** `feat: group by real parents from the network scan`

Milestone 5 merge: PR `feat: real parent links`.

## Milestone 6 — Map page (branch `feat/p4-m06-map`)

### Task 6: Network map page

**Files:**
- Create: `src/lib/map.ts` (+ test), `src/routes/map/+page.server.ts`, `src/routes/map/+page.svelte`
- Modify: `src/app.css` (restore the mockup's `.map` rules from `docs/superpowers/design/meshpulse.css`), `src/routes/devices/+page.svelte` (button "Network map")

**Interfaces:**
- Consumes: `parentMap`, `latestParents` (Task 5); `requestManualScan` (Task 4).
- Produces: `mapLayout(nodes: { ieee: string; type: string; failed: boolean }[], parents: Map<string, { parent: string; lqi: number }>, w: number, h: number): { nodes: { ieee: string; x: number; y: number; type: string; failed: boolean }[]; edges: { from: string; to: string; weak: boolean }[] }` — coordinator at the centre, routers on rings by depth from the coordinator, end devices fanned around their parent; sort by ieee for determinism; `weak` = LQI < 60.

- [ ] **Step 1: Failing tests:** same input twice → identical output; every end device closer to its parent than to the centre; at 140 nodes no two node centres closer than 8 px in a 900×600 box.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.**
- [ ] **Step 4: Page** after the mockup's map branch (`docs/superpowers/design/mockup-app.js`): header copy from the spec, "Opt-in · sends traffic to the mesh" tag, "Scan now" form action (refusal reason inline), SVG (solid link LQI ≥ 60, dashed below, failed routers crossed; each node links to its device page with name and LQI as `<title>`), legend, "Offline at last scan N" panel; empty states from the spec (feature off, no scan yet, last scan failed with last good scan still drawn).
- [ ] **Step 5: Verify; Commit** `feat: add the network map page`

Milestone 6 merge: PR `feat: network map page`.

## Milestone 7 — Rollout, docs and deploy (branch `feat/p4-m07-deploy`)

### Task 7: Rollout and docs (controller-led)

- [ ] **Step 1 (after M3 deploy):** user switches on the coordinator check; controller reads the first `scans` row; with the user's go-ahead a manual capture of the real `coordinator_check` response is saved as `src/lib/server/active/fixtures/coordinator-check.json` with a parser test.
- [ ] **Step 2 (after M4 deploy, user go-ahead, quiet daytime):** one manual scan; its response saved as `fixtures/networkmap.json`; parser and `parentMap` tests on it; any shape mismatch fixed in this branch.
- [ ] **Step 3:** README (Active features, map, missing-router issue, MQTT publish permission note) and CLAUDE.md (request module, active loop, tables, routes); screenshots of map and Active features on live data.
- [ ] **Step 4:** Verify; PR `docs: describe Phase 4`; squash-merge; deploy; check `/api/health`, Settings, `/map`.
