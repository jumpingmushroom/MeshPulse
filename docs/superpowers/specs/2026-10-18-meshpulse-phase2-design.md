# MeshPulse Phase 2 (Trends) — design

Oct 18, 2026 · Builds Phase 2 of `docs/SPEC.md` on top of the MVP
(`2026-10-16-meshpulse-mvp-design.md`). Where this document and the spec
differ, this document wins for Phase 2. Everything in the MVP design still
applies unless changed here.

## Goal

Know before things break: weak and degrading links, route failures, and
batteries about to run out, visible on per-device charts, with a second
notification channel.

Exit criterion is unchanged: no false Critical during a week on the real mesh
(Zigbee2MQTT 2.14.2, Z-Stack CC2652P, 139 devices).

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| Q2 | Device charts | Phase 2 includes a Device page with charts (24 h / 7 d / 30 d). |
| Q3 | Route-error patterns | Built from Zigbee2MQTT / zigbee-herdsman source research (`docs/superpowers/research/2026-10-18-z2m-route-errors.md`) and tested against 24 h of real `bridge/logging` recorded on the user's mesh. |
| Q4 | Battery forecast | UI only: never notifies. |
| Q5 | Second channel | Apprise (the user's existing `apprise-api`) instead of native ntfy. Native ntfy is dropped. |
| — | `lqi.weak` | Warning only, never Critical (spec said Critical < 15): Z-Stack edge devices often report LQI < 15 while working. Real failures surface as `route.failures`. |
| — | `network.route_errors` | Also needs ≥ 10 errors in the hour, so a quiet network going 0 → 3 is not "3× normal". |
| — | Baseline window | The 7 days before the last 24 h, so a degrading device does not drag its own baseline down. |
| — | Message counts | Hourly per-device message count is collected now (Device page chart; history for Phase 3 storm rules). |

## Out of scope

Per-device threshold overrides, the `chatty` tag, charts embedded in issue
pages, `message_counts` per minute, `health_samples`, native ntfy, and
everything in Phases 3–4.

## Data

New tables (Drizzle, generated migration):

| Table | Columns | Notes |
| --- | --- | --- |
| `samples_hourly` | ieee, hour (epoch ms, start of hour), lqi_min, lqi_avg, lqi_max, battery_min, voltage_min, msg_count | PK (ieee, hour). Kept 365 days. |
| `baselines` | ieee (`''` for network-wide), metric, value, days, computed_at | PK (ieee, metric). Metrics: `lqi_mean`, `lqi_stddev` per device; `route_errors_hourly` network-wide. `days` = distinct days with data in the window. |

**Hourly job** (inside the engine, at most once per hour, after the first
full hour has passed):

1. Roll up every complete hour not yet in `samples_hourly` (bounded to the
   last 48 h) from raw `samples`, plus the in-memory message counter. Upsert, so
   a rerun is harmless.
2. Recompute baselines from `samples_hourly` and `events` over the window
   `[now − 8 d, now − 24 h)`.

**Message counter**: the collector increments a per-device counter for every
live (non-retained) device message, keyed by hour. The hourly job reads and
clears finished hours. A restart loses at most the current hour's counts.

**Route errors**: `bridge/logging` lines go through a pure parser
`parseRouteError(payload) → { kind, code, ieee?, name? } | null`. Patterns
come from the research file and the recording:

- `Publish '…' to '<name>' failed: '… ZCL command <ieee>/<ep> … failed (<reason>)'`
  (level error): one line per failed command; the IEEE is taken from the
  message.
- `Failed to ping '<name>' (attempt i/n, …)` (level warning): counted once per
  ping (only the final attempt, or deduplicated per device within 60 s).
- Ember-only messages (`Delivery failed for …`, `ROUTE_ERROR_SOURCE_ROUTE_FAILURE`)
  are not expected on Z-Stack; they are ignored unless the recording shows
  them.
- Unmatched lines return `null` and are dropped.

A match becomes an event `route_error` with `detail { code, reason }` and the
device's IEEE (resolved by IEEE or friendly name; `null` when unknown). Unknown
devices still count network-wide.

Retention: `samples_hourly` 365 days; route-error events follow the existing
90-day event retention.

## Rules

All read SQLite history, so restarts do not reset them. Thresholds are new
settings with these defaults. No startup grace (history-based).

| Rule | Fires when | Severity | Stops when |
| --- | --- | --- | --- |
| `lqi.weak` | 24 h average LQI < 30, with data in ≥ 6 of those hours | Warning | 12 h average > 40 |
| `lqi.degrading` | 24 h average > 25% below the 7-day `lqi_mean`, baseline `days` ≥ 3 | Warning | 12 h average within 10% of `lqi_mean` |
| `route.failures` | ≥ 5 `route_error` events for the device in 24 h | Warning; Critical at ≥ 20 | < 2 in 24 h |
| `network.route_errors` | Route errors in the last hour > 3 × `route_errors_hourly` and ≥ 10, baseline `days` ≥ 3 | Warning | < 1.5 × baseline for each of the last 2 h |
| `battery.forecast` | Linear fit of `battery_min` over the hours since the last `battery_swap` (≥ 7 days, ≤ 30 days of data) reaches 10% within 21 days | Info, never notifies | Predicted date > 30 days away |

Plumbing:

- `RULE_DEFAULTS` gains `notify: boolean` (default true); `battery.forecast`
  sets it false. The lifecycle opens, updates and resolves such issues but
  queues no messages.
- All new rules are device-level except `network.route_errors`; the flood guard,
  mute, ignore and removed-device handling apply as today.
- "For 12 h" / "for 2 h" stop conditions are evaluated over those history
  windows, so the lifecycle needs no new state.
- The rule context gets a small read-only history accessor (hourly rows, recent
  route-error counts, baselines, last swap time) built once per run, so rules
  stay pure and testable.

## UI

- **Device page** `/devices/<ieee>` (device names link here from the Devices
  table and issue pages):
  - Header: name, type, model, power source, availability, last seen, open issues.
  - Charts with a 24 h / 7 d / 30 d switch (24 h from raw samples, 7 d / 30 d
    from `samples_hourly`): link quality (avg line, min–max band, dashed baseline
    and weak-threshold lines), battery % and voltage (battery devices only),
    messages per hour.
  - Battery forecast ("about N days until 10%") and last swap date.
  - Last 50 events: availability, join, leave, announce, route errors.
  - Mute control (same as the issue page) and an "Ignore this device" toggle
    (sets the `ignore` tag in DB and memory).
- **Batteries page** `/batteries` (in the menu): battery devices sorted by days
  left (no forecast last); name, battery %, voltage, days left, last swap, a
  30-day sparkline.
- **Charts**: one server-rendered SVG component, no chart library, no JS needed;
  a pure path builder; each chart has a text summary for screen readers.
- **Settings**: new thresholds; an Apprise section.

## Apprise channel

- Channel kind `apprise`, config `{ apiUrl, key?, urls? }`: either a stored
  apprise-api config key (`POST <apiUrl>/notify/<key>`) or a list of Apprise
  URLs (`POST <apiUrl>/notify` with `urls`). `urls` are encrypted like the
  Discord webhook and never returned to the browser.
- Body JSON: `title`, Markdown `body` (summary, action, fields, link),
  `type` = `failure` (critical), `warning`, `info`, `success` (resolved),
  `format: "markdown"`.
- Uses the existing outbox (dedupe, retry/backoff, 2 s spacing, folding, quiet
  hours, per-channel minimum severity) and Send test.
- The user's apprise-api runs at `http://192.168.3.3:8001` with stored configs.

## Testing

- Rollups and baselines: in-memory DB with known samples; rerun idempotent;
  baseline window excludes the last 24 h.
- Each rule: fires, holds, stops; guards (< 3 days baseline, < 10 errors,
  < 6 hours of data, < 7 days of battery data, swap resets the fit).
- Parser: research examples plus real lines from the recording saved as
  `tests/fixtures/z2m-logging.jsonl`; non-error lines return `null`; ping
  retries count once.
- Lifecycle: `notify: false` rule opens and resolves with no messages.
- Charts: pure path builder unit tests; screenshots checked by eye.
- Apprise: fake fetch unit tests; one real Send test through the user's
  apprise-api.
- Deploy: rebuild on Unraid; rollups appear after the first full hour.

## Milestones

1. Brainstorm and plan
2. Hourly rollups and baselines
3. Link quality rules
4. Battery forecast
5. Apprise channel
6. Device page and charts
7. Batteries page and links
8. Log parser and route rules (after the 24 h recording finishes)
9. Deploy to Unraid and update docs

## Risks

- **Sleepy end devices** report LQI rarely; the ≥ 6 hours-with-data guard keeps
  `lqi.weak` from firing on a handful of samples.
- **Parser coverage**: only Z-Stack error formats are expected; the recording
  may show other wording, which is why the parser milestone waits for it.
- **Battery % granularity**: many devices report in steps (100 → 67 → 33);
  the forecast needs ≥ 7 days of data and treats a > 30-point rise as a swap.
