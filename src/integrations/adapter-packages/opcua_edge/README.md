# OPC-UA Edge (`opcua_edge`)

This adapter reads selected OPC-UA nodes and turns them into normalized Smart Park observations.

Use it to connect PLC/edge values into:

- Sparkplug MQTT
- canonical historian pipelines
- UNS-based downstream processing

## How it works

You define `subscriptionTags`. Each tag maps one OPC-UA `nodeId` to Smart Park fields like:

- `domain`
- `assetSlug`
- `metric`
- `eventType`
- `unit`

The adapter then publishes normalized observations from these mappings.

## Modes (`configJson.live`)

| Value | Behavior |
|---|---|
| `false` (default) | Simulate mode: no OPC-UA connection, uses `mockValue` (or `mockValues[nodeId]`). |
| `true` | Live mode: connects to OPC-UA endpoint and reads real node values. |

## Quick start

1. Install adapter in Devices and Services.
2. Start in simulate mode (`live: false`).
3. Add at least one `subscriptionTags` entry.
4. Run preview and verify output events.
5. Switch to `live: true` after endpoint connectivity is confirmed.

## Minimal config (simulate)

```json
{
  "endpointUrl": "opc.tcp://plc.example:4840/UA/SmartPark",
  "live": false,
  "subscriptionTags": [
    {
      "nodeId": "ns=2;s=Rides.BlueFire.Queue.Minutes",
      "domain": "rides",
      "assetSlug": "blue_fire",
      "metric": "queue_time",
      "unit": "min",
      "eventType": "QUEUE_TIME_OBSERVED",
      "mockValue": 25
    }
  ]
}
```

## Required runtime dependency for live mode

Install once in the Smart Park OS repository:

```bash
npm install node-opcua
```

Without this package, `live: true` cannot read OPC-UA nodes.

## Live mode requirements

- reachable `endpointUrl`
- server access compatible with `node-opcua`
- without additional certificate setup, use `securityMode: "None"`

## Context and outputs

Set context as needed for topic structure:

- `parkSlug`
- `sparkplugGroupId` (optional)
- `sparkplugEdgeNode` (optional)

Enable scheduler/publishing with your install settings (`scheduleCron`, `emitEnabled`, output profiles).

## Typical pitfalls

- `127.0.0.1` endpoint from inside Docker points to container, not host PLC.
- wrong `nodeId` syntax (`ns=...;s=...`) causes empty/failed reads.
- missing `eventType` / mapping fields leads to unusable downstream data.

## Fehlerbilder & Loesung

### 1) Live mode liefert keine Werte

Pruefen:

- `live: true` gesetzt?
- `node-opcua` installiert?
- Endpoint vom Container/Host wirklich erreichbar?
- OPC-UA Server erlaubt den verwendeten Security-Mode.

### 2) Nur Simulationswerte sichtbar

Pruefen:

- `live` steht evtl. noch auf `false`.
- `mockValue` ist gesetzt und uebersteuert erwartetes Live-Verhalten.

### 3) Werte kommen, aber nicht nutzbar downstream

Pruefen:

- je Tag korrektes Mapping (`domain`, `assetSlug`, `metric`, `eventType`, `unit`)
- `parkSlug`/Sparkplug-Kontext konsistent mit Ziel-Pipeline
