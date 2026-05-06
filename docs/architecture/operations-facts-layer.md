# Operations Facts Layer

## Purpose

Smart Park OS exposes two operational boards that must not diverge on core KPIs:

- **Add-on Board** — customizable L0/L1/L3 board (park, zone, ride).
- **SQDCP / SWDEC Board** — hierarchical safety, waiting time, delivery, efficiency, and cost/crew views.

The **Operations Facts** service (`src/services/operations/operations-facts.service.js`) is the **single source of truth** for shared numeric and categorical KPIs. Board services may still compute **board-specific scores**, severity labels, layout, and AI copy — but they consume the same resolved facts for wait time, throughput, OEE inputs, crew gap, safety posture, and ML forecasts.

## Data flow

```text
Raw signals (MQTT buffer, timeseries samples, ride_feature_snapshots_5m, canonical inbound, incidents, ride master)
        → OperationsFactsService.composeRideFactsBundle / getRideFacts / getParkFacts
        → Add-on Board API (aggregates + `operationsFacts` on ride rows)
        → SQDC asset board (customer queue + delivery fields + `operationsFacts` subset)
        → Vue boards
```

REST transparency (optional debugging):

- `GET /api/v1/operations-facts/parks/{parkId}`
- `GET /api/v1/operations-facts/parks/{parkId}/zones/{zoneId}`
- `GET /api/v1/operations-facts/parks/{parkId}/rides/{rideId}`

HTTP responses **omit** the internal `_flat` projection; server-side consumers (`addon-board.service`, `sqdc-board.service`) use `_flat` for convenient numeric access.

## KPI envelope

Each KPI is a **metric cell**:

| Field        | Meaning |
|-------------|---------|
| `value`     | Resolved value or `null` if unavailable. |
| `unit`      | Optional unit (`min`, `guests/hour`, `percent`, …). |
| `status`    | Traffic-light style hint (`GREEN`, `YELLOW`, `RED`, `UNKNOWN`) for UI. |
| `quality`   | `GOOD`, `ESTIMATED`, or `MISSING` — confidence / freshness, not the same as `status`. |
| `source`    | Which input **won** after priority rules (see below). |
| `updatedAt` | ISO timestamp when known. |

Missing data **never throws** in the service layer: cells use `quality: MISSING` and `value: null`.

## Source priority rules (implemented)

### Current wait (`currentWaitTimeMinutes`)

1. **MQTT / Sparkplug live buffer** — latest `queue_time` metric for the asset (`slug` or `externalEntityId` match), quality not `MISSING`; simulated quality is mapped to `ESTIMATED`. Source: `MQTT_LIVE_STATE`.
2. **Persisted live wait sample** — `TimeseriesService.getCurrentRideWaitsForPark` row; fresh within `OPERATIONS_FACTS_LIVE_WAIT_FRESH_MS` (default 20m) → `GOOD`, else `ESTIMATED`. Source: `RIDE_WAIT_TIME_SAMPLE`.
3. **Latest `ride_feature_snapshots_5m`** — `currentWaitTimeMin` / `waitTime`. Source: `RIDE_FEATURE_SNAPSHOT`.
4. **Canonical** — `WAIT_TIME_UPDATED` payload `waitTime`. Source: `CANONICAL_WAIT_TIME_UPDATED`.
5. Otherwise **empty** (`MISSING`).

### Ride operational status (`rideOperationalStatus`)

1. **Canonical** — `ENTITY_STATUS_UPDATED` payload `status` / `rideStatus`. Source: `CANONICAL_ENTITY_STATUS_UPDATED`.
2. **Live wait sample** — `status` from timeseries; if `isOpen === false`, may force `CLOSED`. Source: `RIDE_WAIT_TIME_SAMPLE`.
3. **Persisted asset status** — `park_assets.status` (ThemeParks / MDM sync). Source: `PARK_ASSET_STATUS`.
4. Default **`UNKNOWN`** with source `PARK_ASSET_DEFAULT`.

*(MQTT ride status metrics can be added later as the first priority without changing board callers.)*

### Safety (`safetyStatus`)

1. **Open HIGH/CRITICAL safety-class incidents today** linked to the asset → `CRITICAL`. Source: `INCIDENT_SERVICE`.
2. Else derive from latest **ride feature snapshot** status string (down / e-stop / maintenance patterns). Source: `RIDE_FEATURE_SNAPSHOT`.

### Open incidents (`openIncidentCount`)

Count of **OPEN / IN_PROGRESS** incidents today linked to the asset. Source: `INCIDENT_SERVICE`.

### Throughput (`actualThroughputPph`, `throughputGapPercent`)

- **Actual**: estimated guests/h from snapshot capacity factor × theoretical capacity (same formula historically used on the Add-on Board). Source: `RIDE_FEATURE_SNAPSHOT_ESTIMATE`.
- **Gap**: \((actual - theoretical\_from\_snapshot) / theoretical\_from\_snapshot × 100\). Source: `DERIVED_THROUGHPUT_GAP`.

*(Live MQTT throughput can be wired into the bundle as a higher priority when a stable metric name exists.)*

### Theoretical capacity (`theoreticalCapacityPph`)

Snapshot value, else ride master `theoreticalCapacityPph` / `capacityPph`. Source: `RIDE_MASTER_DATA` (quality `GOOD` when master provides it).

### Availability / performance / OEE (`availabilityPercent`, `performancePercent`, `rideOeePercent`)

Derived from snapshot open flag, capacity factor, and a fixed quality constant — same derivation as the legacy Add-on Board path, now centralized. Sources: `RIDE_FEATURE_SNAPSHOT_RULE`, `DERIVED_PERFORMANCE`, `DERIVED_RIDE_OEE`.

### Crew (`plannedCrew`, `actualCrew`, `crewGap`)

- **Planned**: ride master `normalStaff` or `minStaff`. Source: `RIDE_MASTER_DATA`.
- **Actual**: placeholder `MISSING` until staffing integration exists.
- **Gap**: snapshot `staffingGapNormal` when present. Source: `RIDE_FEATURE_SNAPSHOT`.

### Forecasts (`forecastWaitTime15/30/60`)

Populated from the ML bridge (`getRideBoardMlFields`) when available; otherwise `MISSING`. Source: `ML_OR_BASELINE` / `NONE` as appropriate.

## Fact-to-board mapping

### Add-on Board

| Board area        | Facts used |
|------------------|------------|
| Park health      | Aggregates over ride rows built from `_flat` (wait, severity, throughput, forecasts). |
| Critical rides   | `severityForRide` uses `_flat` wait, safety, crew gap, open state — not raw SQL. |
| Ride cards       | `swdec` mirrors `_flat`; `operationsFacts` exposes the full envelope for transparency. |
| Heatmap          | Unchanged geo engine; wait overlays can later read the same service. |

### SQDCP / SWDEC

| Pillar      | Facts used |
|------------|------------|
| Safety     | Same incident-driven safety signal; stored daily snapshot still wins for **ring scores** when present. |
| Waiting    | `customer.queueMinutes` prefers Operations Facts wait; `queueMinutesSource` / `queueMinutesQuality` expose the winning source. |
| Delivery   | `theoreticalCapacityPph` from facts when numeric; OEE for **computed** scores falls back to facts-derived OEE when daily JSON / legacy OEE absent. |
| Efficiency | OEE percent from facts as fallback input to `computeScores` when stored OEE missing. |
| Cost / Crew | Planned/theoretical and crew gap aligned with facts for ride assets. |

## Why timestamps can differ

If Add-on Board and SQDC show different numbers, compare **`operationsFacts.*.source`** and **`updatedAt`** on each side. SQDC may still show **stored daily snapshot** scores (`scores.source: STORED_SNAPSHOT`) while customer queue minutes are live from Operations Facts — that is intentional and visible in the payload.

## Code map

| File | Role |
|------|------|
| `src/services/operations/operations-facts.service.js` | Batch context, compose bundle, `getRideFacts` / `getZoneFacts` / `getParkFacts`. |
| `src/services/addon-board.service.js` | Layout + severity + ML; **no** duplicate KPI math for shared fields. |
| `src/services/sqdc-board.service.js` | Scores + stored snapshots; ride KPIs **hydrated from facts** where applicable. |
| `src/routes/v1/operations-facts.routes.js` | Debug / transparency HTTP API. |
| `src/controllers/operations-facts.controller.js` | Park context guard, strips `_flat`. |

## Example (conceptual)

```json
{
  "parkId": "…",
  "rideId": "…",
  "timestamp": "2026-05-04T10:15:00.000Z",
  "facts": {
    "currentWaitTimeMinutes": {
      "value": 45,
      "unit": "min",
      "status": "YELLOW",
      "quality": "GOOD",
      "source": "MQTT_LIVE_STATE",
      "updatedAt": "2026-05-04T10:14:55.000Z"
    }
  }
}
```

## Related environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPERATIONS_FACTS_LIVE_WAIT_FRESH_MS` | `1200000` (20m) | When a persisted wait sample is still “fresh”. |
| `OPERATIONS_FACTS_CANONICAL_LOOKBACK_H` | `48` | Canonical message lookback window. |
