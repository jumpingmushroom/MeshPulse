# MeshPulse

Passive, read-only Zigbee2MQTT health monitor: watches MQTT traffic, raises issues, notifies via Discord and Apprise.

## Commands

- `npm run dev` - dev server
- `npm test` - vitest (watch; `npm test -- --run` for one shot)
- `npm run check` - svelte-check / tsc
- `npx drizzle-kit generate` - generate SQL migrations after schema changes
- `npm run capture` - record `zigbee2mqtt/#` traffic to JSONL (`scripts/capture.ts`)
- `REPLAY=<capture.jsonl> npm run replay` - replay a capture through router, rules and lifecycle; writes `<capture>.report.txt` (`scripts/replay.ts`)
- `docker compose up -d --build` - build and run the container (needs `.env`, see `.env.example`)

## Architecture

One Node process (SvelteKit, adapter-node). `src/hooks.server.ts` starts once: the collector (mqtt.js on `${Z2M_BASE_TOPIC}/#`, keeps state in memory, writes SQLite, never publishes), the rules loop (60 s: rules, then lifecycle; hourly trend job: rollups, baselines, battery forecasts), the outbox worker (2 s), and the heartbeat (60 s).

```
src/hooks.server.ts                  init -> startRuntime(); handle -> auth + login guard
src/lib/server/config.ts             loadConfig(env) -> Config
src/lib/server/db/schema.ts          Drizzle tables (app)
src/lib/server/db/auth-schema.ts     Better Auth tables (generated)
src/lib/server/db/index.ts           openDb(path) -> Db (WAL + migrate); getDb()
src/lib/server/settings.ts           DEFAULT_SETTINGS, getSettings, saveSettings
src/lib/server/types.ts              AppState, DeviceState, Finding, IssueRow, Message, Severity, Effect
src/lib/server/mqtt/route.ts         route(state, msg, baseTopic) -> Effect[]
src/lib/server/mqtt/parse.ts         parseJson, parseAvailability, parseLastSeen, normaliseVoltage
src/lib/server/mqtt/logparse.ts     parseRouteError: parses bridge/logging lines (route.ts emits route_error events)
src/lib/server/mqtt/collector.ts     startCollector(deps) - mqtt.js + effect persistence
src/lib/server/prereqs.ts            checkPrereqs(config) -> Prereq[]
src/lib/server/rules/*.ts            one file per rule + index.ts (RULES, RULE_DEFAULTS)
src/lib/server/rules/{lqi,route,forecast}.ts  lqi.weak/degrading, route.failures, network.route_errors, battery.forecast
src/lib/server/trends/               minutes.ts (in-memory per-minute counters), rollup.ts (hourly samples + baselines), forecast.ts, history.ts (per-run snapshot the rules read)
src/lib/server/rules/{churn,storm,mass-offline,bridge-backlog}.ts  rejoin/network churn, leave, interview; device/network storm, dominant; mass offline; mqtt backlog
src/lib/server/rules/types.ts        RuleId, RuleContext, Finding, issueKey, inGrace
src/lib/server/issues/lifecycle.ts   evaluate(input) -> LifecycleResult
src/lib/server/issues/quiet.ts       isQuietHours(now, settings, tz)
src/lib/server/issues/grouping.ts    PARENT_RULES, parentFor (child issues under incidents)
src/lib/score.ts                     deviceScore, networkScore (top-level issues only)
src/lib/server/engine.ts             runOnce(deps, now); startEngine(deps)
src/lib/server/notify/*.ts           channel registry, discord, apprise, outbox worker
src/lib/server/notify/weekly.ts     weekly digest (Sunday 18:00 TZ, once per ISO week)
src/lib/server/crypto.ts             encrypt, decrypt
src/lib/server/retention.ts          prune(db, now)
src/lib/server/heartbeat.ts          heartbeatTick(deps, now); startHeartbeat(deps)
src/lib/server/auth.ts               getAuth(), ensureAdmin()
src/lib/server/login-limit.ts        createLimiter, loginLimiter (login rate limit)
src/lib/server/store.ts              loadDevices, applyEffects, flushDevices, muteUntil (DB <-> AppState)
src/lib/chart.ts                     chart scale/path helpers
src/lib/components/LineChart.svelte  SVG line chart
src/lib/views.ts                     pure view helpers for pages (status, formatTime, FOREVER)
src/lib/server/runtime.ts            startRuntime(), runtime singleton (state, db, config)
src/routes/...                       pages (devices/[ieee], batteries, events), api/health
scripts/replay.ts                    replay(lines) -> report; formatReport
Tables added in Phase 2: samples_hourly, baselines
scripts/capture.ts                   record zigbee2mqtt/# to JSONL
tests/fixtures/*.jsonl               fixture traffic (line: {"ts","topic","payload","retain"})
tests/helpers/simulate.ts            pure replay harness: router -> rules -> lifecycle
```

Parent/child lifecycle: `network.mass_offline`, `network.storm` and a Router's `device.offline` are parents (`issues/grouping.ts`). A matching device issue that opens under an open parent gets `parent_issue_id` and never notifies; when the parent resolves, still-open children are released and notify once. Children don't count toward the network score.

Rules and lifecycle are pure; test them with fixtures, not mocks.

## Conventions

- Read-only on MQTT: the app never publishes.
- All storage keyed by IEEE address. `devices.instance_id` defaults to `'default'`.
- Timestamps are UTC epoch ms in the DB; display in `TZ` (default `Europe/Oslo`).
- TypeScript `strict: true`. Server code uses relative imports (`#lib/*` without extensions does not type-check).
- SvelteKit 3: use `$app/env`, not `$app/environment`. adapter-node has no `ORIGIN` env; origin comes from the `Host` header or `PROTOCOL_HEADER`/`HOST_HEADER`.
- No dependency beyond the stack (SvelteKit 3, Svelte 5, TS, Vite, Drizzle, better-sqlite3, mqtt, better-auth, vitest, adapter-node) without asking.
- Severity values: `'info' | 'warning' | 'critical'`.
- Design doc is the authority: `docs/superpowers/specs/2026-10-16-meshpulse-mvp-design.md`; plan in `docs/superpowers/plans/`.

## Workflow

- Replay gate: before a rule change merges, replay a real 24 h capture. A normal day must produce no Critical, and every would-be notification in the report goes in the PR description.
- One git branch per milestone (`feat/mNN-<slug>`), conventional commits, PRs squash-merged (`gh pr merge --squash --delete-branch`). No AI attribution in commits or PRs.
- Record progress with `paseo-progress` (milestones T02-T12): update the ticket stage at start, each stage, and done.
