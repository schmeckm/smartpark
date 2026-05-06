# OPC-UA Edge (`opcua_edge`)

Reads a fixed list of OPC-UA nodes and maps each to a **normalized observation** (`domain`, `assetSlug`, `metric`, `value`, …) for UNS / Sparkplug / canonical encoders.

## Modes

| `configJson.live` | Behaviour |
|-------------------|-----------|
| `false` (default) | **Simulate**: values from each tag’s `mockValue` or from `mockValues[nodeId]`. No network. |
| `true` | **Live**: connects with [`node-opcua`](https://www.npmjs.com/package/node-opcua), reads each `nodeId`. Requires `npm install node-opcua` in the Smart Park OS repo. Only `securityMode: "None"` is supported without extra certificate wiring. |

## Minimal simulate config

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

## Install (platform)

Use **Devices & Services** in the admin UI or `POST /api/v1/integrations/adapters/install-local` with `adapterKey: "opcua_edge"` plus `configJson` / `contextJson` (`parkSlug`, optional `sparkplugGroupId` / `sparkplugEdgeNode`). Set `scheduleCron` and `emitEnabled` when the scheduler should publish MQTT.

## Live mode dependency

```bash
npm install node-opcua
```

Then set `"live": true` and a reachable `endpointUrl` with anonymous access and security policy None on the server.
