# MeshPulse Wi-Fi correlation (UniFi) — design

Oct 19, 2026 · The first "Later idea" of `docs/SPEC.md`: correlate 2.4 GHz Wi-Fi
from the user's UDM Pro with Zigbee trouble. Builds on Phases 1–4. Where this
document and earlier designs differ, this document wins.

## Goal

Know when Wi-Fi may be the reason the mesh struggles, and what to change: flag
2.4 GHz access points whose channel overlaps the Zigbee channel, keep their
airtime history, and attach the Wi-Fi state of the device's area to Zigbee issues.
Read-only towards UniFi; MeshPulse never changes Wi-Fi settings.

Success: on the real network the two APs on Wi-Fi channel 1 (basement, shed)
raise an overlap Warning on the first poll; Zigbee issues in an area with an
overlapping AP show its channel and airtime; no false Critical and no extra
notifications beyond the overlap Warnings.

## Context (probe, Oct 19)

UniFi Network 10.6.106 on a UDM Pro. A local View Only user can log in
(`POST /api/auth/login`) and read `GET /proxy/network/api/s/default/stat/device`.
Per access point it returns `radio_table` (radio `ng`/`na`, channel, `ht` width)
and `radio_table_stats` (`channel`, `cu_total`, `cu_self_rx`, `cu_self_tx`,
`satisfaction`, `tx_retries`, `num_sta`, `tx_power`). Six APs; 2.4 GHz channels
6, 1, 6, 11, 1, 11; busiest 42 % (garage, channel 6). Zigbee channel 11
(2405 MHz). AP names carry area prefixes (`bas`, `shd`, `gar`, `lnd`, `lvr`, `dtc`).

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| Q19 | Access | A local View Only UniFi user (legacy local API); probe first. |
| Q20 | Scope | Overlap + live airtime + area matching of APs to Zigbee devices. |
| Q21 | Credentials | In Settings, password encrypted with `SECRET_KEY`, write-only, with Test connection. |
| — | Requests | Only `POST /api/auth/login` and `GET …/stat/device` (plus logout on shutdown); self-signed certificate accepted for this URL only. |
| — | Polling | Every 5 min; off by default. |

## Out of scope

Changing any UniFi setting, 5 GHz/6 GHz analysis, client-level data, the official
Integrations API, multiple UniFi sites (site `default` only), other vendors.

## Connection and polling

- Settings section "Wi-Fi (UniFi)": Enabled (default off), controller URL, user,
  password (encrypted, write-only, like the Discord webhook), Test connection
  ("N access points found" or the error), busy threshold (default 60 %), clear
  threshold (default 40 %), and the area mapping table.
- Poll every 5 min: log in (reuse the session cookie and CSRF token until a 401),
  read `stat/device`, keep devices with `type: "uap"` and their `ng` radio.
  Request timeout 15 s. TLS verification is disabled only for this host.
- Three consecutive failed polls → Info issue `wifi.unreachable` (summary with
  the error), resolved by the next successful poll.

## Data

Migration:

- `wifi_aps`: mac (PK), name, model, area (nullable; null = whole network),
  area_confirmed (bool), last_seen.
- `wifi_samples`: ts, mac, channel, width (MHz), cu_total, cu_self_rx, cu_self_tx,
  num_sta, tx_power — one row per AP per poll for the 2.4 GHz radio. Kept 30 days.
- Event kind `wifi_channel` (ieee null, detail `{ ap, from, to, fromWidth, toWidth }`)
  when an AP's 2.4 GHz channel or width changes between polls.

Pure functions (`src/lib/server/wifi/`):

- `zigbeeMHz(c) = 2405 + 5 (c − 11)`; `wifiMHz(n) = 2407 + 5 n` (n 1–13; 14 = 2484).
- `overlaps(zigbeeChannel, wifiChannel, widthMHz)`: |Δ| < width/2 + 1.
- `suggestArea(prefix, areas)`: the area whose name contains the prefix's letters
  in order (case-insensitive), shortest match first; null if none. Areas are the
  distinct leading room words of device names (longest common room prefix among
  device names, e.g. "Living room", "Basement", "Shed").
- `parseDevices(json)`: the AP list above; throws on an unexpected shape.

Zigbee channel comes from `bridge/info` (`network.channel`).

## Rules

- `wifi.channel_overlap` (Warning, per AP mac, `minRuns: 1`, notified): AP's
  2.4 GHz channel overlaps the Zigbee channel. Summary "<AP> uses Wi-Fi channel
  N, which overlaps Zigbee channel C"; action "Move the AP's 2.4 GHz radio to
  channel X in UniFi" where X are the non-overlapping channels among 1/6/11;
  evidence: area, Zigbee devices in that area. Resolves when a poll shows no
  overlap.
- `wifi.busy_air` (Info, per AP, not notified): `cu_total` ≥ busy threshold for
  15 min on an AP that overlaps Zigbee; clears below the clear threshold for 30 min.
- `wifi.unreachable` (Info, network-level, not notified) as above.
- Guards: with Wi-Fi off, the rules return nothing (issues resolve). With no
  successful poll for 30 min, overlap and busy hold their state (no resolve on
  missing data).

## Correlation

When one of `lqi.weak`, `lqi.degrading`, `route.failures`, `device.offline`,
`device.flapping`, `network.route_errors`, `network.mass_offline` opens, its
evidence gains `wifi`: for device issues the APs in the device's area, for
network issues all APs; per AP channel, overlap, `cu_total` now and max over the
last hour, channel change in the last 24 h. Only polls from the last 15 min
count; otherwise `wifi: "unavailable"`. If an overlapping AP was ≥ busy threshold
or changed channel in the last hour, the issue summary for the notification and
issue page gains: "Wi-Fi may be involved: <AP> on channel N (overlaps Zigbee C)
was P % busy" (or "changed channel at HH:MM"). Severity never changes.

## UI

- `/wifi` (linked from the Overview tile and Settings; not in the top menu):
  header with Zigbee channel and frequency; band diagram (2.4 GHz, each AP's
  channel as a bar of its width, Zigbee channel as a marker); table per AP: name,
  model, area, channel/width with "Overlaps Zigbee" tag, `cu_total` now with a
  24 h sparkline, own share (self rx + tx), clients, last channel change, Zigbee
  devices in its area (link to Devices filtered by `?q=<area>`).
- Overview tile "Wi-Fi 2.4 GHz": "N APs overlap Zigbee channel C" or "No overlap";
  hidden when Wi-Fi is off.
- Device page: "Nearby Wi-Fi: <AP> · channel N (overlaps) · P % busy" when the
  device's area has an AP.
- Settings section as above, with the mapping table (AP, suggested area, select
  incl. "Whole network"); saving confirms the mapping.

## Testing

- Overlap for Zigbee 11–26 × Wi-Fi 1–13 × 20/40 MHz; the real case 11 vs 1/6/11.
- `suggestArea` on the real AP prefixes and device names (bas→Basement,
  shd→Shed, gar→Garage, lnd→Laundry, lvr→Living room, dtc→Datacenter).
- `parseDevices` on a fixture captured from the real controller (read-only).
- Rules: fire, hold on stale data, resolve, off → resolve.
- Correlation evidence builder: device vs network issue, stale data, busy line.
- Poller with a fake fetch: session reuse, 401 → re-login, timeout, 3 failures.
- Screenshots of `/wifi`, the tile, Settings on live data.

## Milestones

1. Brainstorm and plan
2. UniFi client, poller, storage, Settings connection + Test
3. Overlap, area matching, rules
4. Correlation evidence
5. `/wifi`, Overview tile, device page line
6. Docs, deploy, switch on with the user's account, check the first overlap Warnings

## Risks

- Unofficial API: field names may change with UniFi updates → parser on a real
  fixture; parse errors fail the poll visibly (`wifi.unreachable`).
- Admin credentials: View Only, local-only, encrypted, write-only; only login and
  one read are ever sent.
- Area matching is heuristic → user confirms once; unmatched → whole network.
- Correlation ≠ causation → "may be involved", never "caused by".
