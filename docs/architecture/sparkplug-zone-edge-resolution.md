# Sparkplug zone-aware edge node resolution (MVP)

## Summary

Smart Park OS picks the Sparkplug B **edge node segment** from the park asset’s **zone** and the park’s **Sparkplug profile** in `master_profile`. The **zone slug is not a topic segment**; it only selects which `edges[]` row applies.

Canonical topic shape (unchanged):

```text
spBv1.0/{group_id}/{message_type}/{edge_node_id}/{device_id}
```

- `group_id` — `SPARKPLUG_GROUP_ID` env or slugified park slug.
- `device_id` — slugified **asset** slug (same as canonical publishers).

## Configuration (`master_profile.sparkplug`)

```json
{
  "sparkplug": {
    "default_edge_node_id": "park_gateway",
    "edges": [
      { "zoneKey": "iceland", "edgeNodeId": "iceland_edge", "role": "", "label": "", "note": "" }
    ]
  }
}
```

Aliases supported by the resolver: `defaultEdgeNodeId` / `edge_node_id`, `zone_key`, `zone` (when string).

## Resolution priority

1. `explicitEdgeNodeId` (trusted caller, e.g. metric definition override).
2. `adapterContext.edgeNodeId` (or `edge_node_id`; also `sparkplugEdgeNodeOverride` / `explicitSparkplugEdge`).
3. Zone match: `ParkAsset.zone_id` → `ParkZone.slug` slug-normalized equals `edges[].zoneKey`.
4. `park.master_profile.sparkplug.default_edge_node_id` (or `defaultEdgeNodeId`).
5. `process.env.SPARKPLUG_EDGE_NODE`.
6. `park_gateway`.

## Example

| Field       | Value          |
|------------|----------------|
| Park slug  | `europa_park`   |
| Zone slug  | `iceland`       |
| Asset slug | `blue_fire`     |
| Edge       | `iceland_edge`  |

**Topic** (DDATA):

`spBv1.0/europa_park/DDATA/iceland_edge/blue_fire`

The string `iceland` appears **only** as the matching key for edge selection — **not** as an extra MQTT segment.

## Code map

| Area | Behavior |
|------|----------|
| `src/services/sparkplug-edge-resolver.service.js` | `resolveSparkplugEdgeNodeForAsset`, `sparkplugTopicPreviewForAsset` |
| `src/services/canonicalToSparkplugPublisher.js` | Per-entity/async edge routing |
| `src/services/mqtt-sparkplug-live-buffer.service.js` | `probeSparkplugLiveMetricForRide` — buffer lookup matches resolved edge (+ legacy fallbacks) |
| `src/services/registry-publisher.service.js` | Publishes Sparkplug using resolver; MQTT_EDGE reads via probe |
| `src/services/ride-signal-capability.service.js` | Prepared `SparkplugMetricDefinition.edgeNodeId` from resolver |
| `src/services/attraction-oee-simulator.service.js` | Per-site edge + NBIRTH per distinct edge |
| `GET /api/v1/uns/parks/:parkId/sparkplug-topic-preview` | Same resolver as publishers (Signal View / tooling) |

## Migration note

- **No database migration.** Configure `sparkplug.edges` and optional `default_edge_node_id` in each park’s `master_profile` JSON (Park admin / settings UI that edits `master_profile`).
- Existing deployments that omit `edges[]` continue to use steps 4–6 of the fallback chain (`default` → env → `park_gateway`).
- Assets without `zone_id` keep previous behavior (park default / env / gateway).
- Operators should align `zoneKey` with **exact** thematic zone slugs used in MDM zones (`ParkZone.slug`).

## Tests

- `node src/services/sparkplug-edge-resolver.service.unit.test.js` — pure profile + fallback chain.
- Opt-in integration: `UNS_INTEGRATION_TESTS=1` — `UNS GET sparkplug-topic-preview` smoke in `src/integration-tests/uns/uns-api.integration.test.js`.
