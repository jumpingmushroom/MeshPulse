# MeshPulse Home Assistant Add-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The existing image runs as a Home Assistant add-on: opened from the sidebar via Ingress, MQTT from the Mosquitto add-on, no MeshPulse login, unchanged outside Home Assistant.

**Architecture:** `src/lib/server/addon.ts` turns `/data/options.json` and the Supervisor's MQTT service into config env before `loadConfig`. In add-on mode `hooks.server.ts` trusts only the ingress proxy address and skips Better Auth. Links use `resolve()` from `$app/paths` with relative paths, and server redirects go through `appRedirect`. The add-on definition lives in `addon/meshpulse/` with `repository.yaml` at the root.

**Tech Stack:** SvelteKit 3.1 (adapter-node), Svelte 5, TS strict, vitest, GitHub Actions, Home Assistant Supervisor add-on format.

**Spec:** `docs/superpowers/specs/2026-10-20-meshpulse-ha-addon-design.md`

## Global Constraints

- One image (`ghcr.io/jumpingmushroom/meshpulse`); add-on mode only when `SUPERVISOR_TOKEN` is set; outside it, behaviour is byte-for-byte unchanged (existing tests stay green untouched).
- Ingress proxy address: `172.30.32.2`. Supervisor MQTT service: `GET http://supervisor/services/mqtt`, header `Authorization: Bearer <SUPERVISOR_TOKEN>`.
- Add-on options: `z2m_base_topic` (default `zigbee2mqtt`), `mqtt_url`, `mqtt_username`, `mqtt_password` (optional). Option credentials only apply together with `mqtt_url`.
- Never log credentials or the token. No new npm dependency. Server code uses relative imports.
- `config.yaml` values exactly as in spec section 4; `arch: [amd64, aarch64]`.
- Anything installed on the reference Home Assistant is done by the user or with the user's explicit go-ahead; read-only on MQTT as always.
- The repo is public: no personal hostnames/IPs in committed files.
- Conventional commits, no AI attribution.

## Review Focus

1. `options.json` present but unreadable or invalid JSON: MeshPulse starts with defaults and logs one line, not a crash loop. Test in Task 1.
2. Supervisor returns `{ result: 'ok', data: {...} }` with `ssl: true` and a non-default port: URL is `mqtts://host:port`. Test in Task 1.
3. In add-on mode a request carrying `X-Forwarded-For: 172.30.32.2` from another address is still rejected (403). Test in Task 2.
4. `X-Ingress-Path` sent to a non-add-on install is ignored by `appRedirect` (no open-redirect via header). Test in Task 2.
5. A literal `href="/…"` added later anywhere in `src/routes` or `src/lib` fails the build. Test in Task 4.

---

### Task 1: Add-on mode configuration

**Files:**
- Create: `src/lib/server/addon.ts`, `src/lib/server/addon.test.ts`
- Modify: `src/lib/server/runtime.ts`, `src/lib/server/auth.ts` (both call `loadConfig()`; they must see the same overlay), `src/lib/views.ts` (`setupNotice` add-on variant) + `src/lib/views.test.ts`, `src/routes/+page.server.ts`

**Interfaces:**
- Produces: `isAddon(env = process.env): boolean`; `readAddonOptions(path = '/data/options.json'): AddonOptions` with `type AddonOptions = { z2m_base_topic: string; mqtt_url: string; mqtt_username: string; mqtt_password: string }`; `supervisorMqtt(fetchFn: typeof fetch, token: string): Promise<{ url: string; username: string; password: string } | null>`; `addonEnv(o: AddonOptions, mqtt: Awaited<ReturnType<typeof supervisorMqtt>>): Record<string, string>`; `applyAddonEnv(): Promise<'options' | 'service' | 'none' | null>` (null outside add-on mode; otherwise merges `addonEnv` into `process.env` once, before any `loadConfig()` call, and returns the MQTT source). `setupNotice` input gains `addon: boolean` and `mqttUrlMissing: boolean`; with `addon && mqttUrlMissing` the text is exactly `No MQTT broker found. Install the Mosquitto broker add-on, or set mqtt_url in the MeshPulse add-on configuration.`

- [ ] **Step 1: Failing tests** (`addon.test.ts`): `isAddon({ SUPERVISOR_TOKEN: 'x' })` true, `isAddon({})` false; `readAddonOptions` on a missing file, `'{'` (invalid JSON) and `{}` → `{ z2m_base_topic: 'zigbee2mqtt', mqtt_url: '', mqtt_username: '', mqtt_password: '' }` (Review Focus 1); `supervisorMqtt` with a stub fetch returning `{ result: 'ok', data: { host: 'core-mosquitto', port: 1883, ssl: false, username: 'addons', password: 'p' } }` → `{ url: 'mqtt://core-mosquitto:1883', username: 'addons', password: 'p' }`, with `ssl: true, port: 8883` → `mqtts://core-mosquitto:8883` (Review Focus 2), 400 response → null, fetch throwing → null, and the stub received `Authorization: Bearer tok`; `addonEnv`: option URL wins with option credentials, service used when option URL empty (option credentials ignored then), neither → no `MQTT_*` keys; always `Z2M_BASE_TOPIC` and `DATABASE_PATH: '/data/meshpulse.db'`. `views.test.ts`: the add-on notice text above.
- [ ] **Step 2:** Run `npx vitest run src/lib/server/addon.test.ts src/lib/views.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call `await applyAddonEnv()` in `hooks.server.ts` `init` before `startRuntime()` (so `runtime.ts` and the lazy `auth.ts` both see the overlay through `loadConfig()`), and log `add-on mode: mqtt from <source>`. Ruling against the spec, which names `runtime.ts`: `init` is the one async place that runs before both. Overview passes `addon: isAddon()` and `mqttUrlMissing: !process.env.MQTT_URL`.
- [ ] **Step 4:** `npm test -- --run`, `npm run check`. Expected: pass.
- [ ] **Step 5: Commit** `feat: add-on mode reads options and the Supervisor MQTT service`

### Task 2: Login and redirects in add-on mode

**Files:**
- Create: `src/lib/server/ingress.ts`, `src/lib/server/ingress.test.ts`
- Modify: `src/hooks.server.ts`, every server file calling `redirect(` with a literal path (6 call sites: `grep -rEn "redirect\([0-9]+, *['\`\"]/" src`), `src/routes/+layout.svelte` (hide Sign out in add-on mode), `src/routes/+layout.server.ts` (`addon: isAddon()`)

**Interfaces:**
- Consumes: `isAddon` (Task 1).
- Produces: `INGRESS_PROXY = '172.30.32.2'`; `addonAccess(path: string, clientAddress: string): 'allow' | 'forbid'` (`/api/health` always allow; else allow only `clientAddress === INGRESS_PROXY`); `appRedirect(event: { request: Request }, status: 301 | 302 | 303 | 307 | 308, path: string): never` (prefix `X-Ingress-Path` only when `isAddon()`).

- [ ] **Step 1: Failing tests** (`ingress.test.ts`): `addonAccess('/', '172.30.32.2')` allow; `addonAccess('/', '10.0.0.5')` forbid; `addonAccess('/api/health', '10.0.0.5')` allow; `appRedirect` throws a redirect whose `location` is `/api/hassio_ingress/abc/login` with header `X-Ingress-Path: /api/hassio_ingress/abc` in add-on mode (set `process.env.SUPERVISOR_TOKEN` in the test, restore after), and `/login` with the same header outside add-on mode (Review Focus 4). Hook-level test (call the exported `handle` pieces with a fake event): in add-on mode, `getClientAddress()` returning `10.0.0.5` and header `X-Forwarded-For: 172.30.32.2` → 403 (Review Focus 3); `172.30.32.2` → `locals.user.email === 'Home Assistant'`, Better Auth not consulted; `/login` and `/setup` → redirect to `/` via `appRedirect`.
- [ ] **Step 2:** Run the test file. Expected: FAIL.
- [ ] **Step 3: Implement.** In `hooks.server.ts`, an `addonHandle` first in `sequence`: when `isAddon()`, apply `addonAccess` (403 via `error(403)`), set `locals.user`/`locals.session = null`, and `resolve(event)` without Better Auth or the setup/login guards. Replace the 6 literal redirects with `appRedirect`. Layout hides the Sign out form when `data.addon`.
- [ ] **Step 4:** `npm test -- --run`, `npm run check`. Expected: pass; existing auth/setup tests unchanged.
- [ ] **Step 5: Commit** `feat: add-on mode trusts the ingress proxy and prefixes redirects`

### Task 3: Add-on packaging and release check

**Files:**
- Create: `repository.yaml`, `addon/meshpulse/config.yaml`, `addon/meshpulse/DOCS.md`, `addon/meshpulse/CHANGELOG.md`, `addon/meshpulse/icon.png` (128×128), `addon/meshpulse/logo.png` (≤ 250×100) from `static/favicon` artwork, `scripts/check-version.mjs`
- Modify: `.github/workflows/release.yml` (run `node scripts/check-version.mjs "${GITHUB_REF_NAME#v}"` before building), `vite.config.ts` (`kit.paths.relative: true` set explicitly), `README.md` (Install as a Home Assistant add-on), `CLAUDE.md` (addon files, release must bump `config.yaml`)

**Interfaces:** `scripts/check-version.mjs <version>` exits 1 with `Version mismatch: tag <v>, package.json <a>, config.yaml <b>` unless all three match.

- [ ] **Step 1:** Write `config.yaml` with exactly the spec section 4 keys and values; `version` = `package.json` version; `repository.yaml` with `name: MeshPulse`, `url: https://github.com/jumpingmushroom/MeshPulse`, `maintainer: Johnny Dalen`.
- [ ] **Step 2: `check-version.mjs`** (reads `package.json` and the `version:` line of `config.yaml` without a YAML library). Verify: `node scripts/check-version.mjs 0.0.1` → exit 1 with the message; with the current version → exit 0.
- [ ] **Step 3:** Workflow step, then lint on Unraid: `docker run --rm -v <dir>:/repo -w /repo rhysd/actionlint:latest .github/workflows/release.yml` → exit 0.
- [ ] **Step 4:** Docs: `DOCS.md` (install from repository URL, MQTT auto/override, Zigbee2MQTT settings, backups include `/data`), README section, CLAUDE.md lines.
- [ ] **Step 5:** `npm test -- --run`, `npm run check`, `npm run build`. Expected: pass.
- [ ] **Step 6: Commit** `feat: Home Assistant add-on definition and version check`

### Task 4: Ingress spike on the reference Home Assistant (controller, with the user)

Proves sidebar navigation before the bulk link conversion.

- [ ] **Step 1:** Convert only `src/routes/+layout.svelte` nav links to `resolve()`; commit `feat: nav links resolve under any base path`.
- [ ] **Step 2:** Bump to `0.4.0-rc.1` in `package.json` and `config.yaml`, push the branch, tag `v0.4.0-rc.1` (pre-release: no `latest`), watch the release run.
- [ ] **Step 3:** Ask the user to add `https://github.com/jumpingmushroom/MeshPulse#feat/ha-m01-addon` as an add-on repository and install MeshPulse (options: their external broker URL and credentials, or Mosquitto if present). With their go-ahead, check together: sidebar opens the Overview; nav links navigate client-side; a full reload of `/devices` works; a form action (device mute) works; the Supervisor log shows `add-on mode: mqtt from …`.
- [ ] **Step 4:** Record the result in the ledger. If navigation, reload or forms fail under ingress, stop and revisit spec section 2 with the user.

### Task 5: Convert all links and guard against regressions

**Files:**
- Modify: every `.svelte` file with a literal `href="/…"` or `` href={`/…`} `` (33 links in 12 files), plus any literal path in `src/lib/views.ts` returned as a link
- Create: `tests/no-root-paths.test.ts`

**Interfaces:** links use `resolve('/route/[param]', { param })` or `resolve('/route')` from `$app/paths`; query strings appended after `resolve(...)`.

- [ ] **Step 1: Failing test** `tests/no-root-paths.test.ts`: walks `src/routes` and `src/lib` (`.svelte`, `.ts`, excluding `*.test.ts`), fails listing each match of `href="/`, `` href={`/ ``, `goto('/`, `fetch('/`, and `redirect(<n>, '/` (Review Focus 5). Run: FAIL listing the current matches.
- [ ] **Step 2:** Convert every match; external links (`https://…`) and `/api/health` used by the Dockerfile healthcheck are not links in pages and stay.
- [ ] **Step 3:** `npm test -- --run`, `npm run check`, `npm run build`. Expected: pass; the scan test passes.
- [ ] **Step 4:** Preview outside Home Assistant (`REF=<branch> /tmp/mp-preview.sh up`): click through every page; nothing changes.
- [ ] **Step 5: Commit** `feat: all links resolve under any base path`

### Task 6: Full check on the reference Home Assistant and release (controller, with the user)

- [ ] **Step 1:** Tag `v0.4.0-rc.2`; the user updates the add-on. Click through every page and form under ingress: devices (filters, device mute/ignore/chatty/rechargeable/battery type/rules), issues (acknowledge, mute, turn off rule), events, batteries, map, Wi-Fi, settings (save, test connection). Restart the add-on; update path works.
- [ ] **Step 2:** MQTT both ways if the user has Mosquitto: options empty → `service`; options set → `options`.
- [ ] **Step 3:** Final whole-branch review; fixes; set version `0.4.0` in `package.json` and `config.yaml`; merge; tag `v0.4.0`; the user switches the add-on repository to the default branch (`https://github.com/jumpingmushroom/MeshPulse`); deploy the Unraid install as usual.
