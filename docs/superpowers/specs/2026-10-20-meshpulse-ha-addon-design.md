# MeshPulse as a Home Assistant add-on: design

## Goal

A Home Assistant user adds the MeshPulse repository in the Add-on Store, installs MeshPulse, and opens it from the sidebar with no further setup when the Mosquitto broker add-on is installed. The same image keeps working unchanged outside Home Assistant.

Decisions from brainstorming (Q1-Q4, approach):
- Tested on the reference Home Assistant (HAOS/Supervised, the main install) (Q1 A).
- Opened through Ingress in the sidebar, behind Home Assistant's login; no separate port (Q2 A).
- MQTT from the Supervisor's `mqtt` service (Mosquitto add-on), overridable by add-on options (Q3 A).
- One image: the existing `ghcr.io/jumpingmushroom/meshpulse` detects add-on mode at runtime; the add-on definition lives in this repo (approach 1).

## Out of scope

Notifications through Home Assistant, a Home Assistant integration (entities, sensors), Community Add-ons listing, armv7/i386, an optional direct port, multiple Zigbee2MQTT instances.

## 1. Add-on mode

`src/lib/server/addon.ts`:
- `isAddon(env)`: true when `SUPERVISOR_TOKEN` is set.
- `readAddonOptions(path = '/data/options.json')`: `{ mqtt_url: string; mqtt_username: string; mqtt_password: string; z2m_base_topic: string }` (missing keys → empty strings, topic default `zigbee2mqtt`).
- `supervisorMqtt(fetch, token)`: `GET http://supervisor/services/mqtt` with `Authorization: Bearer <token>`; on success returns `{ url: 'mqtt://<host>:<port>' (mqtts when ssl), username, password }`, otherwise null (no Mosquitto add-on, or the call fails).
- `addonEnv(options, mqtt)`: the env overlay passed to `loadConfig`: `MQTT_URL` from `mqtt_url`, else the service, else unset; `MQTT_USERNAME`/`MQTT_PASSWORD` likewise (the option pair wins only together with `mqtt_url`); `Z2M_BASE_TOPIC`; `DATABASE_PATH=/data/meshpulse.db`. `TZ` comes from the Supervisor's environment as is.

`runtime.ts` resolves this before `loadConfig` when `isAddon`. Startup logs `add-on mode: mqtt from options | service | none` (never credentials). With no broker, MeshPulse starts anyway; the Overview's setup notice gains an add-on variant: "No MQTT broker found. Install the Mosquitto broker add-on, or set mqtt_url in the MeshPulse add-on configuration."

Outside add-on mode nothing changes.

## 2. Ingress paths

Home Assistant serves the add-on at `/api/hassio_ingress/<token>/…` and forwards to the add-on with the prefix stripped, adding `X-Ingress-Path: /api/hassio_ingress/<token>`.

- Build with `kit.paths.relative: true` (assets relative to the page).
- Every in-app link, `goto`, `invalidate` URL and client `fetch` uses SvelteKit's path resolution (`resolve()` from `$app/paths`) instead of a literal `/…` path. Form actions stay relative (`?/name`).
- Server redirects use `appRedirect(event, status, path)`: `redirect(status, (event.request.headers.get('x-ingress-path') ?? '') + path)` in add-on mode, plain `redirect` otherwise. The header is honoured only on requests accepted by the add-on login (section 3).
- A test scans `src/routes` and `src/lib` for literal root-relative `href="/`, `goto('/`, `redirect(…, '/` and `fetch('/` and fails on any.

Spike first (plan Task 1): a throwaway two-page build installed on the reference Home Assistant via a test add-on, opened from the sidebar, proving client navigation, a form action, a server redirect and a full reload under the ingress prefix. If it fails, stop and revisit this section.

## 3. Login in add-on mode

- `hooks.server.ts`: in add-on mode, a request whose client address is `172.30.32.2` (the Supervisor's ingress proxy) gets `locals.user = { email: 'Home Assistant' }` (with `X-Remote-User-Name` shown when present) and skips Better Auth; any other client address gets 403.
- The `/setup` page, `/login`, sign-out button and admin seeding are not used in add-on mode (`/setup` and `/login` redirect to `/`).
- `/api/health` stays reachable for the Supervisor watchdog from any address.
- The client address comes from adapter-node's `getClientAddress()`; `ADDRESS_HEADER`/`XFF_DEPTH` are ignored in add-on mode, so a forwarded header can't spoof the proxy address.

## 4. Packaging and release

- `repository.yaml` (root): name `MeshPulse`, url, maintainer.
- `addon/meshpulse/config.yaml`: `name: MeshPulse`, `slug: meshpulse`, `version` (= release), `description`, `url`, `arch: [amd64, aarch64]`, `image: ghcr.io/jumpingmushroom/meshpulse`, `init: false`, `ingress: true`, `ingress_port: 3000`, `panel_icon: mdi:zigbee`, `panel_title: MeshPulse`, `services: ["mqtt:want"]`, `watchdog: http://[HOST]:[PORT:3000]/api/health`, `options: { z2m_base_topic: zigbee2mqtt, mqtt_url: "", mqtt_username: "", mqtt_password: "" }`, `schema: { z2m_base_topic: str, mqtt_url: "str?", mqtt_username: "str?", mqtt_password: "password?" }`.
- `addon/meshpulse/`: `icon.png` (128×128), `logo.png`, `DOCS.md` (install, MQTT, Zigbee2MQTT requirements, updating), `CHANGELOG.md`.
- The image's entrypoint keeps working as root-then-PUID in Docker; in add-on mode it runs as is (Supervisor manages `/data`).
- Release workflow: a step fails the release when the tag differs from `package.json` `version` or `addon/meshpulse/config.yaml` `version`.
- README: an "Install as a Home Assistant add-on" section.

## Testing

- `addon.test.ts`: options parsing (missing file, missing keys); `supervisorMqtt` success, ssl → `mqtts`, 4xx and network error → null; `addonEnv` precedence (options URL > service > none; option credentials only with the option URL).
- Ingress: `appRedirect` with and without the header and outside add-on mode; the literal-path scan test.
- Login: add-on mode accepts `172.30.32.2`, rejects other addresses with 403, keeps `/api/health` open; outside add-on mode unchanged.
- Manual on the reference Home Assistant from a pre-release tag: install from the repository URL, open from the sidebar, click through every page and form (devices, device actions, issues, events, batteries, map, Wi-Fi, settings), MQTT via the Mosquitto add-on and via an external broker, restart and update.
