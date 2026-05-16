# Predictive maintenance — demo Sparkplug telemetry vs production

## Summary

PdM rules resolve live numeric signals from the **in-process Sparkplug MQTT buffer** (`mqtt-sparkplug-live-buffer.service`) by probing ordered edge candidates (`pdm-sparkplug-edge-resolve.service`) and matching **metric name + device id** derived from platform asset slug/name/id.

The **`predictive_maintenance`** adapter can optionally emit **synthetic** observations through the **same encoder stack** (`OutputRouterService` → `sparkplug-json.encoder`) so UNS / Live views and PdM dropdowns see identical metric **names** without custom mapping.

## Production path

1. Physical PLC / edge publishes Sparkplug DDATA.
2. API MQTT client ingests samples into the rolling buffer.
3. `resolveSparkplugMetricForAsset` / metric pickers scan buffer edges + device id candidates.

## Demo adapter path

1. Operator sets **`demoTelemetryEnabled: true`** on the adapter install (plus park slug).
2. `poll()` loads ride **`park_assets`** (fallback `ride_master_data`) and emits one observation per `{ asset, metric }`.
3. Values are computed by **`pdm-sparkplug-simulator.service`** (`pdmSimNumericAt`) — deterministic from `{ assetId, metricName, timestamp }` (no `Math.random()` per request).
4. MQTT publish happens only when **`emitMqtt`** is enabled — **never via direct `publishMqtt` inside the adapter package**.

## Separation guidance

- Prefer **`sparkplugEdgeNode: predictive_gateway`** for demo traffic so operators can distinguish synthetic streams from **`park_gateway`** PLC traffic.
- `buildPdmEdgeCandidateOrder` appends **`predictive_gateway`** before the hard-coded **`park_gateway`** fallback so buffer lookups still reach demo-published metrics when edges differ.

## Related code

| Area | File |
|------|------|
| Adapter poll | `src/integrations/adapter-packages/predictive_maintenance/index.js` |
| Config layering | `src/services/predictive-maintenance-demo-config.service.js` |
| Asset scan | `src/services/predictive-maintenance-demo-scan.service.js` |
| Observation build | `src/services/predictive-maintenance-demo-poll.service.js` |
| Deterministic math | `src/services/pdm-sparkplug-simulator.service.js` |
| Edge probe order | `src/services/pdm-sparkplug-edge-resolve.service.js` |
| Encode context merge | `src/modules/integrations/adapter-framework/adapter-runtime.service.js` |
