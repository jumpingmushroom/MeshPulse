# MeshPulse UI redesign — design

Oct 19, 2026 · Restyles every page after the user's Claude Design mockup
(`docs/superpowers/design/meshpulse-mockup.html`). Builds on the MVP, Phase 2
and Phase 3 designs; where this document and the mockup differ, this
document wins. Rules, lifecycle and the database schema do not change.

## Goal

MeshPulse looks and reads like the mockup, on live data, in dark and light,
with every Phase 1–3 feature still reachable.

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| Q10 | Network map, active features | Out. No map page, no "Network map" button, no "Active features" settings. MeshPulse stays read-only; the map is its own Phase 4 design. |
| Q11 | Battery cell type | Out. No Cell column, no shopping list. Last swap, days left and trend stay (data exists). |
| — | Approach | Port the mockup's MeshPulse stylesheet as-is to the global stylesheet; page markup uses its classes; repeated pieces become small Svelte components. |
| — | Theme | Follows the system (`prefers-color-scheme`), as the mockup does. No switch. |
| — | Tags | Only `ignore` and `chatty`. Chatty help: "Leaves this device out of the 'dominant' check." No `seasonal`. |
| — | Live values | Real Zigbee2MQTT version etc. replace the mockup's sample values. |

## Out of scope

Network map and active features (Q10), cell type and shopping list (Q11),
`seasonal` tag, a theme switch, any rule, lifecycle or schema change.

## Foundation

- **Stylesheet:** the mockup's second `<style>` block ("MeshPulse UI — tokens +
  components", ~700 lines, dark + derived light theme, self-contained) replaces
  `src/app.css`. Map-only rules (`.map`) are dropped. `@font-face` keeps only
  the Latin Inter subsets (weights 400/500/600), served from `static/fonts/`;
  no external font host.
- **Icons:** the mockup's SVG `<symbol>` sprite becomes `Icons.svelte`,
  rendered once in the layout; icons are `<svg><use href="#i-…"/></svg>`.
- **Top bar** (layout, signed in): brand, six links (Overview, Devices,
  Batteries, Issues, Events, Settings), Issues count badge coloured by the worst
  open severity, "Updated N s ago" and Sign out. Layout data adds open-issue
  count, worst severity, MQTT connected and last message time.
- **Stale:** when MQTT is lost, the top bar shows "Stale · last update HH:MM"
  and a strip under it: "MeshPulse lost its MQTT connection N min ago. Nothing
  on this page is live — data is frozen at HH:MM."
- **Refresh:** the existing 15 s `invalidateAll` stays; "Updated N s ago"
  counts from the last load (shows the load time without JS).
- **No-JS:** filters, sorting, tabs, paging, density are links / GET forms;
  collapsing is `<details>`. JS-only: the Copy button and the seconds counter.
- **Components** (`src/lib/components/`): `SevBadge`, `IssueRow` (summary,
  optional action line, device link, rule name, opened, state, collapsed
  children), `Tile`, `ScoreRing` (label only, no number), `Sparkline`,
  `KV` (evidence table), and `LineChart` restyled with min–max band, baseline,
  threshold lines and gaps for missing data.

## Pages

- **Overview:** banner (kicker Needs attention / Critical / All good, title,
  "Start with: <top issue's action>", score ring + label). While baselines are
  under 3 days: "Learning baselines · N h of 3 days" bar, ring "Learning".
  Prerequisite notice as the mockup's box with the YAML to add and Copy.
  Open issues: top-level `IssueRow`s with action line and collapsed children
  ("N grouped issues: …"). Tiles: Devices online (N offline · N unknown),
  Routers online, Batteries due in 30 days (soonest), Network messages per
  minute (now, 24 h sparkline, peak and quietest). Status line: bridge state,
  Z2M version, uptime, channel, coordinator, MQTT state, last update.
- **Issues:** intro line on acknowledging; tabs Open / Acknowledged / Resolved
  with counts; rule select and severity segment (All, Critical, Warning, Info);
  all URL parameters.
- **Issue:** back link; severity, state and rule badges; summary as title;
  opened / open for / resolved; suggested-action box; evidence as `KV` with
  readable labels (unknown keys as-is; device lists such as children and top
  senders as links); one rule-matched chart (battery rules: battery %; lqi
  rules: LQI; storm rules: msg/min; others none); parent/children links; side
  panel with Acknowledge, mute control for the device, "Open device page".
- **Devices:** title with counts (devices, routers, on battery); Compact /
  Comfortable (URL); search; chips Routers, Battery, Offline, Has issues with
  counts; sortable columns Name, Type, Availability, Last seen, LQI (now, 24 h
  avg, base, meter), Battery (% and V), Msg/h, Health, Issues; issue rows get a
  severity edge; ignored rows greyed; device cards below the mockup's
  breakpoint.
- **Device:** name; type, model, power and health badges; "Online · seen N
  ago"; open issues; History 24 h / 7 d / 30 d with LQI (avg, min–max, 7-day
  baseline, weak threshold, gaps), Battery and Voltage charts with low /
  critical lines; last 10 events with "Show all" → Events filtered by device;
  side panel: battery forecast (days to target, empty date, now, last swap from
  `battery_swap` events), mute, Ignore and Chatty toggles.
- **Batteries:** "Buy within 30 days" and "Later" tables: Days left, Empty
  around, Battery, Voltage, 30-day trend sparkline, Last swap; devices with no
  forecast last with "—".
- **Events:** title with count and 90-day retention; Kind select, device
  filter; Time, Kind (icon + label), Device, Detail (`formatDetail`); 100 per
  page.
- **Settings:** sub-menu (Thresholds, Quiet hours, Notifications, Heartbeat,
  Zigbee2MQTT, Failed notifications) with error counts. Threshold groups as in
  the mockup (Bridge, Availability, Battery, Link quality, Routes, Forecast and
  reminders) plus Phase 3 groups Churn, Storms, Mass offline, Battery
  escalation, MQTT backlog — every key in `DEFAULT_SETTINGS` stays editable,
  each field with unit and one help line. Mockup fields with no matching
  setting are left out. Failed save: "N settings need
  fixing. Nothing was saved" box, inline field errors, typed values kept.
  Discord / Apprise panels: configured state, Enabled, minimum severity,
  @here on Critical (Discord), write-only URL, Weekly digest, Save, Send test
  with inline result. Heartbeat URL and last ping; prerequisites checklist;
  failed notifications table.
- **Login:** the mockup's two-panel page; same form and action.

## Data

No schema change. Page loaders may add fields from existing tables: 24 h LQI
average and msg/h (`samples_hourly`), baselines, last `battery_swap` event,
layout counts. Retention is unchanged, so 30 d charts show what is kept.

## Testing

- Unit tests for new pure view helpers (banner text and kind, score label,
  "N grouped issues" summary, evidence labels, device-table sort and filter,
  learning progress).
- Existing route and server tests keep passing; `npm run check` and
  `npm run build` before every merge.
- Each milestone: screenshots of every changed page on live data, dark and
  light, compared with the mockup by the controller.

## Milestones

1. Foundation: stylesheet, fonts, icons, top bar, stale strip, shared components
2. Overview, Issues, Issue page
3. Devices and device page
4. Batteries and Events
5. Settings and login
6. Deploy to Unraid and update docs

## Risks

- The Devices table is 10 columns × 140 rows; relies on the mockup's sticky
  header and card fallback.
- The light theme is derived; checked by screenshot only.
