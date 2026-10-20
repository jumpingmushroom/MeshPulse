# MeshPulse

MeshPulse watches the MQTT traffic of Zigbee2MQTT and tells you when your Zigbee network has problems. It only listens. It never changes your network unless you switch on an optional active feature.

## Install

1. In Home Assistant, go to **Settings > Add-ons > Add-on Store**.
2. Open the menu (three dots, top right), choose **Repositories**, and add `https://github.com/jumpingmushroom/MeshPulse`.
3. Find **MeshPulse** in the store, then install and start it.
4. Open **MeshPulse** from the sidebar. Home Assistant's login protects it, and there is no separate MeshPulse login or account.

## MQTT

With the Mosquitto broker add-on installed, MeshPulse finds the broker on its own. You don't need to set anything.

For an external broker, set these options:

- `mqtt_url`: for example `mqtt://192.168.1.10:1883` or `mqtts://broker.example.com:8883`
- `mqtt_username` and `mqtt_password`: only if the broker needs a login. They apply only when `mqtt_url` is set.

## Options

- `z2m_base_topic`: the base topic of Zigbee2MQTT. Default `zigbee2mqtt`. Change it only if you changed `base_topic` in Zigbee2MQTT.

Restart the add-on after you change an option.

## Zigbee2MQTT settings

MeshPulse needs these in the Zigbee2MQTT configuration. The Overview page shows which ones are missing.

```yaml
availability:
  enabled: true
health:
  interval: 10
  reset_on_check: false
advanced:
  log_output: [console, file, mqtt]
  log_level: info
```

On Zigbee2MQTT 2.x the `log_output` line isn't needed, because it always publishes its log over MQTT.

## Data and backups

MeshPulse keeps its database in the add-on's own storage. Home Assistant backups include it, so a restore brings back your history and settings.

MeshPulse stops briefly during Home Assistant backups, so the database is copied in a consistent state.

## Updating

Update from the add-on page when a new version shows. Your data stays.

## Notifications on your phone

In MeshPulse, open **Settings → Notifications → Home Assistant**, select **Load notify services**, pick your phone and save. No URL or token is needed in the add-on. Critical issues arrive at high priority, and a resolved issue replaces its notification.
