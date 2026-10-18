# MeshPulse Phase 3 (Correlation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grouping (one problem → one notification), churn/storm/battery/bridge rules, health score, weekly digest, Events page, and a traffic replayer that gates every rule against the user's real 24 h capture.

**Architecture:** Same single process. New in-memory minute counters and `bridge/health` delta events feed new pure rules. Grouping lives in the lifecycle: it returns, besides opens, a `parentOf` map (child key → parent key); the engine inserts parents before children in its one transaction and stores `parent_issue_id`. The hourly job gains `msg_per_min` baselines and the network score history. The replayer drives the real engine (`runOnce`) on an in-memory DB with a simulated clock.

**Tech Stack:** unchanged; no new dependencies (the replayer runs through Vitest).

**Spec:** `docs/superpowers/specs/2026-10-18-meshpulse-phase3-design.md` (wins over `docs/SPEC.md`). Earlier designs still apply.

## Global Constraints

- Read-only on MQTT; storage keyed by IEEE; UTC epoch ms; display in `TZ`; relative imports; `$app/env`; no new dependency.
- New rule ids exactly: `device.rejoin_churn`, `device.leave`, `network.churn`, `device.interview_failed`, `device.storm`, `device.dominant`, `network.storm`, `network.mass_offline`, `battery.stale`, `bridge.mqtt_backlog`. No `router.offline_impact`, no `battery.causing_issues` rule id (it is a `battery.low` escalation).
- `battery.stale` never notifies. Child issues never notify while their parent is open.
- New settings and defaults (exact): `churnAnnounce 3, churnAddrChanges 2, churnWindowH 6, churnCritical 10, churnClearH 12, netChurnDevices 5, netChurnWindowMin 15, netChurnQuietH 1, stormFactor 5, stormMinPerMin 20, stormCritPerMin 60, stormSustainMin 5, stormClearFactor 2, stormClearMin 15, dominantPct 30, dominantClearPct 15, dominantWindowMin 15, dominantClearMin 30, dominantMinMsgs 60, netStormFactor 4, netStormClearFactor 2, massOfflineRouterPct 20, massOfflineDevices 10, massOfflineWindowMin 5, massOfflineClearPct 5, routerGroupWindowMin 10, causingBatteryPct 35, causingWindowH 48, staleBatteryDays 7, backlogHigh 50, backlogClear 10`.
- Retention: `health_samples` 14 days; `health_scores` 365 days.
- Replay gate: before each rule milestone merges, the controller replays the real 24 h capture; a normal day produces no Critical and every would-be notification is listed in the PR.
- Git: branch `feat/p3-mNN-<slug>`, conventional commits, squash-merged PRs, no AI attribution. Paseo tickets per milestone.

## Review Focus

1. Zigbee2MQTT restart (every device announces and reports at once) → no `device.rejoin_churn`, `network.churn`, `device.leave` or storm issues (Task 3 `restart burst opens nothing`, Task 4 `restart burst is not a storm`).
2. MeshPulse restart (minute counters empty, health deltas unknown) → no storm and no `leave_count_up` events from the first health sample after start (Task 2 `first health sample emits no deltas`, Task 4 `needs a full window after start`).
3. Parent and children opening in the same run → children attached and silent (Task 6 `children opening with their parent stay silent`).
4. Sunday 18:00 across DST and after downtime → exactly one digest per ISO week (Task 8 `once per week across DST and catch-up`).
5. Events page filters from the URL (unknown kind, bogus device, page beyond end) → empty list, never an error or unfiltered dump (Task 9 `rejects unknown filters`).

---

## File map

```
src/lib/server/trends/minutes.ts        MinuteCounters (in-memory ring)
src/lib/server/rules/churn.ts           rejoinChurn, deviceLeave, networkChurn, interviewFailed
src/lib/server/rules/storm.ts           deviceStorm, deviceDominant, networkStorm
src/lib/server/rules/bridge-backlog.ts  mqttBacklog
src/lib/server/rules/mass-offline.ts    massOffline
src/lib/server/rules/battery.ts         + causing-issues escalation, batteryStale
src/lib/server/issues/grouping.ts       parentFor(), PARENT_RULES
src/lib/server/score.ts                 networkScore(), deviceScore()
src/lib/server/notify/weekly.ts         weeklyDigest(), shouldSendWeekly()
src/routes/events/                      Events page
scripts/replay.test.ts                  replayer (vitest), REPLAY=<file>
```

---

### Task 1: Traffic replayer + 24 h parser re-check (Milestone 02, T03)

**Files:** Create `scripts/replay.ts` (pure `replay()`), `scripts/replay.test.ts` (runs only when `REPLAY` is set, prints the report), `package.json` script `"replay": "vitest run scripts/replay.test.ts"`; a tiny always-run test `scripts/replay.unit.test.ts` on a fixture. Include `scripts/` in the vitest include list.

**Interfaces:**
- Produces: `replay(lines: MqttMsg[], opts?: { settings?: Partial<Settings> }): ReplayReport` where `ReplayReport = { from: number; to: number; messages: number; issues: { rule: string; ieee: string | null; name: string | null; severity: Severity; openedAt: number; resolvedAt: number | null }[]; notifications: { at: number; rule: string; kind: string; severity: string; name: string | null }[] }`.
  Drives the real path: `openDb(':memory:')`, `createState`, `route` + `applyEffects` for each line in time order, `runOnce` every 60 s of capture time (monitor treated as connected from the first message), `rollupHours`/`computeBaselines` at each hour boundary, notifications captured from the engine's `notify` hook (never the outbox network path). Capture lines' `payload` may be an object or a string.
- `formatReport(r: ReplayReport, tz: string): string` — counts by rule and severity, then each notification line.

- [ ] **Step 1:** `git switch -c feat/p3-m02-replay`. Failing unit test `replay.unit.test.ts`: `replays a fixture into issues and notifications` (tests/fixtures/startup.jsonl plus a router going offline for 3 min → one `device.offline` issue opened and resolved, notifications `[open, resolved]`); `ignores retained-only captures for liveness` (no bridge.offline Critical when lines are retained only and the capture is < 5 min).
- [ ] **Step 2:** Run → FAIL; implement; PASS; `npm run check` clean. Commit `feat: add traffic replayer`.
- [ ] **Step 3 (controller):** copy the full capture from Unraid, run `REPLAY=<file> npm run replay`, run `/tmp/mp-validate.mts` on its `bridge/logging` lines, record both results in the PR (24 h parser re-check) and close the carried-over ticket.

### Task 2: Data — minute counters, health samples, delta events, chatty tag (Milestone 03, T04)

**Files:** Modify `src/lib/server/db/schema.ts` (+ `healthSamples`, `healthScores`; migration), `src/lib/server/types.ts` (EventKind + `'leave_count_up' | 'address_changed'`; `AppState.minutes: MinuteCounters`; `AppState.lastHealth: Record<string,{leaves:number; addr:number}> | null`), `src/lib/server/mqtt/route.ts` (count live device messages into minutes; on `bridge/health` emit a `health_sample` effect and delta events), `src/lib/server/store.ts` (persist health samples; seed `lastHealth` from the latest stored sample in `loadDevices`; generalise `setIgnored` to `setTag(db, state, ieee, tag: 'ignore' | 'chatty', on)` and keep `setIgnored` as a thin call or replace its callers), `src/lib/server/retention.ts`. Create `src/lib/server/trends/minutes.ts`.

**Interfaces:**
- `class MinuteCounters { add(ieee: string, ts: number): void; perMinute(ieee: string | null, now: number, minutes: number): number[] /* oldest→newest, complete minutes only; null = network */; topShare(now: number, minutes: number, exclude: Set<string>): { ieee: string; share: number; total: number } | null }` — keeps 60 complete minutes plus the current one.
- `Effect` gains `{ kind: 'health'; ts: number; uptimeSec: number | null; mqttQueued: number | null; devices: Record<string, { leaves: number; addr: number }> }`.
- `healthSamples { ts PK, uptimeSec, mqttQueued, devices json }`; `healthScores { ts PK, score }`.
- Delta events only when a previous sample exists (`state.lastHealth` non-null) and the counter increased; first sample after start emits none.

- [ ] **Step 1:** `git switch -c feat/p3-m03-data`. Failing tests: minutes — `counts per minute and drops minutes older than 60`, `topShare excludes chatty`; router — `live device messages count per minute; retained do not`, `first health sample emits no deltas`, `leave_count and address changes increase → events`, `stores mqtt queue`; store — `lastHealth survives restart via the latest sample`, `setTag toggles chatty in DB and memory`; retention — `prunes health_samples after 14 days and health_scores after 365`.
- [ ] **Step 2:** Run → FAIL; implement; `npx drizzle-kit generate --name=phase3_data`; PASS; check clean. Commit `feat: add minute counters and health samples`.

### Task 3: Churn, interview and backlog rules (Milestone 04, T05)

**Files:** Create `src/lib/server/rules/churn.ts`, `src/lib/server/rules/bridge-backlog.ts`; modify `rules/types.ts` (RuleId), `rules/index.ts` (RULES, RULE_DEFAULTS), `settings.ts` (+ form fields/validation), `src/lib/server/engine.ts` (RuleContext gains `health: { queued: number | null }[]` — the last two health samples, newest last).

**Interfaces:**
- RULE_DEFAULTS: churn rules `{minRuns 2, resolveRuns 2, deviceLevel true, notify true}` except `network.churn` and `bridge.mqtt_backlog` (`deviceLevel false`).
- Rule behaviour per spec table; all exclude events within `graceMin` after `bridge.restartedAt` and after `monitor.startedAt` (announces and leaves during restarts are normal). `device.leave` stops when `lastSeenAt` > the leave event ts. `device.interview_failed` stops on a later `device_interview` event with status successful.
- Hysteresis: each rule's stop condition is checked when open; open condition must not already satisfy the stop condition (no reopen loops).

- [ ] **Step 1:** `git switch -c feat/p3-m04-churn`. Failing tests: rejoin churn 2 announces → none, 3 → warning, 10 in 24 h → critical, 2 address changes → warning, stops after 12 h quiet; `restart burst opens nothing` (every device announces within the grace after a restart → no churn, no network.churn, no leave); leave via event and via `leave_count_up`, stops when seen again; network.churn 5 devices in 15 min → warning, 4 → none, quiet 1 h stops; interview failed → warning, successful later → stops; backlog 51 then 51 → warning, 51 then 40 → none, open + 9 → stops; multi-run no-reopen test for rejoin churn.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean. Commit `feat: add churn, interview and backlog rules`.
- [ ] **Step 3 (controller):** replay gate.

### Task 4: Storm rules, msg_per_min baselines, Chatty toggle (Milestone 05, T06)

**Files:** Create `src/lib/server/rules/storm.ts`; modify `trends/rollup.ts` (`computeBaselines` adds `msg_per_min` per device = mean hourly `msgCount`/60 over hours with rows, and network `|msg_per_min` = sum of device means; `days` as Phase 2), `BaselineMetric`, `engine.ts` (RuleContext gains `minutes: MinuteCounters`), rules index/types, settings, `src/routes/devices/[ieee]/` (Chatty toggle using `setTag`).

**Interfaces:**
- device.storm: last `stormSustainMin` complete minutes all > `stormFactor` × baseline and > `stormMinPerMin`; critical when all > `stormCritPerMin`; open stops when the last `stormClearMin` minutes are all < `stormClearFactor` × baseline. Needs baseline days ≥ `baselineMinDays` and `stormSustainMin` complete minutes since `monitor.startedAt`.
- device.dominant: over `dominantWindowMin`, top non-chatty share > `dominantPct` and network total ≥ `dominantMinMsgs`; open stops when share < `dominantClearPct` over `dominantClearMin`.
- network.storm (not device-level): network per-minute > `netStormFactor` × network baseline for `stormSustainMin` minutes; evidence `top: [{ name, perMin }] ×5`; stops < `netStormClearFactor` × baseline for `stormClearMin`.

- [ ] **Step 1:** `git switch -c feat/p3-m05-storm`. Failing tests: baseline `msg_per_min`; storm fires/holds/stops with exact thresholds; `needs a full window after start`; `restart burst is not a storm` (every device sends 30 msgs in the minute after a restart → none, because restart grace); thin baseline → none; dominant 31 % of 100 → warning, 31 % of 50 → none (min msgs), chatty excluded, stops < 15 % for 30 min; network storm evidence lists 5 contributors; multi-run no-reopen tests.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean; screenshot the Chatty toggle (controller). Commit `feat: add storm rules and chatty tag`.
- [ ] **Step 3 (controller):** replay gate.

### Task 5: Battery causing issues (escalation) and battery stale (Milestone 06, T07)

**Files:** Modify `src/lib/server/rules/battery.ts`, rules index/types, settings.

**Interfaces:**
- `battery.low` escalates to critical with `evidence.causingIssues: string[]` (e.g. `['rejoin churn', 'flapping']`) and summary `"Replace battery in <name>: <pct>% / <V> V, <first instability>"`, action `"Replace the battery"`, when battery ≤ `causingBatteryPct` (or coin cell ≤ `voltageLow`) AND within `causingWindowH`: ≥ `churnAnnounce` announces or ≥ `churnAddrChanges` address changes, ≥ `flappingCount` availability changes, current silence > 2 × `typicalGapMs`, LQI 24 h avg ≥ 25 % below `lqi_mean`, or ≥ `routeFailWarn` command failures. When none hold for `causingWindowH`, severity returns to its normal battery level (de-escalation is silent per lifecycle). Note: a device can satisfy causing-issues while above `batteryLowPct` (26–35 %): then `battery.low` opens directly at critical.
- `battery.stale` (info, `notify: false`, deviceLevel true): battery device whose last non-null battery sample is > `staleBatteryDays` old while its typical battery report gap (median gap of `samples_hourly.batteryMin` rows over 30 days) ≤ 24 h.

- [ ] **Step 1:** `git switch -c feat/p3-m06-battery`. Failing tests: escalation with each instability kind; 30 % + churn → critical open; 30 % without instability → nothing; de-escalation after 48 h stable; stale fires at 8 days for a daily reporter, not for a weekly reporter; stale never notifies (lifecycle).
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean. Commit `feat: add battery causing-issues escalation and stale batteries`.
- [ ] **Step 3 (controller):** replay gate.

### Task 6: Grouping (Milestone 07, T08)

**Files:** Create `src/lib/server/issues/grouping.ts`, `src/lib/server/rules/mass-offline.ts`; modify `issues/lifecycle.ts`, `engine.ts`, `tests/helpers/simulate.ts`, `scripts/replay.ts` (same insertion order), `src/routes/+page.(server.ts|svelte)` (parents with children in `<details>`), `src/routes/issues/[id]/` (children list / parent link), rules index/types, settings.

**Interfaces:**
- `IssueRow.parentIssueId: number | null` (column exists).
- `PARENT_RULES = { 'network.mass_offline': ['device.offline','device.flapping'], 'network.storm': ['device.storm','device.dominant'] }`; router parent = an open `device.offline` issue whose device type is Router, children = `device.offline` of EndDevices whose `lastSeenAt` is within ± `routerGroupWindowMin` of the router's `offlineSince`.
- `parentFor(child: Finding, candidates: { key: string; rule: RuleId; ieee: string | null; openedAt: number }[], devices: (ieee: string) => { type: string; lastSeenAt: number | null; offlineSince: number | null } | undefined, settings): string | null` — earliest-opened matching parent key.
- `LifecycleInput` gains `device: (ieee: string) => {...} | undefined`; `LifecycleResult` gains `parentOf: Map<string, string>` (child key → parent key) and `released: number[]` (child ids whose parent resolved). Opens are ordered parents first. Children: no `open`/`resolved`/`reminder`/`escalate` notify while the parent is open; parent finding's evidence gets `children: { count, names }` and summary suffix (router: `"<router> offline: N devices went silent after it"`). Released children: parent cleared and one `open` notify (`"still offline after the incident"` appended to summary).
- Already-open issues matching a parent opened this run are attached retroactively (update only, no notify).
- `network.mass_offline` (critical, not device-level): availability→offline events in the last `massOfflineWindowMin` minutes cover ≥ `massOfflineDevices` devices or ≥ `massOfflineRouterPct` % of routers; stops when currently offline routers < `massOfflineClearPct` % and offline devices < `massOfflineDevices`.

- [ ] **Step 1:** `git switch -c feat/p3-m07-grouping`. Failing tests: `children opening with their parent stay silent` (12 devices offline in one run → one mass_offline notify, 12 silent children); retroactive attach; router grouping by ±10 min (inside → child, 11 min → standalone); earliest parent wins; parent resolve releases still-open child with exactly one `open`; children resolving while parent open are silent; storm parent; mass offline thresholds; score not affected here.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean; screenshot Overview tree (controller). Commit `feat: group child issues under incidents`.
- [ ] **Step 3 (controller):** replay gate.

### Task 7: Health score (Milestone 08, T09)

**Files:** Create `src/lib/server/score.ts`; modify `trends/rollup.ts` or engine hourly job (store network score hourly in `health_scores`), Overview page (score next to banner, 24 h network msg/min sparkline from hourly `msgCount` sums), `src/lib/views.ts` (DeviceRow `score`, SortKey `'score'`), Devices page column.

**Interfaces:** `networkScore(issues: { severity: Severity; parentIssueId: number | null }[]): { score: number; status: Status }`; `deviceScore(issues: { severity: Severity }[]): number`. Status per spec: green ≥ 85 and no critical; red < 60 or any critical; otherwise amber.

- [ ] **Step 1:** `git switch -c feat/p3-m08-score`. Failing tests: formula and floor; children excluded from network score; colour bands incl. 85 with a warning → amber; device score sort; hourly history row written once per hour.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean; screenshot (controller). Commit `feat: add health score`.

### Task 8: Weekly digest (Milestone 09, T10)

**Files:** Create `src/lib/server/notify/weekly.ts`; modify `engine.ts` (call once per run), Settings channel forms (Weekly digest checkbox for Discord default on, Apprise default off), `notify/outbox.ts` if a helper is needed for per-channel enqueue of a digest message.

**Interfaces:** `shouldSendWeekly(now: number, lastWeek: string | null, tz: string): string | null` — returns the ISO week id (`2026-W43`) when local time is at/after Sunday 18:00 of that week and `lastWeek` differs; `weeklyDigest(db, state, now, tz): Message` (kind `digest`, severity info, fields per spec); last sent week stored in `settings` key `weeklyDigestWeek`. Enqueue to enabled channels with `config.weeklyDigest` (missing → Discord true, Apprise false), dedupe `weekly:<week>:<channelId>`.

- [ ] **Step 1:** `git switch -c feat/p3-m09-digest`. Failing tests: `once per week across DST and catch-up` (Sunday 2026-10-25 18:00 Oslo during DST change; MeshPulse down from 17:00 Sunday to Monday 09:00 → sent Monday once); not before Sunday 18:00; content sections present with real data from an in-memory DB; per-channel checkbox respected.
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean. Commit `feat: add weekly digest`.

### Task 9: Events page (Milestone 10, T11)

**Files:** Create `src/routes/events/+page.(server.ts|svelte)`; modify layout nav (Overview, Devices, Batteries, Issues, Events, Settings), `src/lib/views.ts` if a pure filter helper is needed.

**Interfaces:** load `?kind=&device=&page=`; kind must be a known `EventKind` (else ignored → empty result with a note), device must be a known IEEE (else empty), page 1-based, 100 per page, newest first, 90 days; rows show time (TZ), kind label, device link, `formatDetail`.

- [ ] **Step 1:** `git switch -c feat/p3-m10-events`. Failing tests: `rejects unknown filters`; pagination boundaries; kind + device combined; query uses the events ts index (no full scan per row).
- [ ] **Step 2:** Run → FAIL; implement; PASS; check clean; screenshot (controller). Commit `feat: add events page`.

### Task 10: Deploy and docs (Milestone 11, T12)

- [ ] **Step 1:** `git switch -c feat/p3-m11-deploy`. README (grouping, new rules, score, digest, Events page, replayer usage) and CLAUDE.md (file map, replayer command). Tests/check/build green. Commit `docs: describe Phase 3 features`.
- [ ] **Step 2 (controller):** final whole-branch review and one fix wave; replay the real capture one last time; rebuild on Unraid and recreate the container from its template; verify health, pages, and that no unexpected issues opened in the first hour.
