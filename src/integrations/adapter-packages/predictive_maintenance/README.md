# predictive_maintenance



Feature-gate adapter for **Predictive Maintenance** (asset rules, Sparkplug DDATA evaluation, operations board).



## Default behaviour (noop)



- **`poll()`** intentionally returns **`observations: []`** — no MQTT and no canonical ingest from this adapter.

- Live evaluations use platform services and **real Sparkplug ingestion** (MQTT buffer / edges aligned with park Sparkplug profile).

- **Install** via Devices & Services (or `POST /integrations/installed-adapters/install-local`) still exposes UI routes.



## Optional demo telemetry (Sparkplug)



Operators may enable a **deterministic, synthetic OT telemetry generator** for demos and lab work only.



> **Warning — demo telemetry**  

> Demo telemetry mode generates **simulated** OT values. **Do not mix with production PLC telemetry** on the same logical topic paths without a deliberate naming strategy (recommended: dedicated `sparkplugEdgeNode`, e.g. `predictive_gateway`).



### Intended use



- Demo / presentations  

- Automated tests / CI fixtures  

- Development environments  

- UNS / Sparkplug visualization  

- PdM rule prototyping before wiring real edges  



### Configuration precedence



For overlapping keys: **`contextJson` → `configJson` → environment (`PDM_*`) → code defaults**.



### Example `configJson`



```json

{

  "parkSlug": "europa_park",

  "demoTelemetryEnabled": true,

  "demoMetricProfile": "standard_pdm",

  "metrics": [

    "motor_rpm",

    "pump_rpm",

    "motor_power_kw",

    "bearing_vibration_mm_s"

  ],

  "maxAssets": 50,

  "scanEntityTypes": ["ride", "attraction"]

}

```



- **`demoMetricProfile`**: `standard_pdm` (4 core metrics) or `extended_pdm` (adds water/hydraulic/oil metrics).

- **`metrics`**: optional explicit allow-list (subset of the simulator catalog).

- **`maxAssets`**: cap scanned rides per poll (1–500).

- **`scanEntityTypes`**: maps to `park_assets.entity_type` (`ride` → `RIDE`, etc.).



### Example `contextJson`



```json

{

  "parkSlug": "europa_park",

  "sparkplugGroupId": "europa_park",

  "sparkplugEdgeNode": "predictive_gateway"

}

```



When demo mode is on and **`sparkplugEdgeNode` is omitted**, the runtime defaults to **`predictive_gateway`** (override via `PDM_DEMO_SPARKPLUG_EDGE_NODE`).



### Environment overrides (optional)



| Variable | Purpose |

|----------|---------|

| `PDM_DEMO_TELEMETRY_ENABLED` | `true` / `false` — global default when install JSON omits the flag |

| `PDM_DEMO_MAX_ASSETS` | Upper bound for scanned assets |

| `PDM_DEMO_SPARKPLUG_EDGE_NODE` | Fallback edge segment for MQTT encode |



### Output pipeline



With **`SPARKPLUG_JSON`** in output profiles and **`emitMqtt`** enabled (Run preview / scheduler), observations flow through the **standard adapter output router** — **no direct MQTT calls** inside this package. Topics follow:



`spBv1.0/{groupId}/DDATA/{edgeNodeId}/{deviceId}`



`deviceId` is derived from **`slugifyName(assetSlug)`**, matching other adapters.



Payload tags include **`simulated` / `syntheticDemo`** when the observation metadata marks demo rows.



### Difference vs real ingestion



| Path | Data |

|------|------|

| **Production PLC / edge** | Physical OT → MQTT → live buffer → PdM rules |

| **This demo mode** | Deterministic math from asset id + time bucket → MQTT via adapter encoder |

| **PdM evaluation layer** | Same rule engine; values must resolve via Sparkplug metric name + device id |



### Asset scan order



1. Active rows in **`park_assets`** filtered by park slug + entity types + `active_flag`.

2. If more slots remain: **`ride_master_data`** joined to **`park_assets`** for additional rides.



See also: `docs/architecture/predictive-maintenance-demo-telemetry.md`.

