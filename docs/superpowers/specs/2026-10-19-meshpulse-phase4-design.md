# MeshPulse Phase 4 (Opt-in active features) — design

Oct 19, 2026 · Builds Phase 4 of `docs/SPEC.md` on top of the MVP, Phase 2,
Phase 3 and the UI redesign (`2026-10-19-meshpulse-ui-redesign-design.md`).
Where this document and the spec differ, this document wins.

## Goal

Two opt-in features that send requests into the Zigbee network, both off by
default: a daily coordinator check that finds routers the coordinator has lost,
and a nightly network scan that gives real parent links (for router grouping)
and a network map. Everything else MeshPulse does stays read-only.

Exit criterion: with both switched on for a week on the real mesh (Zigbee2MQTT
2.14.2, Z-Stack SLZB-06, 138 devices), no false Critical, no coordinator hang
that lines up with a scan, and no run without a recorded result.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| Q12 | Scope | Both, coordinator check first; the scan is conservative (one nightly, guarded by mesh health). |
| Q13 | Manual scan | "Scan now" on the map page, max one manual scan per hour, same guards as the nightly scan. |
| Q14 | Missing routers | One Warning issue per missing router (`coordinator.missing_router`), notified; resolves when a later successful check no longer lists it. |
| Q15 | History | Keep 30 days of runs; the device page shows its parent and "changed since previous scan". |
| — | Architecture | One small request module in the existing process and MQTT connection; scheduling on the engine tick. |
| — | Times | Coordinator check 03:30, network scan 04:00, in `TZ`. |

## Out of scope

Routes (`routes: true`), per-link history charts, scanning more than once a
night automatically, any other MQTT request, re-pairing from MeshPulse,
non-TI coordinator checks.

## Requests

- `src/lib/server/mqtt/request.ts`: `request(client, baseTopic, name, payload, timeoutMs)`
  publishes to `<base>/bridge/request/<name>` with a random `transaction`,
  resolves with the matching `<base>/bridge/response/<name>` (same transaction),
  rejects on timeout or `status: "error"`. Allowed names: `networkmap`,
  `coordinator_check`; any other name throws before publishing.
- Payloads: networkmap `{ "type": "raw", "routes": false }`; coordinator_check `{}`.
- The collector passes `bridge/response/*` messages to the module (they already
  arrive via the `zigbee2mqtt/#` subscription).
- Timeouts: networkmap 10 min, coordinator_check 60 s.
- A publish refused by the broker is reported as "MQTT user needs publish on
  `zigbee2mqtt/bridge/request/#`".

## Settings

- `activeCoordinatorCheck: boolean` and `activeNetworkScan: boolean`, both
  default `false`. Last run days stored as settings keys (like `weeklyDigestWeek`).
- Settings page: section "Active features" with the mockup's text: "These send
  requests into your Zigbee network. Everything else MeshPulse does is read-only.
  Off by default." Per feature: switch, help line (scan: "Runs at 04:00. A scan
  of N devices takes 2–4 minutes and briefly loads the mesh."), last run (time,
  result, skip/fail reason), next run.

## Schedule and guards

- Checked on every 60 s engine tick. Coordinator check: first tick at or after
  03:30 `TZ` on a day it has not run; network scan: same at 04:00. Missed runs
  catch up later the same day. A run still skipped at midnight stays recorded
  as skipped (with its last reason) for that day; the next day starts fresh.
- Guard (shared, pure `activeGuard(state, open, now)` → reason | null). Skip when:
  MQTT disconnected; bridge state not online; any open `bridge.offline`,
  `monitor.mqtt_lost`, `network.mass_offline`, `network.storm`; Zigbee2MQTT or
  MeshPulse restarted less than 60 min ago; a request of the same kind running.
  A skipped scheduled run is retried on the next tick until midnight; each skip
  reason is stored once per day (latest reason wins).
- Manual scan: same guard plus at most one manual scan per 60 min; refusal reason
  shown next to the button.
- Failures (timeout, error status, unparsable response) are recorded; no retry
  that night. Three consecutive failed nightly scans raise one Info issue
  `active.scan_failing` ("Network scan keeps failing"), resolved by the next
  successful scan.

## Data

Migration 0004:

- `scans`: id, kind (`networkmap` | `coordinator_check`), trigger (`scheduled` |
  `manual`), started_at, finished_at, status (`ok` | `failed` | `skipped`),
  reason (text, nullable), nodes (int), links (int), missing (json, coordinator
  check: missing router ieees).
- `scan_links`: scan_id, source_ieee, target_ieee, lqi, depth, relationship (int,
  as Zigbee2MQTT reports it).
- Retention: 30 days for both.

Parsing (pure, `src/lib/server/active/parse.ts`):

- Networkmap raw → nodes (ieee, type, failed) and links. A device's **parent**:
  the link whose relationship marks the other end as its parent; otherwise its
  highest-LQI link to a Router or the Coordinator; none if neither exists.
- **Parent changed**: parent differs from the previous successful scan's parent.
- Coordinator check → list of missing router ieees.
- Parser fixtures: one real networkmap response and one real coordinator check
  response, captured from the user's network during the build (one manual run
  each, with the user's go-ahead).

## Rules and grouping

- `coordinator.missing_router` (Warning, per router ieee): fires for routers in
  the latest successful coordinator check; resolves when a later successful check
  omits it; failed/skipped checks change nothing (no false resolve). Action:
  "Re-pair <router> so the coordinator knows it again". Respects `ignore` tag.
- Router grouping: if the latest successful scan is ≤ 48 h old and the end
  device has a parent in it, a new `device.offline` of that end device attaches
  to its parent's open `device.offline` issue (parent must be a Router). Otherwise
  the existing 10-min timing rule applies unchanged.
- "Offline at last scan": routers reached by the scan with `failed` set; shown on
  the map only (offline routers already raise `device.offline`).

## UI

- `/map` (button "Network map" on Devices; not in the top menu). Header: "From
  the nightly network scan · last scanned <time> (<ago>) · next scan <time>.
  Positions are a layout, not a floor plan." Tag "Opt-in · sends traffic to the
  mesh" and "Scan now" (with refusal reason). Radial layout from a pure
  `mapLayout(scan)`: coordinator centre, routers in rings by depth, end devices
  around their parent; deterministic. SVG with the mockup's map classes (restored
  to `src/app.css` for this page only). Solid link LQI ≥ 60, dashed below; failed
  routers crossed; nodes link to device pages with name and LQI as title. Side
  panel: legend, "Offline at last scan N". Empty states: feature off (what it
  does, its cost, link to Settings); no scan yet; last scan failed (error, last
  good scan still shown).
- Amended Oct 19 (Q18): the map supports zoom, pan, node selection with a side panel and device search; without JS it stays static.
- Device page: "Parent <name> · LQI n" badge (link), "· changed since previous
  scan" when moved; routers: "N devices route through this router".
- Issue page: `coordinator.missing_router` uses the existing layout.

## Testing

- Request module with a fake client: transaction matching, timeout, other
  transactions ignored, unknown name refused, error status.
- Schedule and guard: fake clock around 03:30/04:00 `TZ`, catch-up, skip reasons,
  manual limit.
- Parsers on real fixtures; parent selection; parent change.
- Missing-router rule: open, resolve, hold on failed/skipped check, ignore tag.
- Grouping with and without a recent scan.
- `mapLayout`: deterministic, children around parents, no overlapping nodes at
  140 nodes.
- Screenshots of the map and settings on live data after the first real scan.

## Milestones

1. Brainstorm and plan
2. Request module and Active features settings (both off)
3. Coordinator check: schedule, guard, storage, `coordinator.missing_router`
4. Network scan: schedule, Scan now, storage, parser
5. Real-parent grouping and parent on the device page
6. Map page
7. Docs and deploy

Rollout: the user switches features on; one manual scan only with the user's
go-ahead; MeshPulse never enables anything itself.

## Risks

- A scan is the heaviest request for a coordinator that hung on Oct 18 →
  off by default, guards, one scheduled scan a night, scans recorded with start
  and end so a hang can be matched to a scan; switch off if one ever does.
- Zigbee2MQTT response format changes → parser on real fixtures; a parse failure
  fails the run instead of feeding wrong parents to grouping.
- Missing MQTT publish rights → explicit error in Settings.
- Sleepy end devices may be missing from a scan → they keep timing-based grouping.
