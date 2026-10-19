# MeshPulse

MeshPulse is a passive health monitor for Zigbee2MQTT. It watches the MQTT traffic of your Zigbee mesh, raises issues such as offline or silent devices, flapping devices, low batteries, an offline or restarting bridge, a lost MQTT connection and an open network, and notifies you on Discord and through Apprise. It never publishes to MQTT, so it can't change anything on your network.

![Overview with no open issues](docs/screenshots/overview-healthy.png)

![Overview with open issues](docs/screenshots/overview-amber.png)

## Device and Batteries pages

Select a device on the **Devices** page to open its page (`/devices/<ieee>`). It shows link quality, battery, voltage, and messages-per-hour charts over 24 hours, 7 days, or 30 days, plus the battery forecast, recent events, and a mute control. **Ignore this device** stops all rules for that device.

![Router device page, 7 days](docs/screenshots/device-router-7d.png)

![Battery device page, 30 days](docs/screenshots/device-battery-30d.png)

The **Batteries** page is a shopping list. It has two tables, **Buy within 30 days** and **Later**. Each row shows the forecast days left, the date the battery is expected to run out, the battery level, the voltage, a 30-day trend, and the last battery swap.

![Batteries page](docs/screenshots/batteries.png)

## Trend rules

These rules work from hourly rollups of link quality, battery, and message counts.

| Rule | Raises an issue when | Defaults |
| --- | --- | --- |
| Weak link (`lqi.weak`) | The 24-hour average link quality (LQI) is low. Never Critical. | Below 30 |
| Degrading link (`lqi.degrading`) | The 24-hour average is below the device's own 7-day baseline. | 25% below |
| Route failures (`route.failures`) | Commands to a device fail. Failed availability pings and commands sent while the device is offline don't count for a single device. | 5 in 24 hours: Warning; 20: Critical |
| Network route errors (`network.route_errors`) | Route errors across the network exceed the normal hourly rate. | More than 3 times normal and at least 10 per hour |
| Battery forecast (`battery.forecast`) | The battery is forecast to reach 10% soon. Shown in the interface only; it never notifies. | 21 days |

Needs history: the first rollup appears after the first full hour. Degrading link and network route errors start after 3 days of history, and the battery forecast needs 7 days since the last battery swap. You can change every threshold in the **Thresholds** section of **Settings**.

Tip: a device whose link is permanently weak sends a Warning reminder every 24 hours. To stop the reminders, acknowledge the issue or ignore the device.

## Correlation rules

Phase 3 rules work from live message counts and `bridge/health` data. Thresholds are in **Settings**; the defaults are in parentheses.

| Rule | Raises an issue when | Defaults |
| --- | --- | --- |
| Rejoin churn (`device.rejoin_churn`) | A device announces or changes network address repeatedly. Critical at 10 rejoins in 24 hours. | 3 announces or 2 address changes in 6 hours; clears after 12 quiet hours |
| Device left (`device.leave`) | A device leaves the network. Clears when the device sends a message again. | Warning |
| Network churn (`network.churn`) | Many different devices announce within a short time. | 5 devices in 15 minutes; clears after 1 quiet hour |
| Interview failed (`device.interview_failed`) | A device interview fails. Clears after a successful interview. | Warning |
| MQTT backlog (`bridge.mqtt_backlog`) | Zigbee2MQTT reports a long MQTT queue in two consecutive health samples. | Above 50 messages; clears below 10 |
| Device storm (`device.storm`) | A device sends far more messages than its own 7-day baseline. | 5 times normal and at least 20 per minute for 5 minutes; Critical above 60 per minute |
| Dominant device (`device.dominant`) | One device sends most of the network's messages. | More than 30% over 15 minutes and at least 60 messages; clears below 15% for 30 minutes |
| Network storm (`network.storm`) | Total traffic exceeds the network baseline. Critical; the evidence lists the top contributors. | 4 times normal for 5 minutes; clears below 2 times |
| Mass offline (`network.mass_offline`) | Many devices go offline together. Critical. | 20% of routers (at least 3) or 10 devices within 5 minutes |
| Battery causing issues | A `battery.low` issue becomes Critical with "Replace battery" wording when the device also shows instability. | Battery at or below 35%, or the device reports `battery_low`, or a coin cell is at or below the low-voltage setting, and instability in the last 48 hours |
| Stale battery (`battery.stale`) | A daily-reporting battery device has sent no battery value for a while. Shown in the interface only; it never notifies. | 7 days |

The storm rules need 3 days of history for a baseline. The rules that depend on announces, leaves, or message rates don't run during the grace period (15 minutes by default) after a MeshPulse or Zigbee2MQTT restart.

If a device is expected to send many messages, such as an mmWave presence sensor, open its page and turn on **Chatty device**. A chatty device is never reported as a dominant device.

### Whole-network outages

If no device sends a message for **Bridge silence** (5 minutes by default) while Zigbee2MQTT is running, MeshPulse raises "Zigbee network silent". This usually means a stuck coordinator radio. Mass offline and the silent network each raise one Critical issue per outage. While the network is dark, after a real silence, and after a Zigbee2MQTT restart, MeshPulse holds the per-device warnings that the outage would otherwise cause.

### Grouping

Mass offline, a network storm, and a Router going offline are parent incidents. Device issues caused by the same incident attach to the parent as children and stay silent while the parent is open:

- Mass offline takes offline and flapping device issues.
- A network storm takes device storm and dominant device issues.
- A Router that goes offline takes end devices that go silent within 10 minutes after it.

When the parent resolves, MeshPulse sends one message for each child that is still broken. On **Overview**, children are folded under their parent.

## Health score

The network score is 100, minus 25 for each Critical issue, 8 for each Warning, and 1 for each Info, with a minimum of 0. Only top-level issues count, so an incident and its children cost one deduction. The score is green at 85 or higher with no Critical or Warning, red below 60 or with any Critical, and amber otherwise. The score ring on **Overview** shows only the label (Good, Fair or Poor), not the number. For the first 3 days it shows Learning, with a progress bar. Each device has its own score from its own open issues, shown in the sortable **Health** column on **Devices**. **Overview** also shows a sparkline of network messages per minute over the last 24 hours.

## Weekly digest

On Sunday at 18:00 in `TZ`, MeshPulse sends a summary to each channel that has **Weekly digest** selected: the score now, a week ago, and at its lowest; open issues; batteries to buy; the weakest links; the most-churning devices; and devices with route failures. It's on by default for Discord and off for Apprise. A new install sends its first digest the following Sunday.

## Events page

**Events** lists the last 90 days of events, newest first. You can filter by kind and by device. The page shows 100 events at a time.

## Requirements

- Zigbee2MQTT 2.x publishing to an MQTT broker.
- An MQTT user with **subscribe** access to `zigbee2mqtt/#`. Read-only is enough.
- Docker with Compose.

## Configure Zigbee2MQTT

Add these settings to Zigbee2MQTT's `configuration.yaml` and restart it. MeshPulse shows a warning banner for any that are missing.

```yaml
availability:
  enabled: true
health:
  interval: 10
  reset_on_check: false
advanced:
  log_level: info
```

Zigbee2MQTT 2.x always publishes its log on `bridge/logging`, so no `log_output` change is needed. On Zigbee2MQTT 1.x, add `mqtt` to `advanced.log_output`. The route-failure rules read this log.

If you run the Home Assistant add-on, these settings go in Zigbee2MQTT's own `configuration.yaml` (or its web UI under **Settings**), not on the add-on's Configuration tab, which only accepts the add-on's own options.

## Set up

1. Copy the example environment file and edit it:

   ```sh
   cp .env.example .env
   openssl rand -base64 32   # paste into SECRET_KEY
   ```

   Set at least `MQTT_URL`, `SECRET_KEY`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

2. Start the container:

   ```sh
   docker compose up -d --build
   ```

3. Open `http://<host>:3000` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. The account is created on first start. Sign-up is disabled.

The database lives in the named Docker volume `meshpulse-data`, which Docker lists as `<project>_meshpulse-data` (for example `meshpulse_meshpulse-data`). SQLite runs in WAL mode, so recent writes may sit in `meshpulse.db-wal` until the app stops. To back up, stop the container first, copy the database, then start it again:

```sh
docker compose stop meshpulse
docker compose cp meshpulse:/data/meshpulse.db ./backup.db
docker compose start meshpulse
```

The container reports `healthy` about 60 to 90 seconds after start, once the first rules run.

## Deploy with Dokploy

1. Create a Compose application from this repository. Dokploy builds the image from the `Dockerfile`.
2. Add the variables from `.env.example` in the environment tab.
3. The named volume `meshpulse-data` (declared in `docker-compose.yml`) keeps the database across redeploys. Do not remove it.
4. Add a domain and set `PUBLIC_URL` to the exact URL you open, for example `https://meshpulse.example.com`. Use `https` there so session cookies are marked Secure, and always open MeshPulse through that URL. Opening `http://host:3000` instead makes login fail silently, because the browser drops the Secure cookie.
5. Behind the proxy, set `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH=1`. Otherwise the login rate limiter sees every user as the proxy's IP. The image already sets `PROTOCOL_HEADER=x-forwarded-proto`; add `HOST_HEADER=x-forwarded-host` if the proxy rewrites the host.

## Deploy on Unraid

1. Build the image on the server (there is no published image yet; the repo is private, so clone with a GitHub token or copy the source over):

   ```sh
   git clone https://github.com/jumpingmushroom/MeshPulse /tmp/meshpulse
   docker build -t meshpulse:latest /tmp/meshpulse
   ```

1. Copy the template and generate a secret key:

   ```sh
   T=/boot/config/plugins/dockerMan/templates-user/my-MeshPulse.xml
   cp /tmp/meshpulse/unraid/meshpulse.xml "$T"
   sed -i "s#\(Target=\"SECRET_KEY\"[^>]*\)/>#\1>$(openssl rand -base64 32)</Config>#" "$T"
   ```

1. In **Docker > Add Container**, select **MeshPulse**, fill in the MQTT URL, broker user and admin login, and click **Apply**.

The container stores its database in `/mnt/user/appdata/meshpulse`. It starts as root only to take ownership of that folder, then runs as `PUID:PGID` (default `99:100`). To update, rebuild the image and restart the container.

## Discord notifications

1. In Discord, open the channel's **Edit Channel > Integrations > Webhooks** and create a webhook. Copy its URL.
2. In MeshPulse, open **Settings**, paste the URL, select **Save channel**, then select **Send test**. **Send test** is disabled until the channel is saved.

## Apprise notifications

Apprise delivers to services such as ntfy, Telegram, Pushover, and email through an [apprise-api](https://github.com/caronc/apprise-api) server that you run.

1. In MeshPulse, open **Settings** and go to **Apprise**.
2. Enter the apprise-api URL.
3. Enter either a stored configuration key or one or more Apprise URLs. MeshPulse encrypts the URLs and doesn't show them again.
4. Select the minimum severity to send.
5. Select **Save channel**, then select **Send test**.

## Heartbeat

To get alerted when MeshPulse itself stops, create a **Push** monitor in Uptime Kuma and set `HEARTBEAT_URL` to its push URL. MeshPulse calls it every 60 seconds while MQTT and the rules loop are healthy.

## Tuning for the first week

- The default bridge silence threshold is 5 minutes. On a small or very quiet mesh, raise **Bridge silence** in **Settings**. It is the time without any device message before "Zigbee network silent" fires. Messages from Zigbee2MQTT itself (health, logs, availability) do not count.
- A Zigbee2MQTT restart that takes longer than 1 to 2 minutes raises `bridge.offline`. This is expected.

## Recording traffic

Record real `zigbee2mqtt/#` traffic to a JSONL file (one `{ts, topic, payload, retain}` object per line), usable later as test fixtures.

Environment variables: `MQTT_URL` (default `mqtt://localhost:1883`), `MQTT_USERNAME`, `MQTT_PASSWORD`, `Z2M_BASE_TOPIC` (default `zigbee2mqtt`).

```sh
MQTT_URL=mqtt://broker:1883 npm run capture [-- path/to/output.jsonl]
```

Output defaults to `captures/<ISO date>.jsonl`. Press Ctrl+C to stop.

## Replaying traffic

Replay a capture through the real router, rules, and issue lifecycle on a simulated clock, with no broker. The replay prints the issues that would open and the notifications that would be sent, grouped by rule. Use it to test the rules on your own traffic: record a day with `npm run capture`, then replay it.

```sh
REPLAY=captures/2026-10-18.jsonl npm run replay
```

The report is written to `<capture>.report.txt`. To choose another path, set `REPLAY_OUT`.

## Development

```sh
npm install
npm run dev              # dev server
npm test -- --run        # tests, one shot
npm run check            # svelte-check
npx drizzle-kit generate # after schema changes
```
