# Zigbee2MQTT 2.x route/delivery error log formats (Z-Stack)

Goal: count route/delivery failures per device from `zigbee2mqtt/bridge/logging` (`{"level","message","namespace"}`).
Sources read: Zigbee2MQTT tag `2.14.2` (`lib/...`) and zigbee-herdsman `master` (cf29e23, 2026-10-18). Z2M 2.14.2 pins a specific herdsman version that was NOT checked; message text is stable in the tests cited but verify against the pinned version.
Base URLs: Z2M `https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/`, ZH `https://github.com/Koenkk/zigbee-herdsman/blob/master/`.

## Key findings

- The Z-Stack adapter only throws `Data request failed with error: '<NAME>' (0x<hex>)`. It logs nothing at info/warning/error itself; its failure logs (`Data confirm error (...)`, retries, `discoverRoute`) are all `debug`. The user-visible lines come from Z2M (`z2m`), which wraps the thrown error.
- Status codes are HEX with `0x` prefix, lower case (`0xe9`), not decimal. MAC_NO_ACK=0xe9, MAC_TRANSACTION_EXPIRED=0xf0, NWK_NO_ROUTE=0xcd, NWK_NO_ACK=0xcc, MAC_CHANNEL_ACCESS_FAILURE=0xe1, BUFFER_FULL=0x11, MAC_NO_RESOURCES=0x1a, APS_NO_ACK=0xb7 ([constants/common.ts](https://github.com/Koenkk/zigbee-herdsman/blob/master/src/adapter/z-stack/constants/common.ts)).
- Timeout of the data confirm itself renders as `Data request failed with error: 'TIMEOUT' (0x270f)` (code 9999 internal, [zStackAdapter.ts L31-38](https://github.com/Koenkk/zigbee-herdsman/blob/master/src/adapter/z-stack/adapter/zStackAdapter.ts)). Derived from code, not seen in a real log.
- herdsman retries internally (up to 4 data-request attempts for NWK_NO_ROUTE, MAC_NO_ACK, MAC_TRANSACTION_EXPIRED, etc.) with only debug logging in between. Only the FINAL failure surfaces, so one user command = one error line (no triple counting at info+). `Failed to ping` is the exception: it is logged per attempt (attempts 1/2, 2/2).
- `ROUTE_ERROR_SOURCE_ROUTE_FAILURE` and `Delivery failed for '<nwk>'.` are EmberZNet (EZSP) strings, not Z-Stack. They never appear for a CC2652P/zStack coordinator. (Real `Delivery failed` lines exist in [issue 31771](https://github.com/Koenkk/zigbee2mqtt/issues/31771), an Ember user; nwk shown in DECIMAL there.)
- `No network route` (old text, [issue 4701](https://github.com/Koenkk/zigbee2mqtt/issues/4701), 2020) is the pre-2.x wording; in 2.x it is `'NWK_NO_ROUTE' (0xcd)`.

## Device identification

The ZCL wrapper text always embeds the IEEE: `ZCL command <ieee>/<endpointId> <cluster>.<command>(...)`. So the IEEE can be regex-extracted from the message directly, with no friendly-name lookup. Friendly name appears separately in `Publish ...to '<name>'` and `Failed to ping '<name>'` (falls back to the IEEE if unnamed, see issue 33289). The 16-bit nwk is only present in the `Timeout after ... [address=<decimal nwk> ...]` suffix.

## Patterns

All `z2m` namespace lines below are emitted with the default namespace `z2m`. `E` below = the embedded error text `ZCL command 0x<ieee16hex>/<ep> <cluster>.<cmd>(<json>, <json>) failed (<REASON>)`.

| # | Template (bridge/logging `message`) | level / ns | Device id | Status code | Count? | Source |
|---|---|---|---|---|---|---|
| 1 | `Publish '<set\|get>' '<key>' to '<friendlyName>' failed: 'Error: ZCL command <ieee>/<ep> <cluster>.<cmd>(...) failed (Data request failed with error: '<NAME>' (0x<hex>))'` | error / `z2m` | friendly name (or ieee if unnamed) AND ieee inside | yes, hex | YES (one per failed user command; final result after herdsman retries) | [publish.ts L283](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/publish.ts) |
| 2 | `Failed to ping '<friendlyName>' (attempt <i>/<n>, ZCL command <ieee>/<ep> genBasic.read(["zclVersion"], {...}) failed (Data request failed with error: '<NAME>' (0x<hex>)))` | warning / `z2m` | friendly name + ieee inside | yes, hex | YES, but one line per attempt (n=2 typically): dedupe per device per ping cycle, or count only the last attempt. Only with availability enabled | [availability.ts L169](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/availability.ts) |
| 3 | same as 1/2 but reason is `Timeout after <ms>ms [address=<nwkDecimal> endpoint=<ep> clusterId=<id> cmdId=<id> tsn=<n>]` (no Z-Stack status; data confirm succeeded but no response arrived) | error (Publish) / warning (ping) | friendly name + ieee; nwk DECIMAL in suffix | none | YES, as "no response" (device unreachable or sleeping). Weaker signal than MAC_NO_ACK; classify separately | [adapter.ts L123](https://github.com/Koenkk/zigbee-herdsman/blob/master/src/adapter/adapter.ts); real: [33259](https://github.com/Koenkk/zigbee2mqtt/issues/33259) |
| 4 | `Failed to read state of '<friendlyName>' after reconnect (<E>)` | error / `z2m` | friendly name + ieee inside | yes if Data request | YES (secondary effect of availability) | [availability.ts L348](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/availability.ts) |
| 5 | `Failed to poll <attrs> from <friendlyName> (<E>)` | error / `z2m` | friendly name + ieee inside | as above | YES (bind/reporting poll) | [bind.ts L648](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/bind.ts) |
| 6 | `Failed to setup reporting for '<entity>' cluster '<c>' (<msg>)` / `Failed to disable reporting ...` | warning / `z2m` | entity name | as above | maybe (only if `<msg>` has a Data request status); low volume | [bind.ts L515](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/bind.ts) |
| 7 | `Failed to execute LQI for '<name>'` / `Failed to execute routing table for '<name>'` | error / `z2m` | friendly name | none | NO (network map scan, user-triggered; no reason text) | [networkMap.ts L221](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/networkMap.ts) |
| 8 | `Failed to query '<ieee>' on device announce (Error: <E>)` | ns `zhc:tuya` (also other zhc:* handlers), level error/warning (level not verified) | ieee quoted + inside | as above | YES-ish; device just announced so it is mostly benign noise (verify) | real: [33349](https://github.com/Koenkk/zigbee2mqtt/issues/33349) |
| 9 | `Read response to <ieee> failed (<msg>)`, `Handling of IAS zone enroll for <ieee> failed (...)`, `Handling of poll check-in from <ieee> failed (...)`, `Failed to stop fast poll for <ieee> (...)` | error / `zh:controller:device` | ieee (no 0x-less form: as stored, `0x...`) | if Data request | YES but these are replies to device-initiated traffic; MAC_NO_ACK here means the coordinator cannot reach the device. Include, tag separately | [device.ts L450-543](https://github.com/Koenkk/zigbee-herdsman/blob/master/src/controller/model/device.ts) |
| 10 | `Interview failed for '<ieee> with error '<err>'` | error / `zh:controller` | ieee | maybe | NO for routing health (pairing event) | [controller.ts L899](https://github.com/Koenkk/zigbee-herdsman/blob/master/src/controller/controller.ts) |
| 11 | `Failed to interview '<name>', device has not successfully been paired` | error / `z2m` | name | none | NO | [zigbee.ts L209](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/zigbee.ts) |
| 12 | `No converter available for '<type>' '<key>' (<value>)` | error / `z2m` | none | none | NO (user/automation error) | publish.ts |

Debug-only (NOT delivered to bridge/logging by default; do not rely on): `zh:controller:endpoint: Error: ZCL command ... failed (...)` ([evidence from a debug log, issue 31995](https://github.com/Koenkk/zigbee2mqtt/issues/31995)), `zh:zstack: Data confirm error (<ieee>:<nwk>,<code>,<attempt>)` (decimal code, once per retry), `sendZclFrameToEndpointInternal ...`.

Not applicable to Z-Stack: `Delivery failed for '<nwk>'.` (Ember), `ROUTE_ERROR_SOURCE_ROUTE_FAILURE` (Ember enum), `ZIGBEE_SOURCE_ROUTE_FAILURE`.

### Suggested regexes (JS)

```
// IEEE: present in every ZCL wrapper line
/ZCL command (0x[0-9a-f]{16})\/(\d+) /
// Z-Stack status
/Data request failed with error: '([A-Z_]+)' \(0x([0-9a-f]+)\)/
// timeout
/failed \(Timeout after (\d+)ms(?: \[address=(\d+) endpoint=(\d+)[^\]]*\])?\)/
// publish failure (friendly name)
/^Publish '(set|get)' '([^']+)' to '(.+)' failed: /
// ping failure (attempt n of m)
/^Failed to ping '(.+)' \(attempt (\d+)\/(\d+), /
```
Friendly names can contain `'`, so prefer the IEEE regex for identity and use the name only for display.

Suggested count set (route/delivery = yes): MAC_NO_ACK, MAC_TRANSACTION_EXPIRED, NWK_NO_ROUTE, NWK_NO_ACK, APS_NO_ACK, TIMEOUT (data confirm). Probably congestion rather than device problem (track separately or ignore): MAC_CHANNEL_ACCESS_FAILURE, BUFFER_FULL, MAC_NO_RESOURCES (herdsman itself treats them as coordinator-load errors, retried after 2 s). MAC_TRANSACTION_EXPIRED typically means a sleepy end device was not polling (zStackAdapter comment "Mac layer is sleeping"), so expect it on battery devices without being a mesh problem.

## Example lines

Real (issue 33289, zStack/2.x; log timestamp prefix is from the file log, bridge/logging has no prefix):
`Publish 'set' 'state' to '0xa4c1381504f7ffff' failed: 'Error: ZCL command 0xa4c1381504f7ffff/1 genOnOff.on({}, {"timeout":10000,"disableResponse":false,"disableRecovery":false,"disableDefaultResponse":false,"direction":0,"reservedBits":0,"writeUndiv":false}) failed (Data request failed with error: 'MAC_TRANSACTION_EXPIRED' (0xf0))'` - https://github.com/Koenkk/zigbee2mqtt/issues/33289

Real (issue 33259): `Publish 'set' 'identify' to 'Window Slaapkamer 2' failed: 'Error: ZCL command 0x00158d000202bb70/1 genIdentify.identify({"identifytime":3}, {...}) failed (Timeout after 10000ms [address=40756 endpoint=1 clusterId=3 cmdId=11 tsn=29])'` - https://github.com/Koenkk/zigbee2mqtt/issues/33259

Real, Ember (shows ping format): `Failed to ping 'Office desk right' (attempt 1/2, ZCL command 0x001788010c65c66c/11 genBasic.read(["zclVersion"], {...}) failed (Delivery failed for '61969'.))` - https://github.com/Koenkk/zigbee2mqtt/issues/31771
On zStack the reason part would be `Data request failed with error: 'MAC_NO_ACK' (0xe9)` (inferred; the exact string is asserted in herdsman [adapter.test.ts](https://github.com/Koenkk/zigbee-herdsman/blob/master/test/adapter/z-stack/adapter.test.ts): `Data request failed with error: 'MAC_NO_ACK' (0xe9)`).

Real debug (not on MQTT by default): `zh:controller:endpoint: Error: ZCL command 0x18fc260000096142/1 genPollCtrl.fastPollStop({}, {...}) failed (Data request failed with error: 'MAC_NO_ACK' (0xe9))` - https://github.com/Koenkk/zigbee2mqtt/issues/31995

Group casts: `NWK_NO_ROUTE (0xcd)` on groupcast ([issue 32885](https://github.com/Koenkk/zigbee2mqtt/issues/32885), CC2674P10 firmware problem): there is no single device; the target is the group name in `Publish ... to '<group>'` and the ZCL line shows a group/broadcast address. Do not attribute to a device.

## bridge/logging publishing rules (answers)

- Mechanism: `Bridge.start()` adds a winston transport to the Z2M logger that publishes `{message, level, namespace}` to `bridge/logging` ([bridge.ts L62-96](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/extension/bridge.ts)). It is independent of `advanced.log_output`: that setting only toggles the console/file/syslog winston transports ([logger.ts L51-112](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/util/logger.ts)). `log_output: []` still feeds MQTT (inferred from the code; not tested).
- The transport only sees lines that pass `Logger.log()`: `level <= namespacedLevel(namespace)` ([logger.ts L196-203](https://github.com/Koenkk/zigbee2mqtt/blob/2.14.2/lib/util/logger.ts)). So the filtering is shared with console/file; there is NO separate MQTT log level.
- Level order: error < warning < info < debug. Namespace level falls back from the longest prefix (`zh:controller:endpoint` -> `zh:controller` -> `zh` -> default) to `advanced.log_level`, overridable with `advanced.log_namespaced_levels` (keys like `z2m`, `zh:zstack`).
- Debug lines are dropped from MQTT unless `advanced.log_debug_to_mqtt_frontend: true` (default false, requires restart); the non-debug transport has `if (info.level !== "debug")`.
- Consequence: at `log_level: info` (default), warning and error lines from every namespace are always published (they rank above info), unless the user sets `log_namespaced_levels` lower for that namespace (e.g. `z2m: error` would hide the `Failed to ping` warnings). Pitfall: setting a namespace to a level below `error` is not possible, but `log_level: error` hides warnings (ping failures).
- Consecutive identical payloads are suppressed (`lastBridgeLoggingPayload`), so two identical lines in a row (same message, level, namespace) are published once. Repeated failures with identical text (e.g. the same Timeout message with identical tsn) are rare, but identical `Failed to ping ... attempt 1/2` text for the same device is not repeated back-to-back. Undercount risk is low but real.
- `bridge/logging` messages are published non-retained with `skipLog` (do not appear in the log itself).
- Namespace is the string passed by the logger call: `z2m` by default, `zh:controller:device`, `zh:zstack`, `zhc:tuya`, etc. Z2M writes it as the `namespace` JSON field; the `message` has no namespace prefix.

## Open questions

1. Z2M 2.14.2's pinned zigbee-herdsman version not checked against master; confirm message strings via `package.json` of the tag.
2. No real pasted zStack `Failed to ping ... 'MAC_NO_ACK' (0xe9)` line found; only the template is derived from code plus a real Ember ping line.
3. Level of `zhc:*` "Failed to query ... on device announce" lines (error vs warning) unverified.
4. Whether `MAC_TRANSACTION_EXPIRED` on sleepy end devices should count: consider counting only for routers/mains devices (via device type from bridge/devices).
5. Group publishes failing: how Z2M names a group target in the ZCL wrapper line (group ID vs ieee) not verified.
6. Whether Z2M exits with the same format in older 1.x (not needed; the user runs 2.14.2).
7. Live validation: replay the user's `npm run capture` JSONL for `bridge/logging` and grep for the regexes above; no failure lines were available to me.
