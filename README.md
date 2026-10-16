# MeshPulse

A passive Zigbee2MQTT health monitor that only reads MQTT traffic.

## Recording traffic

Record real `zigbee2mqtt/#` traffic to a JSONL file (one `{ts, topic, payload, retain}` object per line), usable later as test fixtures.

Environment variables: `MQTT_URL` (default `mqtt://localhost:1883`), `MQTT_USERNAME`, `MQTT_PASSWORD`, `Z2M_BASE_TOPIC` (default `zigbee2mqtt`).

```sh
MQTT_URL=mqtt://broker:1883 npm run capture [-- path/to/output.jsonl]
```

Output defaults to `captures/<ISO date>.jsonl`. Press Ctrl+C to stop.
