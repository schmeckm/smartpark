# Sparkplug → Influx → PdM: Telemetry persistence strategy

This document defines a **state-of-the-art telemetry persistence concept** for Smart Park OS: how MQTT Sparkplug live data should flow into durable time series, how that supports Predictive Maintenance (PdM) and operations analytics, and what stays in PostgreSQL. It is based on a **read of the current codebase** (May 2026); **no implementation changes** are described as already done unless explicitly marked “today”.

Related doc: [pdm-ai-uns-sparkplug.md](./pdm-ai-uns-sparkplug.md) (broader UNS / AI / PdM landscape).

---

## 1. Current Influx write path (as implemented today)

### 1.1 Where it is called

| Step | Location |
|------|----------|
| MQTT ingest builds flattened rows | `flattenSparkplugMqttMessage` / `flattenTpunsMqttMessage` in `src/services/mqtt-sparkplug-live-buffer.service.js` |
| Every ingested row is passed to the historian hook | `ingestLiveRows` → `maybeWriteSparkplugDdataRow(row)` for **each** row (Sparkplug and TPUNS) |
| Influx writer | `src/services/influx-ot-metrics.service.js` |
| Write API flush on shutdown | `flushInfluxOtWrites` is the **stop** hook of lifecycle step `influx:ot-metrics-flush` in `src/bootstrap/registrations/default.js`: `run()` returns an async function that closes the write client. On shutdown, `lifecycle.stop()` unwinds in **reverse registration order**, so **`mqtt:connector` stops before** this flush runs (MQTT stops first, then pending Influx batches are flushed). |
| Configuration | `src/config/env.js`: `influxEnabled`, `influxUrl`, `influxToken`, `influxOrg`, `influxBucket`, `influxFloatEpsilon`, `influxMinWriteIntervalMs` |

### 1.2 Which Sparkplug (and buffer) messages are written

Inside `maybeWriteSparkplugDdataRow`:

- **Written only if** `messageType === 'DDATA'` (case-insensitive).
- **Not written**: `DBIRTH`, `DDEATH`, `NBIRTH`, `NDEATH`, `NCMD`, `DCMD`, `STATE`, and any other non-`DDATA` types, even if they carry metrics in the buffer.
- **TPUNS / UNS_JSON** rows also go through `ingestLiveRows` with `messageType: 'UNS_JSON'` → **never** written (same function; filter is strict on `DDATA`).

Rows with **no metrics array** (Sparkplug payload with empty metrics) still produce a single buffer row with `metric: null` and a truncated string `value` → **not** written (empty metric name and non-numeric `value`).

### 1.3 Which metric types / values are ignored

| Condition | Result |
|-----------|--------|
| `INFLUX_ENABLED` not true | No-op |
| Missing URL / token / org / bucket when enabled | `ensureWriteApi()` throws if a write is attempted (misconfiguration) |
| `metric` empty or missing | Skip |
| `value` not `typeof 'number'` or not finite | Skip (strings, booleans, objects, arrays, `NaN`, `±Infinity` are **not** persisted) |
| Delta rule (below) | Skip |

So today the historian is **numeric-only** for **Sparkplug DDATA** lines that flatten to a JavaScript **number**.

### 1.4 Tags and fields (Influx line protocol shape)

Single measurement name (constant):

- **Measurement**: `sparkplug_metric`

**Tags** (all stringified; `metric` truncated to 160 chars):

| Tag | Source (buffer row) |
|-----|---------------------|
| `group_id` | Sparkplug topic group segment (`row.groupId`) |
| `edge_node_id` | `row.edgeNodeId` |
| `device_id` | `row.deviceId` (Sparkplug device segment—often slug, name, or asset id segment, not guaranteed UUID) |
| `metric` | Sparkplug metric name (`row.metric`) |
| `quality` | `row.quality` (e.g. `GOOD`, `SIMULATED` from `resolveLiveQuality` on ingest) |

**Fields**:

| Field | Type | Notes |
|-------|------|--------|
| `value` | float | Only numeric series |

**Timestamp**: `row.receivedAt` parsed to ms if valid; else `Date.now()` at write time.

There are **no** tags today for: `park_id`, `asset_id`, `ride_id`, `signal_code`, `integration_id`, or UNS canonical path.

### 1.5 Delta / interval logic

Per **logical series** key: `(group_id, device_id, metric)` (`trackingKey` in `influx-ot-metrics.service.js`).

1. **`INFLUX_FLOAT_EPSILON`** (default `1e-9` from env): if a previous value exists and `|new - prev| <= epsilon`, the sample is treated as **unchanged**.
2. If unchanged:
   - If **`INFLUX_MIN_WRITE_INTERVAL_MS` is 0** (default): **no write** (pure change detection).
   - If **`INFLUX_MIN_WRITE_INTERVAL_MS` > 0**: a write is allowed as a **heartbeat** only when `now - lastWrite >= minIv` (still unchanged value).
3. If `|new - prev| > epsilon`: **write** (no minimum-interval gate in code—every material change is written subject to client batching).

**Write client batching** (not the same as downsampling): `getWriteApi` uses `batchSize: 50`, `flushInterval: 2000` ms.

**Operational caveat**: `lastValueByKey` / `lastWriteMsByKey` are **in-memory process state**. After API restart, delta gates reset (first sample after restart always eligible to write). Tracking maps are **cleared entirely** when size exceeds **8000** keys (`MAX_TRACKED_KEYS`) to cap memory—under heavy cardinality, delta state can reset abruptly.

**Implication for analytics**: historian data is **sparse** when signals are flat; it is **not** a uniform sampling grid unless operators set `INFLUX_MIN_WRITE_INTERVAL_MS` and accept heartbeats.

---

## 2. Does the current schema support the product goals?

Assessment is against **today’s** `sparkplug_metric` tags/fields and write rules.

| Goal | Supported today? | Why |
|------|------------------|-----|
| **Asset-level PdM** (threshold rules per `park_assets`) | **Partially** | Rules and evaluation live in Postgres; **live** values come from RAM (`resolveSparkplugMetricForAsset` → `findLatestSparkplugLiveMetricRow`). Influx is **not** read. Historian has no stable `asset_id` tag—only Sparkplug `device_id` + `group_id`, which must be mentally mapped to assets (same ambiguity as buffer). |
| **Ride-level trend analysis** | **Weak** | Trends need time-aligned series per ride/asset. You can Flux filter by `group_id` + `device_id` + `metric` **if** those segments match naming conventions, but there is **no** `ride_id` / `asset_id` / `park_id` tag; cross-park or renamed devices break joins. |
| **Anomaly detection** | **Weak** | Often needs regular sampling or complete change history; epsilon-only gating drops steady-state points. No boolean/string modes for multi-modal faults. Cold start after restart loses delta context. |
| **AI Studio / feature engineering** | **No** | No query API, no feature contract, no join keys to Studio datasets; cardinality and sparsity unmanaged. Explicitly **out of MVP** below. |
| **Dashboard sparklines** | **Partial** | Technically possible in Grafana/Flux against `sparkplug_metric` if dashboards use `group_id`/`device_id`/`metric`. Smart Park UI has **no** backend history API today (`getQueryApi` / Flux **not** present under `src/`). Sparklines in-app would need new read path + schema clarity. |

**Summary**: the current bucket is a **minimal optional OT trace** for numeric DDATA, useful for ad-hoc external visualization—not yet a **first-class analytics plane** aligned with `park_id` / `asset_id` or PdM product flows.

---

## 3. Target Influx schema (recommended)

Design goals: **stable join keys** to PostgreSQL, **controlled cardinality**, **explicit separation** of raw high-frequency data vs rollups, and **clear semantics** for simulated vs field telemetry.

### 3.1 Buckets and retention (InfluxDB 2.x)

Use **two buckets** (or one bucket with two measurements + aggressive retention on raw—two buckets is clearer operationally):

| Bucket | Retention | Purpose |
|--------|-----------|---------|
| `ot_raw` (or keep `ot_metrics` as raw) | **7–30 days** (org policy: start 14d for MVP) | Append-mostly raw or “lightly thinned” samples for debugging and near-real-time charts. |
| `ot_downsampled` | **180d–400d** (pick **365d** for annual ops) | Minute (or 5m) aggregates for PdM UI, reporting, and lighter queries. |

Influx OSS: retention is **per bucket**; downsampling uses **Tasks** writing into the longer-retention bucket.

### 3.2 Measurements

| Measurement | Description |
|-------------|-------------|
| `ot_metric` | Primary numeric OT sample (successor to `sparkplug_metric`; name avoids implying transport-only). |
| `ot_metric_state` (optional, second phase) | Boolean / small discrete state (see §6). |

Keeping **one float field** per point (`value`) preserves a simple generic model; alternatively use **dynamic field names** per metric—**not** recommended at scale (schema explosion, harder Flux).

### 3.3 Tags (target)

Cardinality discipline: **high-cardinality identifiers** (`asset_id`, `metric`/`signal_code`) are acceptable; **avoid** unbounded strings (free-text labels, raw MQTT topic as tag—use field `source_topic` if needed, or log pipeline).

**Required (MVP)**:

| Tag | Example | Purpose |
|-----|---------|---------|
| `park_id` | UUID string | Tenant / park scope for APIs and RBAC. |
| `asset_id` | UUID | Join to `park_assets`, PdM rules, add-on board. |
| `metric` or `signal_code` | `vibration_rms`, `oee_5m` | Same semantic as PdM `metricName` where possible. |

**Strongly recommended**:

| Tag | Purpose |
|-----|---------|
| `edge_node_id` | Sparkplug edge; ops correlation. |
| `device_id` | Raw Sparkplug device segment (debug + bridge to UNS). |
| `group_id` | Sparkplug group (often park slug / env override). |
| `quality` | `GOOD` / `SIMULATED` / `BAD` / … |
| `source` | `sparkplug_ddata`, `registry_publish`, `simulator`, … |

**Optional** (when model supports it without guesswork):

| Tag | Purpose |
|-----|---------|
| `ride_id` | If asset is a ride and id is known at ingest. |
| `integration_id` | If metric arrives via a specific integration. |

**Rule**: Resolve `park_id` + `asset_id` at ingest using the **same** candidate device mapping as PdM (`sparkplugDeviceTopicSegment` on slug/name/assetId). If resolution is ambiguous, write to raw with tags you are sure about and put `asset_id` empty only as last resort—or drop to a dead-letter metric series with `mapping=unresolved` (operational choice).

### 3.4 Fields

| Field | Type | Notes |
|-------|------|--------|
| `value` | float | Primary numeric sample. |
| `str_value` | string | Optional for enumerated numerics encoded as strings in Sparkplug (MVP can skip if all numerics are coerced at edge). |
| `unit` | string | Low-cardinality unit code (optional field; duplicates rule metadata but helps dashboards). |

### 3.5 Downsampling / aggregation strategy

**Task cadence**: every **1 minute** (or 5m if MQTT volume is high).

**Aggregate window** per `(park_id, asset_id, metric, …)`:

- `mean`, `min`, `max`, `count` (and optionally `stddev` later for anomaly baselines).

**Write target**: measurement `ot_metric_1m` (or same `ot_metric` in bucket `ot_downsampled` with coarser timestamp grid—pick one convention and document it).

**Why**: PdM trend charts and operators do not need 1 Hz for a 30-day view; raw bucket holds detail for incident windows.

### 3.6 Migration from today’s `sparkplug_metric`

- **Parallel write** during transition: old measurement + new `ot_metric` with enriched tags, or one-off backfill skipped for MVP.
- **Dashboards**: Flux queries should prefer `park_id` + `asset_id` once available.

---

## 4. What should remain in PostgreSQL

| Data | Stay in Postgres? | Rationale |
|------|-------------------|-----------|
| **PdM rules** (`park_asset_pdm_rules`) | **Yes** | Relational integrity, CRUD, versioning, RBAC; not time series. |
| **PdM evaluation logs** (`park_asset_pdm_evaluation_logs`) | **Yes** | Append-only **state-change** audit (fingerprint dedupe), not high-frequency samples. |
| **Recommendations** (text derived from evaluation) | **Yes** | Embedded in evaluation snapshot JSON today; remains derived **application state**, not OT historian. |
| **Asset metadata** (`park_assets`, types, slugs, names) | **Yes** | Source of truth for identity and UI. |
| **Model metadata** (ML / forecasting / Studio) | **Yes** | Training jobs, model registry, feature store metadata—orthogonal to OT samples; any future OT features join **at query time** or via batch ETL, not by duplicating models inside Influx. |
| **High-frequency OT samples** | **No (Influx/TSD)** | Wrong tool in Postgres at scale; use Influx (or future alternative TSDB). |

---

## 5. MVP implementation proposal (no AI Studio)

Scope: **persist numeric Sparkplug OT metrics** with **`asset_id` / `park_id` tags** (and existing Sparkplug identifiers), **optional** booleans as fields in a follow-up, **read API** for history, **PdM trend charts** in the admin dashboard, **explicitly not** wiring AI Studio.

### 5.1 Ingest / write path (backend)

1. **Enrich at write time**: extend the historian input (or wrap `maybeWriteSparkplugDdataRow`) so that for each DDATA numeric row the writer resolves `park_id` + `asset_id` from `(group_id, edge_node_id, device_id)` using existing park/env conventions (`sparkplugGroupIdForParkSlug`, device segment candidates—inverse lookup may require a small map: device segment → asset for the park; if missing, omit `asset_id` or use best-effort from registry tables if available).
2. **Measurement**: introduce `ot_metric` (or keep `sparkplug_metric` for one release with added tags—preference: new measurement for clarity).
3. **Sampling policy**: keep epsilon + optional heartbeat for **cost control**; for PdM **trend** charts prefer reading **`ot_downsampled`** (1m) so sparse raw writes still produce usable lines. Optionally add **`INFLUX_MAX_WRITE_RATE`** guard later.
4. **TPUNS**: MVP can remain Sparkplug-only; if UNS_JSON numerics must be unified, add a second writer branch with same schema and `source=tpuns`.

### 5.2 Read API (backend)

- Authenticated endpoints, e.g. `GET /api/.../parks/:parkId/assets/:assetId/telemetry/history?metric=&from=&to=&granularity=raw|1m`.
- Server uses **Influx Flux** (`getQueryApi`) with **parameterized** queries; enforce `park_id` / RBAC from session.
- Return compact arrays: `{ t, v }[]` or columnar JSON suitable for ECharts sparklines.

### 5.3 PdM trend charts (frontend)

- **PredictiveMaintenance** views: for each rule metric (or selected metric), show **7d / 30d** line from **downsampled** bucket.
- Overlay **threshold bands** from existing rule definitions (warn/critical above/below).
- Tooltip: show `quality` / `SIMULATED` where relevant.

### 5.4 Explicit non-goals (MVP)

- **No AI Studio** dataset export, no automated feature store pipelines from Influx.
- **No** replacing evaluation logs with dense per-eval time series in Postgres.
- **No** protobuf Sparkplug payload parsing change required for MVP if JSON path remains the ingest format.

### 5.5 Observability

- Counters: dropped writes (unresolved asset), Influx errors, batch flush failures.
- Dashboard: simple “historian lag” = write timestamp vs `receivedAt`.

---

## 6. Optional extension: booleans / status

Sparkplug often encodes status as **strings** or **booleans**. MVP can skip; when needed:

- Prefer **integer encoding** at the edge (`asset_state` → small int enum) so a single `value` field works.
- If strings must be preserved: add field `state` (string) **or** separate measurement `ot_metric_state` with tags aligned to `ot_metric` and field `code` / `severity` to avoid high-cardinality string fields on the main measurement.

---

## 7. Code references (today)

| Concern | File |
|---------|------|
| Influx write, delta, tags, measurement | `src/services/influx-ot-metrics.service.js` |
| Call site + buffer | `src/services/mqtt-sparkplug-live-buffer.service.js` (`ingestLiveRows`) |
| PdM live value source | `src/services/predictive-maintenance.service.js` (`resolveSparkplugMetricForAsset`) |
| Env | `src/config/env.js` |
| Docker / bucket defaults | `docker-compose.yml` (`influxdb` service), `.env.example` |

---

## 8. Conclusion

Today’s pipeline is a **lean, optional numeric DDATA shadow** of the in-memory Sparkplug buffer: **no reads**, **no asset tags**, **delta-gated** writes. That is appropriate as a first experiment but **insufficient** as the Smart Park OS telemetry persistence layer for asset-centric PdM, ride analytics, and in-app history.

The target direction is a **two-bucket (raw + downsampled) Influx layout** around measurement **`ot_metric`** with **Postgres-aligned tags** (`park_id`, `asset_id`, signal identity), **Tasks** for rollups, **history APIs** for the UI, and **PdM charts** on rolled-up series—while **keeping rules, logs, recommendations, and metadata in PostgreSQL** as the authoritative relational and audit layer.
