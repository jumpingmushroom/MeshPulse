# Changelog

## 0.5.0

- New notification channel: Home Assistant, to phones through `notify` services.
- Fewer notifications:
  - Warnings are sent only once they have been open 30 minutes, so short blips stay silent. Criticals still go out at once. Settings → Thresholds → Notification delay.
  - One "Still open" summary a day (default 09:00) replaces per-issue reminders. Settings → Quiet hours.
  - A power cut that Zigbee2MQTT reports one lamp at a time is now one outage, not an issue per lamp.
  - Message storms are judged against each device's own busiest minute, so a busy presence sensor is not a storm. Firmware (OTA) updates no longer count as storms.
- Health score: based on the share of devices with an issue, so a dozen warnings on a large mesh no longer scores 0. Acknowledged issues no longer count against it.
- Clearer rejoin messages: they always lead with the 24-hour count that sets the severity.
- Fixes: an invalid `TZ` no longer stops the checks; failed notifications are cleaned up after 7 days; sign-in only through the rate-limited login page; the battery picker on a device page keeps its value; Copy works on plain http.

## 0.4.3

- MeshPulse's own icon in the browser tab.
- Batteries: devices that are low right now are highlighted; a battery type typed as "cr2032" counts as CR2032.
- Settings thresholds read better on a phone.

## 0.4.2

- Settings → Thresholds: one line per alert, collapsible groups showing how many values you changed, and a reset link on each changed value. Rarely used values sit under "More settings".

## 0.4.1

- The "Turn off this rule" button on an issue no longer overflows its box.

## 0.4.0

- First release as a Home Assistant add-on: sidebar via Ingress, MQTT from the Mosquitto add-on or options, no separate login.
