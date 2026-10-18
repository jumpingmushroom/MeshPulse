# MeshPulse Phase 3 (Correlation) — design

Oct 18, 2026 · Builds Phase 3 of `docs/SPEC.md` on top of the MVP and Phase 2
(`2026-10-16-meshpulse-mvp-design.md`, `2026-10-18-meshpulse-phase2-design.md`).
Where this document and the spec differ, this document wins. Earlier designs
still apply unless changed here.

## Goal

Know why: one problem in the mesh produces one notification, with its cause
(router dropped, storm, dying battery), plus churn and storm detection, a
health score and a weekly digest.

Exit criterion is unchanged: no false Critical and no alert spam during a
week on the real mesh (Zigbee2MQTT 2.14.2, Z-Stack, 139 devices).

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| Q6 | Router impact | Group by timing, cautiously: end devices whose silence starts within 10 min after a router goes offline attach as children of the router's `device.offline` issue. One notification; no extra Critical; no separate `router.offline_impact` rule. Real parent links wait for the Phase 4 network map. |
| Q7 | Device score | Issues only: 100 − 25 per Critical − 8 per Warning − 1 per Info on that device, floor 0. |
| Q8 | Weekly digest | Per-channel "Weekly digest" checkbox, default on for Discord, off for Apprise. |
| — | Per-minute counts | In memory only (last 60 min per device + network total); no `message_counts` table. |
| — | `battery.causing_issues` | Not a separate issue: the device's `battery.low` issue escalates to Critical with "Replace battery" wording and the instability as evidence. |
| — | Unclaimed spec rules | `bridge.mqtt_backlog` and `device.interview_failed` are included. |
| — | Replayer | Built first; every rule milestone is replayed against the user's real 24 h capture before merge. |
| — | Score and children | Child issues do not count toward the network score (one incident, one deduction); they do count toward their own device's score. |

## Out of scope

Real parent links / network map (Phase 4), `coordinator_check`, per-device
threshold overrides, per-rule ignore UI, chart redesign (separate UI design
pass), publishing the image.

## Data

- **Minute counters** (in memory): per device and network-wide, the count of
  live device messages per minute for the last 60 minutes (ring buffer).
  Restart loses them; storm rules respect the 15-min startup grace.
- **`health_samples`** table: one row per `bridge/health` message — ts,
  uptime_sec, mqtt_queued, devices json (`leave_count`,
  `network_address_changes` per IEEE). Kept 14 days.
- **New events** (router, from `bridge/health` deltas against the previous
  sample, kept in memory and seeded from the last stored sample on start):
  `leave_count_up` and `address_changed`, each with the IEEE and the delta.
- **Tags**: `chatty` joins `ignore` in the existing device tags.
- **`health_scores`** table: ts (hourly), score (network). Kept 1 year.
- **Channels**: `config.weeklyDigest: boolean` (Discord default true, Apprise
  default false).

## Rules

Thresholds are the spec's defaults, all editable settings. No rule here runs
during the 15 min after a MeshPulse or Zigbee2MQTT restart where it depends
on announces, leaves or rates.

| Rule | Fires when | Severity | Stops when |
| --- | --- | --- | --- |
| `device.rejoin_churn` | ≥ 3 `device_announce` or ≥ 2 `address_changed` events in 6 h | Warning; Critical at ≥ 10 in 24 h | None in 12 h |
| `device.leave` | `device_leave` or `leave_count_up` event | Warning | Device seen again (live message after the leave) |
| `network.churn` | ≥ 5 different devices announce within 15 min | Warning | No announces for 1 h |
| `device.interview_failed` | `device_interview` with status failed | Warning | A later successful interview |
| `device.storm` | Device msg/min > 5 × its 7-day baseline AND > 20 msg/min, for 5 consecutive minutes; baseline needs ≥ 3 days | Warning; Critical if > 60 msg/min | < 2 × baseline for 15 min |
| `device.dominant` | One device > 30% of all messages over 15 min (excluding `chatty`), network total ≥ 60 msg in that window | Warning | < 15% for 30 min |
| `network.storm` | Total msg/min > 4 × network baseline for 5 min; baseline ≥ 3 days | Critical; top 5 contributors in evidence | < 2 × baseline for 15 min |
| `network.mass_offline` | ≥ 20% of routers, or ≥ 10 devices, went offline within 5 min | Critical | < 5% of routers offline and < 10 devices offline |
| `battery.low` (extended) | Existing conditions; escalates to Critical "causing issues" when battery ≤ 35% (or coin cell ≤ 2.8 V) and in the last 48 h: churn, flapping, report gaps > 2 × typical, LQI drop > 25%, or route failures | Warning → Critical | As today (swap / > 40%), or 48 h without instability drops back to Warning |
| `battery.stale` | No battery value for > 7 days from a device whose battery normally reports at least daily | Info, never notifies | Battery report received |
| `bridge.mqtt_backlog` | `mqtt.queued` > 50 in two consecutive health samples | Warning | Queue < 10 |

Baselines for storms: device msg/min = 7-day mean of hourly `msg_count` ÷ 60
(new `baselines` metric `msg_per_min`); network = sum over devices
(`|msg_per_min`). Computed by the existing hourly job, same day counting as
Phase 2 (`floor(hours with data / 24)`).

## Grouping

- **Parents:** `network.mass_offline`, `network.storm`, and any open
  `device.offline` issue of a Router.
- **Attaching:** in the lifecycle, a device-level issue that opens while a
  matching parent is open gets `parent_issue_id` and emits no notification.
  Matching: mass offline ← `device.offline`, `device.flapping`; storm ←
  `device.storm`, `device.dominant`; router ← `device.offline` of an
  EndDevice whose `offlineSince` (or silence start) is within 10 min after the
  router's offline time. If several parents match, the earliest-opened wins.
- **Parent messages:** the parent's evidence carries `children` (count and
  names); its summary says e.g. "Hall plug offline: 6 devices went silent
  after it". Child count changes do not send messages; the resolve message
  states how many children recovered.
- **Release:** when a parent resolves, still-open children lose their parent
  and send one normal `open` notification ("still offline after the incident").
- **Bridge outages:** the existing flood guard (bridge.offline,
  monitor.mqtt_lost) still blocks device-level opens entirely.

## Health score

- Network: 100 − 25 × Critical − 8 × Warning − 1 × Info over unresolved issues
  that have no parent; floor 0. Green ≥ 85 and no Critical; amber ≥ 60 or any
  Warning; red < 60 or any Critical.
- Device: same formula over the device's own unresolved issues (children
  included).
- The hourly job stores the network score in `health_scores`.

## Weekly digest

- Sent once per ISO week at the first engine run after Sunday 18:00 in `TZ`
  (catches up if MeshPulse was down then), as an outbox `digest` message to
  every enabled channel with `weeklyDigest` on; dedupe key
  `weekly:<ISO week>:<channelId>`. Quiet hours apply like any Info message.
- Contents: score now vs. 7 days ago and the week's lowest; open issues by
  severity; batteries to buy (Low now + forecast ≤ 30 days); 5 weakest links
  (lowest 24 h LQI average); 5 most-churning devices (announces + address
  changes in 7 days); devices with route failures in 7 days.

## UI

- **Overview:** health score next to the banner; open issues as parents with
  children collapsed in `<details>` (works without JS); 24 h network
  messages-per-minute sparkline (from hourly `msg_count`).
- **Devices:** sortable Score column.
- **Device page:** "Chatty" toggle next to "Ignore this device".
- **Issue page:** parents list their children with links; children link to
  their parent.
- **Events page** `/events`: 90 days, newest first, filter by kind and device,
  100 per page, readable detail (`formatDetail`). In the menu.
- **Settings:** new thresholds; "Weekly digest" checkbox per channel.

## Traffic replayer

`npm run replay <capture.jsonl>` feeds a capture through the real router,
rules and lifecycle on a simulated clock (offline, no broker, no DB writes
beyond an in-memory DB) and prints the issues that would open (rule, device,
severity, time) and the notifications that would be sent, grouped by rule.

Acceptance gate for every rule milestone: replay the user's real 24 h capture
(`/mnt/user/appdata/meshpulse-capture/z2m-20261018-1010.jsonl`, copied
locally); a normal day must produce no Critical, and every notification in the
report is listed in the PR for review.

## Testing

- Rules: fire, hold, stop; restart-grace and thin-baseline guards; multi-run
  "no reopen loop" tests for every rule with hysteresis.
- Grouping: children silent while the parent is open; released children
  notify exactly once; score counts parents only.
- Digest: fake clock around Sunday 18:00 Oslo (incl. DST), catch-up after
  downtime, once per week, per-channel checkbox.
- Pure view functions for score, issue tree and events filters; screenshots
  with live device names checked by the controller.

## Milestones

1. Brainstorm and plan
2. Traffic replayer + 24 h parser re-check
3. Data: minute counters, `health_samples`, health-delta events, `chatty` tag
4. Churn rules, interview failed, MQTT backlog
5. Storm rules (`msg_per_min` baselines) and the Chatty toggle
6. Battery causing issues (escalation) and battery stale
7. Grouping: mass offline, router impact, storm parent
8. Health score (network, per device, history)
9. Weekly digest
10. Events page
11. Deploy to Unraid and update docs

## Risks

- **Timing-based router grouping** can attach an unrelated sensor that
  happened to go quiet; it only affects grouping, never severity.
- **Restart storms**: a Z2M restart makes every device announce and report;
  churn and storm rules rely on the restart grace and must be replay-tested
  with a capture that contains a restart.
- **`battery.causing_issues`** is the one new path to a Critical; with seven
  devices already ≤ 25%, it is the most likely Phase 3 alert in week one.
