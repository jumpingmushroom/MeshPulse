# Zigbee Health Monitor — Spec

Oct 2, 2026 · @Johnny

## Overview

A standalone, passive service that watches one Zigbee2MQTT instance over MQTT and raises a small number of actionable issues when the mesh is unhealthy. It replaces "something feels off" with "router X dropped and took 6 sensors with it".

**Goals**

- One glance answers "is my Zigbee network OK?" (green / amber / red).
- Detect: offline devices, degrading link quality, rejoin/announce churn, message storms, low batteries, and low batteries that are already causing instability.
- Notify on Discord, ntfy or any Apprise target, without alert spam.
- Zero extra radio traffic in v1.

**Non-goals (v1)**

- Controlling devices or changing Z2M config.
- RF-level analysis (sniffing, channel interference). MQTT shows symptoms, not the radio.
- Home Assistant integration. The app is fully standalone.
- Multiple Z2M instances. The schema keeps an `instance_id` so this can be added later.

**Decisions so far**

| Topic | Decision |
| --- | --- |
| Coordinator | SLZB-06 (TI CC2652P, Z-Stack), SMLIGHT firmware v3.3.1. App reads `bridge/info.coordinator.type` at startup to confirm. |
| Traffic | Passive only. Active features (networkmap, coordinator\_check) are opt-in, off by default. |
| Notifications | Discord first. ntfy and Apprise as additional channels. |
| Integration | Fully standalone, own UI and auth. |
| Scope | One Z2M instance. |

## Prerequisites in Zigbee2MQTT

Three settings in `configuration.yaml`. The app checks each one from the retained `bridge/info.config` at startup and shows a warning banner for any that are missing.

```yaml
availability:
  enabled: true            # online/offline per device (mains: 10 min, battery: 25 h)
health:
  interval: 10             # bridge/health every 10 min
  reset_on_check: false    # keep cumulative counters; the app computes deltas
advanced:
  log_output: [console, file, mqtt]   # in Z2M 2.x: log_output under advanced
  log_level: info          # route/delivery errors are logged at info/warning/error
```

- `log_output` with `mqtt` is what makes route and delivery errors visible on `bridge/logging`. Without it, the route-failure rules are disabled and the UI says so.
- The availability timeouts should stay at their defaults. The app uses its own last-seen tracking as a second opinion.
- The MQTT user for the app needs **subscribe** on `zigbee2mqtt/#`. It needs **publish** on `zigbee2mqtt/bridge/request/#` only if active features are enabled later.

## Architecture

&#91;embedded content: architecture · one container, read-only on MQTT\]

MQTT is read-only: the collector writes compact state to SQLite, the rules engine turns it into issues, and the outbox delivers them. The UI only reads.

Stack: SvelteKit (adapter-node), Drizzle ORM with better-sqlite3, mqtt.js, Better Auth, Docker Compose, deployed with Dokploy. Collector, rules scheduler and outbox run in the same Node process.

## Data sources and ingestion

One MQTT subscription, `zigbee2mqtt/#`, feeds everything. The collector routes each message by topic and never sends anything to the bridge in v1.

| Topic | Fields used | Stored as | Feeds |
| --- | --- | --- | --- |
| `bridge/devices` (retained) | ieee\_address, friendly\_name, type, power\_source, model, vendor, software\_build\_id, interview\_state, disabled | `devices` upsert; removed devices flagged, not deleted | Inventory, router vs battery class |
| `bridge/info` (retained) | version, coordinator.type, network.channel, permit\_join, config | `bridge_snapshots` on change | Version-change events, prerequisites check, permit\_join alert |
| `bridge/state` (retained) | state online/offline | `events` | Bridge-down rule |
| `bridge/health` | process.uptime\_sec, mqtt.queued, per-device leave\_count, network\_address\_changes, messages, messages\_per\_sec | `health_samples` (deltas computed against the previous sample) | Restart detection, churn, storm |
| `bridge/event` | device\_joined, device\_leave, device\_announce, device\_interview | `events` | Churn, interview failures |
| `bridge/logging` | level, message, namespace; parsed for route/delivery errors | `events` with parsed `ieee` / `nwk_addr` and `error_code` | Route-failure rule |
| `<device>/availability` (retained) | state online/offline | `devices.availability` + `events` on change | Offline rule |
| `<device>` | linkquality, battery, voltage, last\_seen, plus message count | `samples` (LQI/battery/voltage, downsampled), `message_counts` per minute | LQI, battery, storm, silence |

**Ingestion details**

- Device payloads are not stored whole. Only `linkquality`, `battery`, `voltage` and `battery_low` are kept, plus a per-minute message counter.
- Sample LQI and battery at most once per 5 minutes per device (last value wins), so a chatty device can't bloat the database.
- Resolve friendly names to IEEE addresses through the `devices` table; all storage is keyed by IEEE so renames don't break history.
- Route-error log lines refer to a 16-bit network address. Map it to IEEE via `bridge/devices.network_address`, and remember that it changes when a device rejoins.
- Log parsing uses a small, tested pattern table, for example `MAC_NO_ACK`, `MAC_TRANSACTION_EXPIRED`, `NWK_NO_ROUTE`, "No network route", `ROUTE_ERROR_SOURCE_ROUTE_FAILURE`, "Delivery failed". Unmatched lines are dropped.
- On startup, retained topics rebuild current state immediately. History resumes from there.

## Data model

SQLite via Drizzle, WAL mode. Raw time series are kept 14 days, then rolled up into hourly aggregates kept 1 year.

| Table | Key columns | Notes |
| --- | --- | --- |
| `devices` | ieee (PK), instance\_id, friendly\_name, alias, type (Coordinator/Router/EndDevice), power\_source, model, vendor, firmware, availability, last\_seen\_at, first\_seen\_at, removed\_at, muted\_until, ignore\_rules (json) | One row per device, current state |
| `samples` | ieee, ts, lqi, battery, voltage | Raw, 5-minute downsampled, 14 days |
| `samples_hourly` | ieee, hour, lqi\_min/avg/max, battery\_min, voltage\_min, msg\_count | Rollup, 1 year |
| `message_counts` | ieee, minute, count | Per-minute counter for storm detection, 48 hours |
| `health_samples` | ts, uptime\_sec, mqtt\_queued, per-device json (leaves, addr\_changes, messages, mps) | Every 10 min, 14 days |
| `events` | id, ts, ieee (nullable), kind, error\_code, detail (json) | Joins, leaves, announces, interviews, route errors, availability changes, bridge restarts. Kept 90 days |
| `baselines` | ieee, metric, value, window, computed\_at | 7-day LQI mean/stddev, typical msg/min, report interval. Recomputed hourly |
| `issues` | id, rule, ieee (nullable), parent\_issue\_id, severity, state (open/acknowledged/resolved), opened\_at, updated\_at, resolved\_at, summary, evidence (json), last\_notified\_at | The core output of the app |
| `channels` | id, kind (discord/ntfy/apprise), name, config (json, secrets encrypted), min\_severity, enabled | Notification targets |
| `settings` | key, value | Thresholds and toggles, editable in UI |

All timestamps are UTC epoch milliseconds, displayed in Europe/Oslo.

## Detection rules

The rules engine runs every 60 seconds over current state and recent history. Each rule either opens, updates or resolves an issue. All thresholds below are defaults, editable in Settings and overridable per device.

**Bridge and coordinator**

| Rule | Fires when | Severity | Resolves when |
| --- | --- | --- | --- |
| `bridge.offline` | `bridge/state` = offline, or no message on any Z2M topic for 5 min | Critical | Bridge online and messages flowing for 2 min |
| `bridge.restarted` | `uptime_sec` in `bridge/health` lower than the previous sample | Info (Warning if 3+ restarts in 24 h) | Auto after 1 h |
| `bridge.mqtt_backlog` | `mqtt.queued` > 50 in two consecutive health samples | Warning | Queue < 10 |
| `bridge.permit_join_open` | `permit_join` true for > 10 min | Warning | permit\_join false |
| `monitor.mqtt_lost` | The app's own broker connection is down > 60 s | Critical (sent via channels; also stops the heartbeat) | Reconnected |
| `network.mass_offline` | ≥ 20% of routers, or ≥ 10 devices, go offline within 5 min | Critical; becomes the parent of device-offline issues | < 5% of routers offline |

**Availability**

| Rule | Fires when | Severity | Resolves when |
| --- | --- | --- | --- |
| `device.offline` | Availability = offline. Routers: immediately. End devices: also if silent > 3× their typical report interval (min 2 h, max 25 h) | Router: Warning. End device: Warning | Online again (resolution message includes downtime) |
| `router.offline_impact` | A router is offline and devices that previously reported through it are going silent | Critical; parent of those devices' issues | Router online |
| `device.flapping` | ≥ 4 online/offline transitions in 6 h | Warning | < 2 transitions in 6 h |
| `device.interview_failed` | `device_interview` status failed | Warning | Successful interview |

**Link quality**

| Rule | Fires when | Severity | Resolves when |
| --- | --- | --- | --- |
| `lqi.degrading` | 24 h LQI average > 25% below the device's 7-day baseline (needs ≥ 3 days of history) | Warning | Within 10% of baseline for 12 h |
| `lqi.weak` | 24 h LQI average < 30 (configurable, adapter-dependent) | Warning; Critical if < 15 | Average > 40 for 12 h |
| `route.failures` | ≥ 5 route/delivery errors for the device in 24 h | Warning; Critical at ≥ 20 | < 2 errors in 24 h |
| `network.route_errors` | Network-wide route errors > 3× the 7-day hourly baseline | Warning | Back under 1.5× baseline for 2 h |

**Churn and looping symptoms**

Routing loops are not visible over MQTT. These rules catch their symptoms: devices repeatedly leaving, rejoining or changing network address.

| Rule | Fires when | Severity | Resolves when |
| --- | --- | --- | --- |
| `device.rejoin_churn` | ≥ 3 `device_announce` events, or ≥ 2 `network_address_changes`, in 6 h | Warning; Critical at ≥ 10 in 24 h | No announce or address change in 12 h |
| `device.leave` | `device_leave` event, or `leave_count` increased | Warning | Device seen again |
| `network.churn` | ≥ 5 different devices announce within 15 min (outside Z2M start-up) | Warning | Quiet for 1 h |

**Storms**

| Rule | Fires when | Severity | Resolves when |
| --- | --- | --- | --- |
| `device.storm` | Device msg/min > 5× its 7-day baseline AND > 20 msg/min, sustained 5 min | Warning; Critical if > 60 msg/min | Under 2× baseline for 15 min |
| `device.dominant` | One device > 30% of all Zigbee messages over 15 min (ignoring devices marked chatty) | Warning | < 15% for 30 min |
| `network.storm` | Total msg/min > 4× the network's baseline for 5 min | Critical; top 5 contributors listed in evidence | Under 2× baseline for 15 min |

**Battery**

| Rule | Fires when | Severity | Resolves when |
| --- | --- | --- | --- |
| `battery.low` | battery ≤ 25%, or `battery_low` true, or voltage ≤ 2.8 V (CR2032/CR2450-class devices) | Warning | battery > 40% (battery swapped) |
| `battery.critical` | battery ≤ 10%, or voltage ≤ 2.6 V | Critical | battery > 40% |
| `battery.forecast` | Linear fit over last 30 days predicts ≤ 10% within 21 days | Info (shown in UI and weekly digest only) | Forecast > 30 days |
| `battery.causing_issues` | Device is battery-powered, battery ≤ 35% or voltage ≤ 2.8 V, AND in the last 48 h it has any of: rejoin churn, flapping, growing report gaps (> 2× typical), LQI drop > 25%, or route failures | Critical: "replace battery" is the suggested action | Battery replaced, or no instability for 48 h |
| `battery.stale` | No battery report for > 7 days from a device that normally reports daily | Info | Battery report received |

Notes:

- Battery percentage is unreliable on many devices. Voltage, when exposed, takes precedence.
- A battery that jumps up by > 30 points is recorded as a battery swap event, which resets the forecast.
- Devices can be tagged *chatty* (excluded from `device.dominant`) or *ignore* (all rules off).

## Issues, grouping and health score

The app's output is a short list of issues, never a stream of raw alerts. One problem in the mesh should produce one notification.

**Lifecycle**

1. **Open.** A rule's condition holds for its minimum duration (default 2 consecutive evaluations, so one bad sample never alerts).
2. **Update.** Evidence is refreshed every run. Severity can escalate; escalation triggers a new notification.
3. **Acknowledged.** Set from the UI. Stops repeat notifications but stays visible until resolved.
4. **Resolved.** The resolve condition holds for its hold time. A short "resolved" message is sent, with duration.

Each issue carries a plain-language summary and a suggested action, for example "Replace battery in *Bad sensor*: 18% / 2.7 V, rejoined 4 times today."

**Grouping**

- `network.mass_offline` and `network.storm` become parents. Device-level issues opened during a parent incident are attached as children and are not notified separately.
- `router.offline_impact` groups devices that went silent within 10 minutes of a router dropping. In passive mode this is inferred from timing. If the optional nightly networkmap is enabled, real parent links are used instead.
- A device has at most one open issue per rule. Repeated firings update it.

**Noise control**

- Repeat notifications for an open, unacknowledged issue: Critical every 6 h, Warning every 24 h, Info never.
- Quiet hours (default 23:00–07:00) hold back Warning and Info; Critical always goes through. Held messages are sent as one summary at the end of quiet hours.
- Start-up grace: rules that depend on rates or silence wait 15 min after the app or Z2M starts.
- Per-device mute (1 h, 24 h, 7 days, forever).

**Health score**

One number from 0 to 100 at the top of the dashboard, with a status colour.

- Start at 100. Subtract 25 per open Critical, 8 per Warning, 1 per Info. Floor at 0.
- Green ≥ 85 with no Critical. Amber ≥ 60 or any Warning. Red below 60 or any Critical.
- The score is also shown per device (based on its own issues and LQI versus baseline) to sort the device list.

A weekly digest goes out Sunday 18:00: score trend, batteries due within 30 days, weakest links, most-churning devices.

## Notifications

All channels share one interface: `send(message: { severity, title, summary, action, fields, url, kind: 'open' | 'escalate' | 'reminder' | 'resolved' | 'digest' })`. Each channel has a minimum severity, so Critical can go to ntfy on the phone while everything goes to Discord.

| Channel | Transport | Formatting | Config |
| --- | --- | --- | --- |
| Discord (primary) | Webhook POST | Embed: colour by severity (red/amber/blue, green for resolved), title, summary, fields (device, LQI, battery, last seen), link to the issue page. `@here` mention only on Critical, optional | Webhook URL, mention on/off |
| ntfy | HTTP POST to `<server>/<topic>` | Title header, priority 5 for Critical, 4 Warning, 3 Info, 2 resolved; tags (`rotating_light`, `warning`, `white_check_mark`); click action to the issue page | Server URL, topic, optional access token |
| Apprise | POST to a self-hosted `apprise-api` container's `/notify` | Title + body in Markdown, type `failure` / `warning` / `info` / `success` | API URL plus either a config key or a list of Apprise URLs |

- Apprise covers anything else (Telegram, Pushover, email, Signal). Discord and ntfy are native because they support richer formatting and click-through.
- Delivery runs through an outbox table with retry and backoff (1 min, 5 min, 30 min), so a Discord outage doesn't lose alerts.
- Discord webhooks are rate-limited. The outbox sends at most 1 message per 2 seconds per channel and folds bursts into one "5 new issues" message.
- "Send test" button per channel in Settings.

**Dead-man's switch**

If the monitor itself dies, nothing alerts. The app pings an external heartbeat URL (Uptime Kuma push monitor or Healthchecks) every minute, and only while its MQTT connection is up and the rules engine has run in the last 2 minutes.

## UI

Calm by default, loud only when needed: a healthy network shows a mostly empty page with a green score. Live updates over Server-Sent Events.

| Page | Contents |
| --- | --- |
| Overview | Health score and status banner; open issues sorted by severity, children collapsed under parents; counters (devices online/total, routers online/total, batteries due in 30 days); network msg/min sparkline (24 h); bridge status line (Z2M version, uptime, channel, coordinator). |
| Issues | Open / acknowledged / resolved tabs; filter by rule and severity; issue page with summary, suggested action, evidence chart (the metric that triggered it, with threshold), event timeline, acknowledge and mute buttons. |
| Devices | Sortable table: name, type, availability, last seen, LQI (current / 24 h avg / baseline), battery % and voltage, msg/min, device score, open issues. Filters: routers, battery, offline, has issues. |
| Device detail | LQI, battery/voltage and message-rate charts (24 h / 7 d / 30 d); events (announces, leaves, route errors, availability changes); battery forecast; tags (chatty, ignore), mute, per-device threshold overrides. |
| Batteries | Battery devices sorted by forecast "days left"; last swap date; voltage trend. Doubles as a shopping list. |
| Events | Raw event log, filterable by kind and device, 90 days. |
| Settings | Thresholds per rule, quiet hours, channels (with test), heartbeat URL, retention, Z2M prerequisites status, opt-in active features (off). |

Authentication: single admin user via Better Auth. Intended for LAN or reverse proxy, not the public internet.

## Configuration and deployment

One container, one SQLite volume. Connection settings come from the environment; everything else is set in the UI and stored in `settings`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MQTT_URL` | `mqtt://mosquitto:1883` | Broker |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Read-only broker user |
| `Z2M_BASE_TOPIC` | `zigbee2mqtt` | Base topic |
| `DATABASE_PATH` | `/data/monitor.db` | SQLite file |
| `PUBLIC_URL` | empty | Used for links in notifications |
| `TZ` | `Europe/Oslo` | Display, quiet hours, digest time |
| `SECRET_KEY` | required | Encrypts channel secrets, session signing |
| `HEARTBEAT_URL` | empty | Dead-man's switch |

```yaml
services:
  zigbee-monitor:
    image: ghcr.io/<you>/zigbee-monitor:latest
    restart: unless-stopped
    environment:
      MQTT_URL: mqtt://192.168.1.10:1883
      MQTT_USERNAME: zigbee-monitor
      MQTT_PASSWORD: ${MQTT_PASSWORD}
      PUBLIC_URL: https://zigbee.home.lan
      SECRET_KEY: ${SECRET_KEY}
      TZ: Europe/Oslo
    volumes:
      - ./data:/data
    ports:
      - "3000:3000"
  apprise:            # optional
    image: caronc/apprise:latest
    restart: unless-stopped
```

- Process layout: the SvelteKit server (adapter-node) starts the MQTT collector, rules scheduler and outbox worker in the same Node process via a server hook. No separate worker container in v1.
- Health endpoint `/api/health` reports MQTT connection, last message time and last rules run, for Docker health checks and Uptime Kuma.
- Deploy with Dokploy on the homelab NUC, close to the broker.
- Testing: a recorded-traffic replayer (capture `zigbee2mqtt/#` to a JSONL file, replay at N× speed) so rules can be tested against real storms and outages.

## Phases

Each phase is usable on its own; phase 1 already replaces "I found out when the lights stopped working".

1. **MVP: know when things break.** Collector, `devices` inventory, availability and silence rules, bridge rules, battery thresholds, issues with lifecycle, Discord channel, Overview + Devices + Issues pages, heartbeat. Exit: a week of running against the real mesh with no false Critical.
2. **Trends: know before things break.** Samples and rollups, LQI baselines and `lqi.*` rules, log parsing and `route.*` rules, battery forecast and Batteries page, ntfy channel.
3. **Correlation: know why.** Churn rules, storm rules, `battery.causing_issues`, mass-offline and router-impact grouping, health score, weekly digest, Apprise channel, traffic replayer for tests.
4. **Opt-in active features.** Nightly networkmap (one scan at 04:00, max one manual per hour) for real parent links and a map view; daily `coordinator_check` (TI adapters) for missing routers.

**Later ideas**

- Publish the app's own health score back to MQTT, if you ever want it on the wall panel after all.
- Multiple Z2M instances (the `instance_id` is already in the schema).
- Correlate with Wi-Fi channel changes from the UDM Pro API to spot 2.4 GHz interference.
- Local LLM summary in the weekly digest ("What changed this week and what to check first").
