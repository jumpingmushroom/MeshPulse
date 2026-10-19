# MeshPulse public release: design

## Goal

Anyone running Zigbee2MQTT can install MeshPulse from a published image with only an MQTT URL, finish setup in the browser, and update with `docker compose pull`. The repo goes public under MIT.

Decisions from brainstorming (Q1-Q4):
- Public repo, MIT license, public image on GitHub Container Registry (Q1 A).
- Releases from version tags; pull requests and main only test (Q2 A). amd64 and arm64.
- First run works with just `MQTT_URL`: generated secret key, admin setup page, setup panel (Q3 A). Editing MQTT in the UI is out.
- Standalone Docker app. No Unraid Community Apps listing now; a Home Assistant add-on comes later (Q4).

## Out of scope

Community Apps submission, Home Assistant add-on, MQTT settings in the UI, multi-user or sign-up, a docs site, versioned migrations for downgrades.

## 1. Publishing

- `LICENSE`: MIT, copyright Johnny Dalen.
- Before the repo goes public: scan the full history once with gitleaks (`docker run zricethezav/gitleaks detect`, not a project dependency). Any finding is rotated and removed before the visibility change. The visibility change is done by hand after the user confirms.
- `.github/workflows/ci.yml`, on pull requests and pushes to main: `npm ci`, `npm test -- --run`, `npm run check`, `docker build` (no push).
- `.github/workflows/release.yml`, on tags `v*`: `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` with `GITHUB_TOKEN` (`packages: write`), `docker/metadata-action` for tags `X.Y.Z`, `X.Y`, `latest`, `docker/build-push-action` for `linux/amd64,linux/arm64`. Image `ghcr.io/jumpingmushroom/meshpulse`, with OCI labels (source, license, version). The package is set to public by hand after the first push.
- First release: `v0.1.0`. `package.json` version follows the tag.
- `docker-compose.yml` uses `image: ghcr.io/jumpingmushroom/meshpulse:latest`; `build: .` stays as a commented alternative.
- `unraid/meshpulse.xml`: `Repository` points at the GHCR image; `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` become optional.

## 2. First run

### Secret key

`loadConfig` no longer throws without `SECRET_KEY`. Resolution, in order:
1. `SECRET_KEY` env (at least 32 characters, as today): used as is.
2. `<dir of DATABASE_PATH>/secret.key` if it exists: its trimmed content.
3. Otherwise: 32 random bytes, base64, written to that file with mode 0600, then used.

A set env always wins, so existing installs keep their key and their encrypted values. Logged once: `secret key: env | file | generated` (never the key). If the file can't be written, startup fails with that path in the error.

### Admin setup page

- `ensureAdmin` keeps creating the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` when set.
- New route `/setup` (`+page.server.ts`, `+page.svelte`), public in the auth guard.
- `needsSetup(db)`: true when the `user` table has no rows. Cached in memory once false.
- `hooks.server.ts`: while `needsSetup`, every non-public path except `/setup`, `/api/health` and `/api/auth/*` redirects 303 to `/setup`; `/login` redirects there too. When setup is done, `/setup` returns 404.
- The form: email, password, confirm password. Password at least 12 characters; email must look like an email. Errors are shown per field with the existing form styles.
- Creating the account: the existence check and the creation run under one lock (a module-level promise chain plus a re-check of the user count right before `createUser`), so a second concurrent submit gets "Setup is already done" and nothing is created. The account is created like `ensureAdmin` does (`internalAdapter.createUser` + credential account), then signed in with `auth.api.signInEmail`, and redirected to `/`.
- Sign-up stays disabled in Better Auth; `/setup` is the only way to create the first user.

### Setup panel

On the Overview, above everything else, when either holds:
- MQTT not connected: "MeshPulse can't reach the MQTT broker at `<MQTT_URL without credentials>`: `<last error>`. Check the URL, username and password." The collector keeps `state.monitor.lastError` (string or null).
- Connected for 2 minutes and no message on `<base>/bridge/state` or `<base>/bridge/info` yet: "Connected, but nothing from Zigbee2MQTT on `<base>/bridge/…`. Check `Z2M_BASE_TOPIC` (now `<base>`) and that the MQTT user may subscribe to `<base>/#`."

It uses the existing alert styles (`monitor-alert`) and disappears on its own once data flows. The existing Zigbee2MQTT prerequisite checks stay as they are.

## 3. Docs

README:
- Install with Docker Compose (the compose file plus a minimal `.env`) and with `docker run`.
- First run: open the page, create the admin account; finish this before exposing MeshPulse beyond the home network.
- What Zigbee2MQTT needs: the three settings from `checkPrereqs` (availability, health, MQTT logging on 1.x).
- Updating: `docker compose pull && docker compose up -d`; back up `/data` first.
- Environment variables table: only `MQTT_URL` required.

`.env.example`: `SECRET_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` marked optional with what happens when unset.

## Testing

- `config.test.ts`: env key wins and no file is written; file reused; key generated with mode 0600 and reused on the next load; short env key still rejected.
- `setup.test.ts`: `needsSetup` true with zero users, false after; guard redirects only while needed; `/setup` 404 afterwards; two concurrent submits create exactly one user; password and email validation.
- Setup panel: view helper test for both messages and for no panel when data flows; credentials are stripped from the shown URL.
- Release workflow: one run on a throwaway tag `v0.0.0-test` while the repo is still private (the package stays private); the tag and the package version are deleted afterwards.
- Fresh install on Unraid from the published image with an empty data folder and only `MQTT_URL`: setup page, generated key file, Overview fills in.

## Order

1. Branch work: license, CI, release workflow, first-run code, docs (merged to main while the repo is private).
2. Gitleaks scan of the full history; fix anything found.
3. User confirms; repo made public; package made public.
4. Tag `v0.1.0`; fresh install test on Unraid.
