# MeshPulse Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can install MeshPulse from a published image with only `MQTT_URL`, finish setup in the browser, and update with `docker compose pull`.

**Architecture:** A secret key resolved from env, then a file next to the database, then generated. A `/setup` route guarded in `hooks.server.ts` while the `user` table is empty. A setup notice on the Overview from MQTT/bridge state. GitHub Actions for CI and tag releases to GHCR (amd64 + arm64). README and template updates.

**Tech Stack:** SvelteKit 3, Svelte 5, TypeScript strict, Drizzle + better-sqlite3, Better Auth, mqtt.js, vitest, GitHub Actions, Docker buildx.

**Spec:** `docs/superpowers/specs/2026-10-19-meshpulse-public-release-design.md`

## Global Constraints

- No new npm dependency. GitHub Actions may use the `actions/*` and `docker/*` actions.
- Server code uses relative imports. SvelteKit 3: `$app/env`, not `$app/environment`.
- Pages are `<div class="page">`, no `<main>`; only classes from `src/app.css`.
- Existing installs must keep working unchanged: a set `SECRET_KEY` (any length, as today) always wins; `ADMIN_EMAIL`/`ADMIN_PASSWORD` still seed the admin.
- Never log or display the secret key or broker credentials.
- Image: `ghcr.io/jumpingmushroom/meshpulse`, tags `X.Y.Z`, `X.Y`, `latest`, platforms `linux/amd64,linux/arm64`. First release `v0.1.0`.
- Setup password: at least 12 characters. "No Zigbee2MQTT data" notice after 2 minutes connected.
- Conventional commits, no AI attribution.

Ruling against the spec: the spec says a short env `SECRET_KEY` is "still rejected", but today only presence is checked and existing installs may use short keys. Keep accepting any non-empty env key (Global Constraints line 4); the spec's line is corrected in Task 1.

## Review Focus

1. `/data` not writable (wrong PUID/PGID) and no `SECRET_KEY`: startup fails with an error naming the key file path, not a generic EACCES. Test in Task 1.
2. An empty or whitespace-only `secret.key` (e.g. a failed earlier write): treated as missing and regenerated, never used as an empty key. Test in Task 1.
3. `DATABASE_PATH=:memory:` (tests, scripts) without `SECRET_KEY`: a random key in memory, no file written in the working directory. Test in Task 1.
4. `MQTT_URL` with credentials (`mqtt://user:pass@host:1883`): the setup notice shows `mqtt://host:1883`. Test in Task 3.
5. Admin seeded from env, then someone opens `/setup`: 404, no second account. Test in Task 2.

---

### Task 1: Secret key from env, file or generated

**Files:**
- Modify: `src/lib/server/config.ts`
- Modify: `src/lib/server/config.test.ts`
- Modify: `src/lib/server/runtime.ts` (log line)
- Modify: `docs/superpowers/specs/2026-10-19-meshpulse-public-release-design.md` (the "short env key still rejected" test line becomes "any non-empty env key accepted, as today")

**Interfaces:**
- Produces: `resolveSecretKey(envKey: string | undefined, databasePath: string): { key: string; source: 'env' | 'file' | 'generated' | 'memory' }` exported from `config.ts`. `Config` gains `secretSource: 'env' | 'file' | 'generated' | 'memory'`. `loadConfig` no longer throws without `SECRET_KEY`.

- [ ] **Step 1: Write the failing tests** in `config.test.ts` (use a `mkdtempSync` dir per test, `DATABASE_PATH = join(dir, 'meshpulse.db')`):
  - `env key wins and writes no file`: `resolveSecretKey('x', db)` → `{ key: 'x', source: 'env' }`; `existsSync(join(dir, 'secret.key'))` is false.
  - `generates, saves with mode 0600 and reuses`: first call with `undefined` → `source: 'generated'`, key is base64 of 32 bytes (`Buffer.from(key, 'base64').length === 32`); `statSync(file).mode & 0o777` is `0o600`; second call → same key, `source: 'file'`.
  - `blank file is regenerated`: write `'  \n'` to `secret.key`; call → `source: 'generated'`, key length > 0, file now holds that key.
  - `memory database keeps the key in memory`: `resolveSecretKey(undefined, ':memory:')` → `source: 'memory'`; no `secret.key` in `process.cwd()` afterwards.
  - `unwritable dir names the path`: dir chmod `0o500`; expect throw matching `/secret\.key/` (skip when `process.getuid?.() === 0`).
  - Replace the old `loadConfig({})` throw test with: `loadConfig({ DATABASE_PATH: ':memory:' }).secretSource === 'memory'`.

- [ ] **Step 2:** Run `npx vitest run src/lib/server/config.test.ts`. Expected: FAIL (`resolveSecretKey` not exported).

- [ ] **Step 3: Implement `resolveSecretKey`** with `node:fs` (`readFileSync`, `writeFileSync(file, key, { mode: 0o600 })`) and `randomBytes(32).toString('base64')`; file is `join(dirname(databasePath), 'secret.key')`. A write error is rethrown as `Error(\`Cannot write the secret key to ${file}: ${e.message}. Set SECRET_KEY or make the data folder writable.\`)`. `loadConfig` calls it with `env.SECRET_KEY || undefined` and the resolved database path.

- [ ] **Step 4:** In `runtime.ts`, after `loadConfig()`, log `secret key: ${config.secretSource}` once (never the key). Change the `'skipped'` admin warning to `auth: no ADMIN_EMAIL/ADMIN_PASSWORD; open MeshPulse in a browser to create the admin account`.

- [ ] **Step 5:** Run `npm test -- --run` and `npm run check`. Expected: all pass, 0 errors.

- [ ] **Step 6: Commit** `feat: generate the secret key into the data folder when SECRET_KEY is unset`

### Task 2: First-run admin setup page

**Files:**
- Create: `src/lib/server/setup.ts`
- Create: `src/lib/server/setup.test.ts`
- Create: `src/routes/setup/+page.server.ts`, `src/routes/setup/+page.svelte`
- Modify: `src/hooks.server.ts`

**Interfaces:**
- Consumes: `getAuth()`, `Auth` from `auth.ts`; `getDb()`.
- Produces (all in `setup.ts`):
  - `needsSetup(db: Db): boolean`: true while the Better Auth `user` table has no rows; once false, cached false for the process.
  - `validateSetup(email: string, password: string, confirm: string): { field: 'email' | 'password' | 'confirm'; message: string } | null`
  - `createFirstAdmin(auth: Auth, db: Db, email: string, password: string): Promise<'created' | 'done'>`: serialised through a module-level promise chain; re-checks the user count right before creating; creates exactly like `ensureAdmin` (`createUser` with `name: 'Admin'`, `emailVerified: true`, then `linkAccount` with the hashed password).
  - `setupRedirect(path: string, hasUser: boolean, setupNeeded: boolean): '/setup' | '404' | null`: what the guard does for a request.

- [ ] **Step 1: Write the failing tests** in `setup.test.ts` (set up like `auth.test.ts`: temp `DATABASE_PATH`, `SECRET_KEY`, mock `$app/server`):
  - `needsSetup is true with no users and false after createFirstAdmin`.
  - `two concurrent submits create one user`: `Promise.all([createFirstAdmin(a, db, 'a@x.io', 'twelve-chars-1'), createFirstAdmin(a, db, 'b@x.io', 'twelve-chars-2')])` → one `'created'`, one `'done'`; user count 1.
  - `the created admin can sign in` with `auth.api.signInEmail`.
  - `validateSetup`: `('nope', 'twelve-chars-x', 'twelve-chars-x')` → field `email`; `('a@x.io', 'short', 'short')` → `{ field: 'password', message: 'Use at least 12 characters' }`; mismatch → `{ field: 'confirm', message: 'The passwords do not match' }`; valid → `null`.
  - `setupRedirect`: `('/', false, true)` → `'/setup'`; `('/login', false, true)` → `'/setup'`; `('/setup', false, true)` → `null`; `('/api/health', false, true)` → `null`; `('/api/auth/get-session', false, true)` → `null`; `('/setup', false, false)` → `'404'`; `('/setup', true, false)` → `'404'`; `('/', true, false)` → `null`.
  - Review Focus 5: after `ensureAdmin(auth, 'env@x.io', 'twelve-chars-e')`, `needsSetup(db)` is false and `setupRedirect('/setup', false, false)` is `'404'`.

- [ ] **Step 2:** Run `npx vitest run src/lib/server/setup.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `setup.ts`.**

- [ ] **Step 4: Wire the guard** in `hooks.server.ts`: a handle before the existing `guard` that calls `setupRedirect(path, !!locals.user, needsSetup(getDb()))`; `'/setup'` → `redirect(303, '/setup')`, `'404'` → `error(404)`. `PUBLIC` gains `/setup`.

- [ ] **Step 5: The route.** `+page.server.ts`: `load` returns nothing (the guard handles access); action `default` reads `email`, `password`, `confirm`, returns `fail(400, { email, field, error })` on a validation error, `fail(409, { email, error: 'Setup is already done. Sign in instead.' })` on `'done'`, otherwise calls `getAuth().api.signInEmail({ body, headers: request.headers })` as the login action does and redirects 303 to `/`. `+page.svelte`: same layout and classes as `src/routes/login/+page.svelte`; heading "Create the admin account", text "MeshPulse has no account yet. This one manages everything; you can't add more later.", fields Email, Password (help "At least 12 characters"), Confirm password, button "Create account", errors shown at their field.

- [ ] **Step 6:** Run `npm test -- --run` and `npm run check`. Expected: pass, 0 errors. Run `npm run dev` with an empty temp `DATABASE_PATH` and no `ADMIN_*`, open `/` → lands on `/setup`; create an account → Overview; `/setup` → 404.

- [ ] **Step 7: Commit** `feat: first-run admin setup page`

### Task 3: Setup notice on the Overview

**Files:**
- Modify: `src/lib/server/types.ts` (`MonitorState.lastError: string | null`, `createState` sets `null`)
- Modify: `src/lib/server/mqtt/collector.ts` (`error` handler stores the same message it logs; `connect` sets `lastError = null`)
- Modify: `src/lib/views.ts`, `src/lib/views.test.ts`
- Modify: `src/routes/+page.server.ts`, `src/routes/+page.svelte`

**Interfaces:**
- Produces: `setupNotice(input: { connected: boolean; connectedAt: number | null; lastError: string | null; bridgeSeen: boolean; mqttUrl: string; baseTopic: string; now: number }): { kind: 'mqtt' | 'z2m'; text: string } | null` in `views.ts`. `bridgeSeen` is `state.bridge.state !== null || state.bridge.info !== null`.

- [ ] **Step 1: Write the failing tests** in `views.test.ts`:
  - not connected, `lastError: 'connect ECONNREFUSED 10.0.0.2:1883'`, `mqttUrl: 'mqtt://user:pass@10.0.0.2:1883'` → `{ kind: 'mqtt', text: "MeshPulse can't reach the MQTT broker at mqtt://10.0.0.2:1883: connect ECONNREFUSED 10.0.0.2:1883. Check the URL, username and password." }` (Review Focus 4: no `user`/`pass` in the text).
  - not connected, `lastError: null` → text ends `at mqtt://10.0.0.2:1883. Check the URL, username and password.`
  - connected 119 s ago, `bridgeSeen: false` → `null`; connected 120 s ago → `{ kind: 'z2m', text: 'Connected, but nothing from Zigbee2MQTT on zigbee2mqtt/bridge/…. Check Z2M_BASE_TOPIC (now zigbee2mqtt) and that the MQTT user may subscribe to zigbee2mqtt/#.' }`.
  - connected 10 min, `bridgeSeen: true` → `null`.

- [ ] **Step 2:** Run `npx vitest run src/lib/views.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `setupNotice` (strip credentials with `new URL()`, clearing `username`/`password`; an unparsable URL is shown as `the configured URL`), `lastError` in state and collector, `setup: setupNotice({...})` in the Overview load, and a `<div class="monitor-alert" role="alert">` above the prerequisite notices in `+page.svelte` when `data.setup` is set.

- [ ] **Step 4:** Run `npm test -- --run` and `npm run check`. Expected: pass.

- [ ] **Step 5: Commit** `feat: setup notice when MQTT or Zigbee2MQTT data is missing`

### Task 4: License, CI, release workflow, compose, docs

**Files:**
- Create: `LICENSE` (MIT, `Copyright (c) 2026 Johnny Dalen`)
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Modify: `package.json` (`"version": "0.1.0"`, `"license": "MIT"`), `docker-compose.yml`, `unraid/meshpulse.xml`, `.env.example`, `README.md`, `CLAUDE.md` (OCI labels come from `docker/metadata-action`; the Dockerfile is unchanged)

**Interfaces:** none in code.

- [ ] **Step 1: `ci.yml`**: triggers `pull_request` and `push` to `main`; one job on `ubuntu-latest`: checkout, `actions/setup-node` with Node 24 and npm cache, `npm ci`, `npm test -- --run`, `npm run check`, `docker build .`.

- [ ] **Step 2: `release.yml`**: trigger `push: tags: ['v*']`; `permissions: { contents: read, packages: write }`; steps: checkout, `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3` (registry `ghcr.io`, user `${{ github.actor }}`, password `${{ secrets.GITHUB_TOKEN }}`), `docker/metadata-action@v5` (images `ghcr.io/jumpingmushroom/meshpulse`, tags `type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}`, `type=raw,value=latest`; labels incl. `org.opencontainers.image.licenses=MIT`), `docker/build-push-action@v6` (platforms `linux/amd64,linux/arm64`, push true, tags/labels from metadata, `cache-from/to: type=gha`).

- [ ] **Step 3: Lint the workflows**: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`. Expected: no output, exit 0.

- [ ] **Step 4: Compose and template.** `docker-compose.yml`: `image: ghcr.io/jumpingmushroom/meshpulse:latest`, `# build: .` comment for source builds, `env_file: .env`, volume and port as now. `unraid/meshpulse.xml`: `Repository` `ghcr.io/jumpingmushroom/meshpulse:latest`, `Registry` `https://github.com/jumpingmushroom/MeshPulse/pkgs/container/meshpulse`, `SECRET_KEY`/`ADMIN_EMAIL`/`ADMIN_PASSWORD` `Required="false"` with descriptions saying what happens when empty.

- [ ] **Step 5: `.env.example`**: `MQTT_URL` marked required; `SECRET_KEY` "Optional. Generated into the data folder (secret.key) when empty; set it to keep the same key across data folders."; `ADMIN_EMAIL`/`ADMIN_PASSWORD` "Optional. When empty, the first visit shows a page to create the admin account."

- [ ] **Step 6: README**: sections in this order: what it is (keep), Install with Docker Compose (compose file + minimal `.env` with only `MQTT_URL` and `TZ`), Install with `docker run` (one command, `-v meshpulse-data:/data -p 3000:3000 -e MQTT_URL=...`), First run (setup page; "Create the account before you expose MeshPulse beyond your home network"), What Zigbee2MQTT needs (the three settings from `checkPrereqs` with their YAML), Updating (`docker compose pull && docker compose up -d`, back up the data folder first), Environment variables table (only `MQTT_URL` required), then the existing feature sections. `CLAUDE.md`: add `src/lib/server/setup.ts` and `src/routes/setup` to the map, and the release flow (tag `vX.Y.Z` → GHCR) under Workflow.

- [ ] **Step 7:** Run `npm test -- --run`, `npm run check`, `docker build -t meshpulse:ci .`. Expected: pass, build ok.

- [ ] **Step 8: Commit** `feat: MIT license, CI and GHCR release workflows, install docs`

### Task 5: Release (controller only, not dispatched)

Steps that touch GitHub settings, publish or are irreversible; the controller runs them and asks the user before step 4.

- [ ] **Step 1:** Merge the branch (PR, squash). Watch the first `ci.yml` run on main: `gh run watch`. Expected: success.
- [ ] **Step 2:** Test the release workflow while private: `git tag v0.0.0-test && git push origin v0.0.0-test`; `gh run watch`; check both platforms with `docker buildx imagetools inspect ghcr.io/jumpingmushroom/meshpulse:0.0.0-test`. Then delete the tag (local and remote) and the package version (`gh api -X DELETE` on the version id).
- [ ] **Step 3:** Secret scan of the full history: `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --log-opts="--all"`. Expected: "no leaks found". Any finding: report to the user, rotate, rewrite history only with their go-ahead.
- [ ] **Step 4:** Ask the user. On yes: `gh repo edit --visibility public --accept-visibility-change-consequences`; tag `v0.1.0` and push; after the run, set the package to public (GitHub package settings, by the user if the API refuses).
- [ ] **Step 5:** Fresh install test on Unraid: a new container from `ghcr.io/jumpingmushroom/meshpulse:0.1.0` with an empty data folder, port 3002, only `MQTT_URL` (+ credentials). Expected: `/` → `/setup`; `secret.key` in the data folder with mode 600; after creating the account the Overview fills in within 2 minutes. Remove the test container and folder afterwards.
