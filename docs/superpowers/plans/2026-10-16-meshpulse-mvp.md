# MeshPulse MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A passive Zigbee2MQTT monitor that turns MQTT traffic into a few
issues, sends them to Discord without spam, and shows a calm web UI.

**Architecture:** One SvelteKit (adapter-node) process. The server `init` hook
starts a collector (MQTT → in-memory state + SQLite), a 60 s rules engine
(pure rules → pure lifecycle → one DB transaction), an outbox worker and a
heartbeat. The UI reads SQLite and the in-memory state.

**Tech Stack:** Node 24, SvelteKit 3 + Svelte 5 + TypeScript 6 (strict), Vite 8,
Drizzle ORM 0.45 + better-sqlite3 (WAL), drizzle-kit, mqtt.js 5, Better Auth 1.7,
Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-16-meshpulse-mvp-design.md` (wins
over `docs/SPEC.md` where they differ).

## Global Constraints

- Read-only on MQTT: the app never publishes.
- All storage keyed by IEEE address. `devices.instance_id` defaults to `'default'`.
- Timestamps: UTC epoch ms in the DB; displayed in `TZ` (default `Europe/Oslo`).
- TypeScript `strict: true`. Imports use the `#lib/*` alias (SvelteKit 3).
- SvelteKit 3: use `$app/env` (not `$app/environment`). adapter-node has no
  `ORIGIN` env; origin comes from the `Host` header or `PROTOCOL_HEADER`/`HOST_HEADER`.
- No new dependency beyond the stack above without asking.
- Git: one branch per milestone (`feat/mNN-<slug>`), conventional commits,
  PR squash-merged with `gh pr merge --squash --delete-branch`. No AI
  attribution in commits or PRs.
- Update the paseo-progress milestone (T02–T12) at start, each stage, and done.
- Severity values: `'info' | 'warning' | 'critical'`.
- Default thresholds are the values in the `DEFAULT_SETTINGS` table in Task 2.

## Review Focus

1. Retained `<name>/availability` arriving before the first `bridge/devices` on
   a fresh DB → must not be lost; it applies once the device list arrives
   (Task 3, `buffers messages for unknown names until bridge/devices`).
2. Non-JSON or malformed payloads on any topic (`"ON"`, `""`, truncated JSON) →
   ignored, the collector keeps running (Task 3, `ignores malformed payloads`).
3. Device payload `last_seen` as ISO string, epoch ms, or missing → all
   handled (Task 3, `parses last_seen in all formats`).
4. Discord webhook deleted (404) or unreachable → retries 1/5/30 min, then
   `failed`, shown in Settings; never an endless loop (Task 8, `marks failed after 4 attempts`).
5. Device removed from Z2M while it has an open issue → produces no findings,
   the issue resolves, nothing crashes on the missing device (Task 6,
   `removed and ignored devices produce no findings`).

---

## File map

```
src/hooks.server.ts                  init → startRuntime(); handle → auth + login guard
src/lib/server/config.ts             loadConfig(env) → Config
src/lib/server/db/schema.ts          Drizzle tables (app)
src/lib/server/db/auth-schema.ts     Better Auth tables (generated)
src/lib/server/db/index.ts           openDb(path) → Db (WAL + migrate); getDb()
src/lib/server/settings.ts           DEFAULT_SETTINGS, getSettings, saveSettings
src/lib/server/types.ts              AppState, DeviceState, Finding, IssueRow, Message, Severity, Effect
src/lib/server/mqtt/route.ts         route(state, msg, baseTopic) → Effect[]
src/lib/server/mqtt/parse.ts         parseJson, parseAvailability, parseLastSeen, normaliseVoltage
src/lib/server/mqtt/collector.ts     startCollector(deps) — mqtt.js + effect persistence
src/lib/server/prereqs.ts            checkPrereqs(config) → Prereq[]
src/lib/server/rules/*.ts            one file per rule + index.ts (RULES, RULE_DEFAULTS)
src/lib/server/issues/lifecycle.ts   evaluate(input) → LifecycleResult
src/lib/server/issues/quiet.ts       isQuietHours(now, settings, tz)
src/lib/server/engine.ts             runOnce(deps, now); startEngine(deps)
src/lib/server/notify/channel.ts     Channel, CHANNELS registry, enqueue()
src/lib/server/notify/discord.ts     discord: Channel, toDiscordPayload()
src/lib/server/notify/outbox.ts      outboxTick(deps, now); startOutbox(deps)
src/lib/server/crypto.ts             encrypt, decrypt
src/lib/server/retention.ts          prune(db, now)
src/lib/server/heartbeat.ts          heartbeatTick(deps, now); startHeartbeat(deps)
src/lib/server/auth.ts               getAuth(), ensureAdmin()
src/lib/server/runtime.ts            startRuntime(), runtime singleton (state, db, config)
src/routes/...                       pages (Task 10), api/health (Task 9)
scripts/capture.ts                   record zigbee2mqtt/# to JSONL
tests/fixtures/*.jsonl               fixture traffic
tests/helpers/simulate.ts            pure replay harness: router → rules → lifecycle
```

Fixture line format (also the capture format):
`{"ts": 1760000000000, "topic": "zigbee2mqtt/bridge/state", "payload": {"state":"online"}, "retain": true}`.
`payload` is parsed JSON when valid, otherwise the raw string.

---

### Task 1: Project setup and CLAUDE.md (Milestone 02, T02)

**Files:**
- Create: scaffold via `npx sv create`, `CLAUDE.md`, `src/lib/server/config.ts`, `.gitignore` additions (`/data`, `*.db*`, `captures/`)
- Test: `src/lib/server/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string,string|undefined> = process.env): Config`
  where `Config = { mqttUrl, mqttUsername?, mqttPassword?, baseTopic, databasePath, publicUrl?, tz, secretKey, heartbeatUrl?, adminEmail?, adminPassword? }`.
  Defaults: `mqtt://mosquitto:1883`, `zigbee2mqtt`, `/data/meshpulse.db`, `Europe/Oslo`. Throws `Error('SECRET_KEY is required')` when missing.

- [ ] **Step 1:** `git switch -c feat/m02-setup`. Scaffold in a temp dir and move in (dir is not empty):
  `npx sv create /tmp/mp --template minimal --types ts --no-add-ons --install npm`, copy into the repo, then
  `npx sv add vitest` and `npm i -D @sveltejs/adapter-node` and set the adapter in `svelte.config.js`.
  Expected: `npm run check` and `npm test -- --run` pass on the empty project.
- [ ] **Step 2: Write failing tests** in `config.test.ts`:
  `applies defaults` (`loadConfig({SECRET_KEY:'x'}).baseTopic === 'zigbee2mqtt'`, `databasePath === '/data/meshpulse.db'`, `tz === 'Europe/Oslo'`),
  `requires SECRET_KEY` (`expect(() => loadConfig({})).toThrow('SECRET_KEY is required')`).
- [ ] **Step 3:** Run `npx vitest run src/lib/server/config.test.ts` → FAIL.
- [ ] **Step 4:** Implement `loadConfig`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Write `CLAUDE.md`: purpose (1 line), commands (`npm run dev`, `npm test`, `npm run check`, `npx drizzle-kit generate`, `npm run capture`), architecture (the paragraph above + file map), conventions (Global Constraints), and "rules and lifecycle are pure; test them with fixtures".
- [ ] **Step 7:** Commit `chore: scaffold SvelteKit project`, push, `gh pr create`, `gh pr merge --squash --delete-branch`.

### Task 2: Database, settings and retention (Milestone 03, T03)

**Files:**
- Create: `drizzle.config.ts`, `src/lib/server/db/{schema,auth-schema,index}.ts`, `src/lib/server/settings.ts`, `src/lib/server/retention.ts`, `drizzle/` (generated)
- Test: `src/lib/server/db/db.test.ts`, `src/lib/server/retention.test.ts`

**Interfaces:**
- Produces:
  - `openDb(path: string): Db` — better-sqlite3, `journal_mode = WAL`, `foreign_keys = ON`, runs `migrate(db, { migrationsFolder: 'drizzle' })`. `':memory:'` works for tests. `getDb()` returns a lazy singleton from `loadConfig().databasePath`.
  - Tables per the design's Data model. Column names in camelCase in TS, snake_case in SQL. JSON columns use `text({ mode: 'json' })`. `issues` has `uniqueIndex('issues_open_unique').on(rule, ieeeKey).where(sql\`state != 'resolved'\`)` where `ieee_key` is `ieee` or `''` (NULLs are distinct in SQLite unique indexes).
  - `outbox.status`: `'pending' | 'held' | 'sent' | 'failed'`.
  - `DEFAULT_SETTINGS` (exact values):
    `bridgeSilenceMin 5, permitJoinMaxMin 10, mqttLostSec 60, graceMin 15, restartWarnCount 3, silenceMultiplier 3, silenceMinH 2, silenceMaxH 25, flappingCount 4, flappingClearBelow 2, flappingWindowH 6, batteryLowPct 25, batteryCriticalPct 10, batteryClearPct 40, voltageLow 2.8, voltageCritical 2.6, voltageClear 2.9, coinCellMaxV 3.3, quietEnabled true, quietStart '23:00', quietEnd '07:00', reminderCriticalH 6, reminderWarningH 24, heartbeatUrl ''`.
    `type Settings = typeof DEFAULT_SETTINGS`.
  - `getSettings(db): Settings` (defaults merged with rows), `saveSettings(db, patch: Partial<Settings>): void`.
  - `prune(db, now): void` — samples > 14 d, events > 90 d, resolved issues > 90 d, sent outbox > 7 d.

- [ ] **Step 1:** `git switch -c feat/m03-database`. Install `drizzle-orm better-sqlite3 better-auth` and `-D drizzle-kit @types/better-sqlite3`. Write `src/lib/server/auth.ts` minimal config (Task 10 completes it) and generate `auth-schema.ts` with `npx auth generate --adapter drizzle --dialect sqlite --output src/lib/server/db/auth-schema.ts -y`.
- [ ] **Step 2: Failing tests** in `db.test.ts`: `opens in-memory db with all tables` (query `sqlite_master` contains `devices, samples, events, issues, outbox, channels, settings, user, session, account, verification`); `allows only one unresolved issue per rule and device` (second insert with same `rule`+`ieeeKey`, state `open` throws; with first resolved it succeeds; two `ieee=null` bridge issues with the same rule throw); `settings round-trip` (`saveSettings(db,{batteryLowPct:30})` → `getSettings(db).batteryLowPct === 30`, `.graceMin === 15`).
- [ ] **Step 3:** Run → FAIL. **Step 4:** Write schema, `npx drizzle-kit generate --name=init`, implement `openDb`, settings. **Step 5:** Run → PASS.
- [ ] **Step 6: Failing test** `retention.test.ts` `prunes by age`: rows at `now - 15d` (sample), `now - 91d` (event, resolved issue), `now - 8d` (sent outbox) deleted; rows just inside each limit kept. Run → FAIL, implement `prune`, run → PASS.
- [ ] **Step 7:** Commit `feat: add database schema, settings and retention`, PR, squash-merge.

### Task 3: Traffic capture script (Milestone 12, T12)

**Files:**
- Create: `scripts/capture.ts`, `package.json` script `"capture": "node scripts/capture.ts"` (Node 24 runs TypeScript natively; keep the script free of `#lib` imports and TS-only syntax like enums)
- Test: none beyond a manual run (thin wrapper around mqtt.js; format is pinned by Task 4's fixture loader).

- [ ] **Step 1:** `git switch -c feat/m12-capture`. `npm i mqtt`.
- [ ] **Step 2:** Implement: reads `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `Z2M_BASE_TOPIC`; arg 1 = output path (default `captures/<ISO date>.jsonl`). Subscribes to `<base>/#`, appends one line per message in the fixture format (`retain` from `packet.retain`), prints a count every 60 s, closes the file on SIGINT.
- [ ] **Step 3:** Run against a local broker if one is available (`docker run -d -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf`, publish two messages with `mosquitto_pub -r`) → Expected: 2 lines with `"retain": true`.
- [ ] **Step 4:** README stub section "Recording traffic". Commit `feat: add MQTT capture script`, PR, squash-merge. Tell the user they can start recording now.

### Task 4: Collector — router (Milestone 04, T04, part 1)

**Files:**
- Create: `src/lib/server/types.ts`, `src/lib/server/mqtt/parse.ts`, `src/lib/server/mqtt/route.ts`, `tests/fixtures/{startup,devices,restart,battery-swap,rename}.jsonl`, `tests/helpers/fixtures.ts`
- Test: `src/lib/server/mqtt/route.test.ts`, `src/lib/server/mqtt/parse.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  ```ts
  type Severity = 'info' | 'warning' | 'critical';
  interface DeviceState { ieee: string; friendlyName: string; type: 'Coordinator'|'Router'|'EndDevice'; powerSource: string|null;
    model: string|null; vendor: string|null; firmware: string|null; networkAddress: number|null;
    availability: 'online'|'offline'|null; lastSeenAt: number|null; removedAt: number|null; mutedUntil: number|null;
    tags: string[]; ignoreRules: string[]; typicalGapMs: number|null; maxVoltage: number|null;
    lqi: number|null; battery: number|null; voltage: number|null; batteryLow: boolean|null;
    recentSeen: number[]; lastSampleAt: number|null; offlineSince: number|null }
  interface BridgeState { state: 'online'|'offline'|null; onlineSince: number|null; info: Record<string, any>|null;
    version: string|null; permitJoin: boolean; permitJoinSince: number|null; lastUptimeSec: number|null;
    lastLiveAt: number|null; restartedAt: number|null }
  interface MonitorState { connected: boolean; downSince: number|null; startedAt: number; lastRulesRunAt: number|null }
  interface AppState { devices: Map<string, DeviceState>; byName: Map<string, string>; devicesLoaded: boolean;
    pending: MqttMsg[]; bridge: BridgeState; monitor: MonitorState }
  interface MqttMsg { ts: number; topic: string; payload: unknown; retain: boolean }
  type EventKind = 'availability'|'bridge_state'|'bridge_restart'|'bridge_version'|'device_joined'|'device_leave'|'device_announce'|'device_interview'|'battery_swap';
  interface NewEvent { ts: number; ieee: string|null; kind: EventKind; detail: Record<string, unknown> }
  type Effect = { kind: 'event'; event: NewEvent } | { kind: 'sample'; ieee: string; ts: number; lqi: number|null; battery: number|null; voltage: number|null }
    | { kind: 'dirty'; ieee: string };
  function createState(now: number): AppState;
  ```
- `route(state: AppState, msg: MqttMsg, baseTopic: string): Effect[]` — mutates `state`, returns persistence effects.
- `parse.ts`: `parseAvailability(p): 'online'|'offline'|null` (JSON `{state}` or string), `parseLastSeen(v, fallback): number` (epoch ms number, ISO string, else fallback), `normaliseVoltage(v): number|null` (> 100 → /1000).
- `tests/helpers/fixtures.ts`: `loadFixture(name): MqttMsg[]` (prefixes nothing; fixture topics are full).

Fixtures use the Z2M 2.x shapes: `bridge/devices` entries `{ieee_address, friendly_name, type, power_source, network_address, software_build_id, disabled, definition:{model, vendor}}`; `bridge/info` `{version, coordinator:{type}, network:{channel}, permit_join, config:{availability:{enabled:true}, health:{interval:10}, advanced:{log_output:['console','mqtt']}}}`; `bridge/event` `{type, data:{friendly_name, ieee_address, status?}}`; `bridge/health` `{process:{uptime_sec}, mqtt:{queued}, devices:{}}`. `startup.jsonl` holds a coordinator, 2 routers (one with name `living/lamp`), 3 end devices (one coin cell at 3000 mV), retained availability **before** `bridge/devices`.

- [ ] **Step 1:** `git switch -c feat/m04-collector`. Write fixtures and `loadFixture`.
- [ ] **Step 2: Failing tests** `parse.test.ts`: `parses availability JSON and plain`; `parses last_seen in all formats` (`parseLastSeen(1760000000000, 5) === 1760000000000`, ISO `'2026-10-16T10:00:00.000Z'` → its epoch, `undefined` → 5); `normalises millivolts` (`3000 → 3`, `2.9 → 2.9`, `null → null`).
- [ ] **Step 3: Failing tests** `route.test.ts`:
  - `builds inventory from bridge/devices` — 6 devices, `byName.get('living/lamp')` is its IEEE, types right.
  - `buffers messages for unknown names until bridge/devices` — availability before devices → after devices, `availability === 'offline'` for the fixture's offline router.
  - `marks devices missing from bridge/devices as removed` and clears `removedAt` when they return.
  - `rename keeps history keyed by IEEE` — `rename.jsonl`: same IEEE, new name; old name no longer maps; messages on the new name update the same device.
  - `ignores /set, /get, groups and bridge/logging` — returns `[]`, no state change.
  - `ignores malformed payloads` — `'ON'`, `''`, `'{"a":'` on a device topic → `[]`, no throw.
  - `retained device state is not live` — retained `{battery: 80}` sets `battery` but not `lastSeenAt`, `recentSeen`, `bridge.lastLiveAt`; retained with `last_seen` sets `lastSeenAt` from the payload.
  - `live message updates seen, gaps and samples at most every 5 min` — 3 live msgs at t, t+1 min, t+6 min → `sample` effects at t and t+6 min only; `recentSeen` length 3; `lastLiveAt` = t+6 min.
  - `learns typical gap as median of last 20 gaps once 5 gaps exist` — 6 msgs at 10-min spacing → `typicalGapMs === 600000`; with 4 gaps → `null`.
  - `availability change emits one event` — offline→offline again emits nothing; sets/clears `offlineSince`.
  - `bridge offline→online is a restart` and `uptime drop is a restart` — `bridge_restart` event, `restartedAt` set; uptime rise → no event.
  - `bridge/info tracks permit_join since and version changes` — `permitJoinSince` set on false→true, cleared on true→false; second info with new version → `bridge_version` event; first info → no event.
  - `battery jump > 30 points is a swap` — `battery_swap` event from 15 → 100; 15 → 40 no event. `maxVoltage` tracks the highest normalised voltage.
  - `bridge/event kinds become events` — announce, leave, joined, interview (with `status`).
- [ ] **Step 4:** Run `npx vitest run src/lib/server/mqtt` → FAIL. **Step 5:** Implement. Topic matching: strip `<base>/`; if rest starts with `bridge/` handle bridge topics; else if rest ends with `/availability` and the prefix is a known name → availability; else if rest is a known name → device; else if `!devicesLoaded` push to `pending` (cap 5000, drop oldest); else ignore. After `bridge/devices` set `devicesLoaded = true` and replay `pending`. Emit `dirty` for every device whose stored columns changed. **Step 6:** Run → PASS. Commit `feat: add MQTT topic router`.

### Task 5: Collector — wiring and persistence (Milestone 04, T04, part 2)

**Files:**
- Create: `src/lib/server/mqtt/collector.ts`, `src/lib/server/store.ts`
- Test: `src/lib/server/store.test.ts`

**Interfaces:**
- Produces:
  - `store.ts`: `loadDevices(db, state): void` (DB rows → `state.devices` + `byName`, `devicesLoaded` stays false); `applyEffects(db, effects: Effect[], state): void` (events + samples inserted, `dirty` IEEEs added to `state`-external `Set<string>`); `flushDevices(db, state, dirty: Set<string>): void` (upsert in one transaction, clear set).
  - `startCollector({ config, state, db, onEffects }): { client: MqttClient, stop(): Promise<void> }` — `mqtt.connect(config.mqttUrl, { username, password, reconnectPeriod: 5000 })`, subscribe `${baseTopic}/#`; `message` → try `route` (catch + `console.warn`, never throws); `connect` → `monitor.connected = true, downSince = null`; `close`/`offline` → `connected = false`, `downSince ??= now`.
- `devices` upsert writes all persisted columns (not `recentSeen`, `lastSampleAt`, `lqi/battery/voltage/batteryLow` — those live in `samples`; on start, `loadDevices` fills `battery/voltage/lqi` from the latest sample per device).

- [ ] **Step 1: Failing tests** `store.test.ts` (in-memory DB): `persists dirty devices and reloads them` (route `startup.jsonl`, apply, flush, new state + `loadDevices` → same names, `typicalGapMs`, `maxVoltage`, latest `battery`); `writes events and samples`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement store + collector. **Step 4:** Run → PASS.
- [ ] **Step 5:** (The live broker check happens in Task 10 Step 5, once the runtime starts the collector.)
- [ ] **Step 6:** Commit `feat: wire MQTT collector to SQLite`, PR (covers Tasks 4–5), squash-merge.

### Task 6: Prerequisites check (Milestone 05, T05)

**Files:**
- Create: `src/lib/server/prereqs.ts`
- Test: `src/lib/server/prereqs.test.ts`

**Interfaces:**
- Produces: `checkPrereqs(info: Record<string,any>|null): { key: 'availability'|'health'|'mqtt_log'; ok: boolean; fix: string }[]`; `null` info → `[]` (unknown, no banner until `bridge/info` arrives). `fix` strings are the YAML lines from `docs/SPEC.md` "Prerequisites".

- [ ] **Step 1:** `git switch -c feat/m05-prereqs`. **Failing tests:** `all present` (all ok); `availability as boolean true` ok; `availability.enabled false` → not ok; `health missing` → not ok; `advanced.log_output` without `mqtt` → not ok; `null info → []`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. Commit `feat: check Z2M prerequisites`, PR, squash-merge.

### Task 7: Detection rules (Milestone 06, T06)

**Files:**
- Create: `src/lib/server/rules/{index,bridge-offline,bridge-restarted,permit-join,mqtt-lost,device-offline,device-flapping,battery}.ts`
- Test: one `*.test.ts` per rule file, plus `rules/index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type RuleId = 'bridge.offline'|'bridge.restarted'|'bridge.permit_join_open'|'monitor.mqtt_lost'|'device.offline'|'device.flapping'|'battery.low';
  interface EventRow extends NewEvent { id: number }
  interface RuleContext { now: number; state: AppState; events: EventRow[] /* last 24 h, ascending */; settings: Settings; open: Set<string> /* issueKey */ }
  interface Finding { rule: RuleId; ieee: string|null; severity: Severity; summary: string; action: string; evidence: Record<string, unknown> }
  type Rule = (ctx: RuleContext) => Finding[];
  const issueKey = (rule: string, ieee: string|null) => `${rule}|${ieee ?? ''}`;
  const RULES: Rule[];
  const RULE_DEFAULTS: Record<RuleId, { minRuns: number; resolveRuns: number; deviceLevel: boolean }>;
  function inGrace(ctx): boolean  // now < max(monitor.startedAt, bridge.restartedAt ?? 0) + graceMin
  function evaluateRules(ctx): Finding[]  // runs RULES, drops findings for removed devices, `ignore` tag, or rule in ignoreRules
  ```
- `RULE_DEFAULTS`: `minRuns` 2 for all except `monitor.mqtt_lost` and `bridge.permit_join_open` (1, their condition already has a duration); `resolveRuns` 2 for all; `deviceLevel` true for `device.*` and `battery.low`.
- Each rule is "still bad" by its stop condition when `ctx.open` has its key, by its start condition otherwise (hysteresis). Summaries are plain English with the device's friendly name; `battery.low` evidence includes `level: 'battery.low' | 'battery.critical'`.

- [ ] **Step 1:** `git switch -c feat/m06-rules`. Write a `ctx()` test builder in `tests/helpers/ctx.ts` (fresh state from `startup.jsonl`, `now` well past grace).
- [ ] **Step 2: Failing tests**, per rule (each: fires, does not fire, stops with hysteresis):
  - `bridge.offline`: fires critical when `bridge.state === 'offline'`; fires when `lastLiveAt` 5 min ago and not in grace; does not fire at 4 min 59 s; silence part suppressed in grace; when open, keeps firing until online for ≥ 2 min and `lastLiveAt` < 2 min old.
  - `bridge.restarted`: info for one restart event 30 min ago; warning with 3 restarts in 24 h; nothing 61 min after the last restart.
  - `bridge.permit_join_open`: warning at `permitJoinSince` 10 min + 1 s ago; nothing at 9 min; nothing when `permitJoin` false.
  - `monitor.mqtt_lost`: critical when `downSince` 61 s ago; nothing at 59 s or when connected.
  - `device.offline`: router `availability offline` → warning; end device offline → warning; end device online but silent > 3 × `typicalGapMs` (gap 1 h → threshold clamped to 2 h: fires at 2 h + 1 s, not at 1 h 59 min); gap 10 h → threshold 25 h (clamped); `typicalGapMs null` → no silence finding; silence suppressed in grace; evidence includes `offlineSince`.
  - `device.flapping`: 4 availability events in 6 h → warning; 3 → nothing; events within `graceMin` after `restartedAt` not counted; open + 2 events in window → still fires; open + 1 → stops; suppressed in grace.
  - `battery.low`: 25 % → warning; 10 % → critical; `batteryLow: true` → warning; coin cell (`maxVoltage` 3.0) at 2.8 V → warning, 2.6 V → critical even with `battery` 50; multi-cell device (`maxVoltage` 6.0) reporting 2.8 V with battery 60 → nothing; open + battery 35 → still fires; open + 41 → stops; open coin cell + 2.95 V → stops.
  - `index.test.ts`: `removed and ignored devices produce no findings` (removed device offline, `tags: ['ignore']`, `ignoreRules: ['battery.low']` → no findings for them).
- [ ] **Step 3:** Run `npx vitest run src/lib/server/rules` → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS. Commit `feat: add MVP detection rules`.

### Task 8: Issue lifecycle, quiet hours and engine (Milestone 07, T07)

**Files:**
- Create: `src/lib/server/issues/{lifecycle,quiet}.ts`, `src/lib/server/engine.ts`, `tests/helpers/simulate.ts`, fixtures `{z2m-restart,mass-reconnect,mqtt-lost}.jsonl`
- Test: `issues/lifecycle.test.ts`, `issues/quiet.test.ts`, `engine.test.ts`, `tests/scenarios.test.ts`

**Interfaces:**
- Consumes: `Finding`, `issueKey`, `RULE_DEFAULTS` (Task 7); `Settings` (Task 2).
- Produces:
  ```ts
  interface IssueRow { id: number; rule: RuleId; ieee: string|null; severity: Severity; state: 'open'|'acknowledged'|'resolved';
    openedAt: number; updatedAt: number; resolvedAt: number|null; summary: string; action: string; evidence: Record<string,unknown>; lastNotifiedAt: number|null }
  interface Counters { seen: Map<string, number>; missing: Map<string, number> }
  type NotifyKind = 'open'|'escalate'|'reminder'|'resolved';
  interface Notify { key: string; kind: NotifyKind; severity: Severity }
  interface LifecycleInput { findings: Finding[]; issues: IssueRow[] /* unresolved */; counters: Counters;
    mutedUntil: (ieee: string) => number|null; settings: Settings; now: number }
  interface LifecycleResult { opens: Finding[]; updates: { id: number; patch: Partial<IssueRow> }[]; notify: Notify[] }
  function evaluate(input: LifecycleInput): LifecycleResult;   // mutates counters
  function isQuietHours(now: number, settings: Settings, tz: string): boolean;
  function quietHoursEnded(prev: number, now: number, settings, tz): boolean;
  function runOnce(deps: { db: Db; state: AppState; counters: Counters; config: Config }, now: number): void;
  function startEngine(deps): { stop(): void };   // setInterval 60 s; flushDevices + prune hourly
  ```
- Rules for `evaluate` (from the design): open after `minRuns` consecutive runs; refresh `summary/evidence/updatedAt` every run; severity up → `escalate` (also when acknowledged); down → silent; resolve after `resolveRuns` missing runs → `resolved` notify with `evidence.durationMs`; reminders at `reminderCriticalH`/`reminderWarningH` since `lastNotifiedAt`, never for info, never when acknowledged; muted device (`mutedUntil > now`) → no notify; **flood guard**: when an unresolved `bridge.offline` or `monitor.mqtt_lost` issue exists, no `opens` for `deviceLevel` rules (counters still advance). Every emitted notify sets `lastNotifiedAt = now` via `updates` (for opens, the caller sets it on insert).
- `runOnce`: builds `RuleContext` (events last 24 h from DB), `evaluateRules`, `evaluate`, then in **one transaction**: insert opens, apply updates, `enqueue()` each notify (Task 9; until then a no-op injected via deps), set `monitor.lastRulesRunAt`. Then `flushDevices`. On `quietHoursEnded` it calls `foldHeld()` (Task 9).
- `simulate.ts`: `simulate(msgs: MqttMsg[], opts: { until: number; settings?: Partial<Settings>; hooks?: Record<number, (s: AppState) => void> }) → { issues: IssueRow[]; notifies: (Notify & { at: number })[] }` — pure in-memory: routes messages in time order, runs rules + lifecycle every 60 s of fixture time, keeps issues and events in arrays.

- [ ] **Step 1:** `git switch -c feat/m07-lifecycle`. **Failing tests** `lifecycle.test.ts`: `opens after 2 runs` (1 run → no open; 2 → open + notify open); `one bad sample never alerts` (finding, missing, finding → no open); `escalates and notifies`; `escalation notifies even when acknowledged`; `de-escalates silently`; `resolves after 2 missing runs with duration`; `reminds critical after 6 h, warning after 24 h, never info`; `no reminders when acknowledged`; `muted device opens but never notifies`; `flood guard blocks new device issues but keeps updating open ones`.
- [ ] **Step 2:** `quiet.test.ts`: `23:30 Oslo is quiet`, `06:59 quiet`, `07:00 not quiet`, `quietEnabled false never quiet`, `quietHoursEnded true once when crossing 07:00` (DST-safe: test 2026-10-25, the night Oslo leaves summer time).
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement lifecycle + quiet. **Step 5:** Run → PASS.
- [ ] **Step 6: Failing scenario tests** `tests/scenarios.test.ts` (via `simulate`):
  - `Z2M restart`: `bridge/state` offline for 40 s then online, devices republish availability → exactly one `bridge.restarted` (info) opens, **no** `bridge.offline` (only 1 run saw it), no device issues. Variant: offline 3 min → exactly one `bridge.offline` open and one resolve, still no device issues.
  - `mass reconnect after restart`: 20 devices go offline→online within 2 min after restart → no `device.flapping`, no `device.offline`.
  - `battery swap`: coin cell 2.55 V (critical open) → swap to 3.1 V → one `battery_swap` event, issue resolved, notifies `[open, resolved]` only.
  - `renamed device`: open `battery.low` on old name → rename → same issue updated, no new issue, no duplicate notify.
  - `MQTT lost`: monitor down 61 s → `monitor.mqtt_lost` critical opens; reconnect → resolves; device offline during the outage does not open.
  - `no duplicate notifies`: across all scenarios, no two notifies share `key+kind+severity` except reminders.
- [ ] **Step 7:** Run → FAIL. Implement `simulate` + `engine.ts`; `engine.test.ts` `runOnce persists opens and updates in one transaction` (in-memory DB, startup fixture + offline router, two `runOnce` → one `issues` row state `open`, `lastRulesRunAt` set). **Step 8:** Run all → PASS. Commit `feat: add issue lifecycle and rules engine`, PR (Tasks 7–8 may share one PR if Task 7's PR is open), squash-merge.

### Task 9: Discord channel and outbox (Milestone 08, T08)

**Files:**
- Create: `src/lib/server/crypto.ts`, `src/lib/server/notify/{channel,discord,outbox}.ts`
- Test: `crypto.test.ts`, `notify/discord.test.ts`, `notify/outbox.test.ts`

**Interfaces:**
- Consumes: `Notify`, `IssueRow` (Task 8), outbox/channels tables (Task 2).
- Produces:
  ```ts
  interface Message { severity: Severity | 'resolved'; title: string; summary: string; action?: string;
    fields: { name: string; value: string }[]; url?: string; kind: NotifyKind | 'digest' }
  class ChannelError extends Error { retryAfterMs?: number }
  interface Channel { kind: string; send(config: Record<string, unknown>, message: Message): Promise<void> }
  const CHANNELS: Record<string, Channel>;   // { discord }
  function toMessage(issue: IssueRow, kind: NotifyKind, deviceName: string|null, publicUrl?: string): Message;
  function enqueue(db, issue: IssueRow, n: Notify, deps: { now: number; quiet: boolean; publicUrl?: string; deviceName: string|null }): void;
  function foldHeld(db, now: number): void;   // per channel: all `held` rows → one `pending` digest row, held rows → `sent`
  function outboxTick(deps: { db; secretKey: string; fetch?: typeof fetch }, now: number): Promise<void>;
  function startOutbox(deps): { stop(): void };   // every 2 s
  function sendTest(db, channelId: number, secretKey: string): Promise<{ ok: boolean; error?: string }>;
  function toDiscordPayload(m: Message, cfg: { mentionCritical: boolean }): { content?: string; embeds: object[]; allowed_mentions: object };
  function encrypt(plain: string, secret: string): string;  // base64(iv|tag|ciphertext), AES-256-GCM, scrypt(secret, 'meshpulse', 32)
  function decrypt(blob: string, secret: string): string;
  ```
- Severity → minimum check order `info < warning < critical`; `resolved` uses the issue's severity for `min_severity`.
- Discord colours: critical `0xE53935`, warning `0xFFB300`, info `0x1E88E5`, resolved `0x43A047`. `@here` only for critical open/escalate/reminder when `mentionCritical`. Channel config: `{ webhookUrl (encrypted), mentionCritical: boolean }`.
- Backoff after failed attempt n: `[60_000, 300_000, 1_800_000][n-1]`; after the 4th failure → `failed`. 429 → `next_attempt_at = now + retryAfterMs`. Per-channel spacing ≥ 2000 ms (in-memory `lastSentAt`). > 3 due rows for a channel → one digest ("N new issues", fields = titles), all marked `sent`.

- [ ] **Step 1:** `git switch -c feat/m08-discord`. **Failing tests:** `crypto`: round-trip; wrong secret throws; two encryptions differ. `discord`: `critical open has red embed and @here when enabled`; `resolved is green, no mention`; `allowed_mentions only parses everyone when mentioning`; `links to PUBLIC_URL/issues/<id>`.
- [ ] **Step 2: Failing tests** `outbox.test.ts` (in-memory DB, fake `fetch`): `enqueue respects min_severity`; `enqueue during quiet hours holds warning, sends critical`; `dedupe key blocks a second identical row`; `sends and marks sent`; `retries with 1/5/30 min backoff then marks failed after 4 attempts`; `honours 429 retry_after`; `spaces sends 2 s per channel`; `folds more than 3 due rows into one digest`; `foldHeld makes one digest`.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement; wire `enqueue`/`foldHeld` into `runOnce` (replace the Task 8 no-op). **Step 5:** Run all tests → PASS. Commit `feat: add Discord channel and outbox`, PR, squash-merge.

### Task 10: Heartbeat, health endpoint and runtime (Milestone 09, T09)

**Files:**
- Create: `src/lib/server/heartbeat.ts`, `src/lib/server/runtime.ts`, `src/routes/api/health/+server.ts`; Modify: `src/hooks.server.ts`
- Test: `heartbeat.test.ts`, `src/routes/api/health/health.test.ts`

**Interfaces:**
- Produces:
  - `isHealthy(monitor: MonitorState, now): boolean` — `connected && lastRulesRunAt !== null && now - lastRulesRunAt <= 120_000`.
  - `heartbeatTick({ state, url, fetch }, now): Promise<'sent'|'skipped'>` — GET when `url && isHealthy`; errors logged, return `'sent'` only on 2xx.
  - `startHeartbeat({ state, db, config }): { stop(): void }` — every 60 s.
  - `runtime.ts`: `startRuntime(): Runtime` (idempotent via `globalThis.__meshpulse`) — `loadConfig`, `getDb`, `createState`, `loadDevices`, `ensureAdmin` (Task 11; until then skip), `startCollector`, `startEngine`, `startOutbox`, `startHeartbeat`; `getRuntime(): Runtime` where `Runtime = { config, db, state }`.
  - `GET /api/health` → `{ mqtt: boolean, lastMessageAt: number|null, lastRulesRunAt: number|null }`, 200 if `isHealthy` else 503. No auth.
  - `hooks.server.ts`: `export const init: ServerInit = async () => { startRuntime() }`.

- [ ] **Step 1:** `git switch -c feat/m09-heartbeat`. **Failing tests:** `healthy only when connected and rules ran within 2 min`; `heartbeat skipped when unhealthy or no url`; `heartbeat sends GET when healthy`; health endpoint returns 503 then 200 (call the `GET` handler with a stubbed `getRuntime`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. The heartbeat URL is `getSettings(db).heartbeatUrl || config.heartbeatUrl`. **Step 4:** Run → PASS.
- [ ] **Step 5:** `npm run dev` with `MQTT_URL` pointing at the local mosquitto loaded with `startup.jsonl` → `curl -s localhost:5173/api/health` → `"mqtt":true` and, after ~60 s, HTTP 200. Commit `feat: add heartbeat and health endpoint`, PR, squash-merge.

### Task 11: Login and web pages (Milestone 10, T10)

**Files:**
- Modify: `src/lib/server/auth.ts`, `src/hooks.server.ts`, `src/lib/server/runtime.ts`
- Create: `src/app.d.ts` locals, `src/routes/+layout.{svelte,server.ts}`, `src/routes/+page.{svelte,server.ts}` (Overview), `src/routes/login/+page.{svelte,server.ts}`, `src/routes/devices/+page.{svelte,server.ts}`, `src/routes/issues/+page.{svelte,server.ts}`, `src/routes/issues/[id]/+page.{svelte,server.ts}`, `src/routes/settings/+page.{svelte,server.ts}`, `src/lib/views.ts`, `src/app.css`
- Test: `src/lib/views.test.ts`, `src/lib/server/auth.test.ts`

**Interfaces:**
- Produces:
  - `getAuth()` — `betterAuth({ database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }), secret: config.secretKey, baseURL: config.publicUrl, emailAndPassword: { enabled: true, disableSignUp: true }, plugins: [sveltekitCookies(getRequestEvent)] })`, lazy singleton.
  - `ensureAdmin(auth, email?, password?): Promise<'created'|'exists'|'skipped'>` — via `(await auth.$context)`: `internalAdapter.findUserByEmail`, else `createUser({ email, name: 'Admin', emailVerified: true })` + `password.hash` + `linkAccount({ providerId: 'credential', accountId: user.id, userId: user.id, password })`.
  - `views.ts` (pure, shared by pages): `overallStatus(issues): 'green'|'amber'|'red'`; `sortIssues(issues)` (critical → warning → info, then newest); `deviceRows(state, openIssues): DeviceRow[]`; `counters(state): { devicesOnline, devicesTotal, routersOnline, routersTotal, batteriesLow }`; `formatTime(ms, tz)`, `formatAgo(ms, now)`.
- `handle` = `sequence(betterAuthHandle, guard)`: `svelteKitHandler({ event, resolve, auth, building })`, set `event.locals.user/session` from `auth.api.getSession({ headers })`; redirect to `/login` unless path is `/login`, `/api/health`, or `/api/auth/*`.
- Pages call `invalidateAll()` every 15 s (`setInterval` in the root layout, cleared on destroy). Form actions (`use:enhance`): issues/[id] `acknowledge`, `mute` (`duration: '1h'|'24h'|'7d'|'forever'|'unmute'` → `devices.muted_until` and `state.devices`), settings `save`, `saveChannel` (encrypts webhook), `test` (`sendTest`). Settings also lists `checkPrereqs` status and `failed` outbox rows (time, title, last error).
- Overview healthy state: green banner "All good", counters, bridge line; no empty tables rendered. Prereq banner per failing `checkPrereqs` entry with its `fix` YAML.

- [ ] **Step 1:** `git switch -c feat/m10-ui`. **Failing tests:** `views.test.ts`: `green with no issues or only info`, `amber with any warning`, `red with any critical`, `sorts by severity then newest`, `counts routers and batteries < batteryLowPct`. `auth.test.ts` (temp-file DB): `ensureAdmin creates once then exists`; `sign-up endpoint is rejected` (`auth.api.signUpEmail` throws); `admin can sign in` (`auth.api.signInEmail` returns a token).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement auth, views, hooks, pages. Keep CSS to one `app.css` (system font, status colours matching Discord, table styles). **Step 4:** Run → PASS; `npm run check` → 0 errors.
- [ ] **Step 5:** `npm run dev` with the local broker loaded with `startup.jsonl`; check in the browser: login works; Overview shows green "All good"; publish `{"state":"offline"}` to a router's availability → within ~3 min Overview turns amber with one issue; acknowledge and mute work; Devices sorts by every column; Settings saves and "Send test" shows the error for a bogus webhook. Screenshot Overview (healthy and amber) as deliverables.
- [ ] **Step 6:** Commit `feat: add login and web pages`, PR, squash-merge.

### Task 12: Docker, README and deploy (Milestone 11, T11)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `README.md`; Modify: `CLAUDE.md`

- [ ] **Step 1:** `git switch -c feat/m11-deploy`. `Dockerfile`: stage 1 `node:24-bookworm-slim`, `npm ci`, `npm run build`, `npm prune --omit=dev`; stage 2 `node:24-bookworm-slim`, copy `build/`, `node_modules/`, `drizzle/`, `package.json`; `ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/meshpulse.db`; `USER node`; `VOLUME /data`; `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`; `CMD ["node","build"]`.
- [ ] **Step 2:** `docker-compose.yml`: service `meshpulse`, `build: .`, `restart: unless-stopped`, `env_file: .env`, `volumes: ['./data:/data']`, `ports: ['3000:3000']`. `.env.example` with every variable from the design's Configuration section plus `PROTOCOL_HEADER`/`HOST_HEADER` (commented, for reverse proxies).
- [ ] **Step 3:** Verify: `docker compose up -d --build` with `.env` pointing at the local mosquitto → `docker compose ps` shows `healthy` within 3 min; log in over **plain http** on `http://<host>:3000` (checks adapter-node's derived origin and Better Auth's origin check; if login fails, set `PROTOCOL_HEADER`/`baseURL` handling and document it); restart the container → data persists and the admin is not recreated.
- [ ] **Step 4:** README: what it is, the 3 Z2M config changes (YAML from `docs/SPEC.md`), the broker user's permission (subscribe `zigbee2mqtt/#`), `.env` setup, `docker compose up`, Dokploy notes (volume, env, reverse-proxy headers), Discord webhook setup, heartbeat setup (Uptime Kuma push URL), recording traffic. Update CLAUDE.md commands.
- [ ] **Step 5:** Commit `feat: add Docker deployment and README`, PR, squash-merge.
- [ ] **Step 6:** Final check against the design's definition of done: `npm test -- --run` all green, `npm run check` clean, `docker compose up` healthy. Mark every milestone done and `paseo-progress finish`.
