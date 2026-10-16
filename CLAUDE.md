# MeshPulse

Passive, read-only Zigbee2MQTT health monitor: watches MQTT traffic, raises issues, notifies via Discord.

## Commands

- `npm run dev` - dev server
- `npm test` - vitest (watch; `npm test -- --run` for one shot)
- `npm run check` - svelte-check / tsc
- `npx drizzle-kit generate` - generate SQL migrations after schema changes
- `npm run capture` - record `zigbee2mqtt/#` traffic to JSONL (`scripts/capture.ts`)

## Architecture

One Node process (SvelteKit, adapter-node). `src/hooks.server.ts` starts once: the collector (mqtt.js on `${Z2M_BASE_TOPIC}/#`, keeps state in memory, writes SQLite, never publishes), the rules loop (60 s: rules, then lifecycle), the outbox worker (2 s), and the heartbeat (60 s).

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
src/lib/server/mqtt/collector.ts     startCollector(deps) - mqtt.js + effect persistence
src/lib/server/prereqs.ts            checkPrereqs(config) -> Prereq[]
src/lib/server/rules/*.ts            one file per rule + index.ts (RULES, RULE_DEFAULTS)
src/lib/server/issues/lifecycle.ts   evaluate(input) -> LifecycleResult
src/lib/server/issues/quiet.ts       isQuietHours(now, settings, tz)
src/lib/server/engine.ts             runOnce(deps, now); startEngine(deps)
src/lib/server/notify/*.ts           channel registry, discord, outbox worker
src/lib/server/crypto.ts             encrypt, decrypt
src/lib/server/retention.ts          prune(db, now)
src/lib/server/heartbeat.ts          heartbeatTick(deps, now); startHeartbeat(deps)
src/lib/server/auth.ts               getAuth(), ensureAdmin()
src/lib/server/runtime.ts            startRuntime(), runtime singleton (state, db, config)
src/routes/...                       pages, api/health
scripts/capture.ts                   record zigbee2mqtt/# to JSONL
tests/fixtures/*.jsonl               fixture traffic (line: {"ts","topic","payload","retain"})
tests/helpers/simulate.ts            pure replay harness: router -> rules -> lifecycle
```

Rules and lifecycle are pure; test them with fixtures, not mocks.

## Conventions

- Read-only on MQTT: the app never publishes.
- All storage keyed by IEEE address. `devices.instance_id` defaults to `'default'`.
- Timestamps are UTC epoch ms in the DB; display in `TZ` (default `Europe/Oslo`).
- TypeScript `strict: true`. Import via the `#lib/*` alias (package.json `imports`).
- SvelteKit 3: use `$app/env`, not `$app/environment`. adapter-node has no `ORIGIN` env; origin comes from the `Host` header or `PROTOCOL_HEADER`/`HOST_HEADER`.
- No dependency beyond the stack (SvelteKit 3, Svelte 5, TS, Vite, Drizzle, better-sqlite3, mqtt, better-auth, vitest, adapter-node) without asking.
- Severity values: `'info' | 'warning' | 'critical'`.
- Design doc is the authority: `docs/superpowers/specs/2026-10-16-meshpulse-mvp-design.md`; plan in `docs/superpowers/plans/`.

## Workflow

- One git branch per milestone (`feat/mNN-<slug>`), conventional commits, PRs squash-merged (`gh pr merge --squash --delete-branch`). No AI attribution in commits or PRs.
- Record progress with `paseo-progress` (milestones T02-T12): update the ticket stage at start, each stage, and done.
