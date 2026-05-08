# Predictive Maintenance, AI Studio, AI Insights, UNS & Sparkplug

Architecture concept: how these systems relate **today**, what is **missing** for true pattern-based PdM, and a **target** shape for implementation.

---

## Executive summary

**Predictive Maintenance (PdM)** in this codebase is **rule- and threshold-driven**: it compares the **latest** Sparkplug metric values (from an **in-memory** MQTT buffer) to per-asset rules stored in PostgreSQL. Optional **evaluation logs** persist **snapshots** when overall risk or per-signal status **changes**—useful for audit and coarse history, but **not** a substitute for **dense OT time series**.

**AI Studio** trains on **ride/park feature snapshots** (guest/ops context, waits, weather, etc.). **AI Insights** (summary endpoint) surfaces **zone crowd forecasts**. **Neither consumes PdM rules, PdM evaluation logs, or Sparkplug metric history today.**

**True pattern-based PdM** (trends, drift, multivariate anomalies, supervised risk of downtime) requires **persisted telemetry time series**, optional **labels** (e.g. downtime events), and a **detection or ML layer**—deliberately separate from the guest-centric forecast pipeline unless product explicitly bridges them.

---

## Current state

### AI Studio

- **UI:** `AiStudioView.vue` — catalog, datasets, training, predictions, feature drafts.
- **API:** `/api/v1/ai/studio/*` (catalog, dataset-stats, models, train, predict, feature-drafts).
- **Training data:** Primarily **`ride_feature_snapshots_5m`** (+ matching **`park_feature_snapshots_5m`**) mapped to abstract features (weather, calendar, staffing heuristic, capacity, historical demand, etc.) via `ai-studio-dataset.service.js`.
- **Targets:** Entity-scoped (e.g. RIDE → wait time, throughput).
- **PdM:** **Not connected** — no reads from `park_asset_pdm_*` or Sparkplug historian.

### AI Insights

- **API:** `GET /api/v1/ai/insights/summary` → `AiForecastService.getInsightsSummary()`.
- **Data:** Recent **`forecasts`** for **ZONE** + **CROWD_LEVEL** (60m horizon), baseline model; ranks “hotspot” zones by predicted crowd vs capacity.
- **PdM:** **Not connected** — no use of PdM rules, logs, or OT metrics.

### Sparkplug / MQTT live values

- **Implementation:** `mqtt-sparkplug-live-buffer.service.js`.
- **Storage:** **In-memory ring buffer only** (bounded event list; no durable DB table for raw Sparkplug samples).
- **Consumers:** PdM evaluation, add-on board OEE-style fields, operations facts, registry publisher, UNS Live–style paths that read from the same buffer.
- **Lifecycle:** **Lost on API process restart** until MQTT traffic repopulates the buffer.

### UNS & canonical messages

- **Canonical ingestion:** **`canonical_inbound_messages`** — typed messages (e.g. wait time updates, entity status, park sync, weather, calendar). Integration / guest-domain alignment.
- **UNS Live / Sparkplug rows:** Buffer can attach **canonical UNS topic hints** for live display; this is **not** a full industrial historian for arbitrary DDATA metrics.
- **PdM path:** Resolves values via **Sparkplug buffer lookup** (device + metric), **not** via canonical message tables as time series.

### Predictive Maintenance

- **Rules:** `park_asset_pdm_rules` — metric name, thresholds, unit, enabled, etc.
- **Evaluation:** At request time — latest Sparkplug value per rule vs thresholds → OK / WARN / CRITICAL / NO_DATA + text recommendation.
- **History:** `park_asset_pdm_evaluation_logs` — **append-only snapshots** when a **fingerprint** of risk + per-metric **status** changes (deduplicated vs last row per asset); full JSON snapshot stored. **Not** per-metric high-frequency samples.

### Feature store / forecasts (related “AI data plane”)

- **`forecasts`:** Subject PARK/ZONE/RIDE; target metrics CROWD_LEVEL, WAIT_TIME, STAFF_DEMAND; JSON `features` on rows.
- **Snapshots:** 5m ride/park aggregates for Studio training — **orthogonal** to OT Sparkplug unless explicitly extended later.

---

## Key finding: PdM is threshold-based today, not pattern-based

| Capability | Today |
|------------|--------|
| Latest value vs static thresholds | Yes (Sparkplug buffer + rules) |
| Persistence of **raw metric** time series | No (buffer only) |
| Trend / drift / seasonality | Not in PdM engine |
| Multivariate anomaly across metrics | Not implemented |
| Supervised “failure in next H hours” | No labels pipeline from PdM to ML |
| Audit trail of **rule outcomes** | Yes (`park_asset_pdm_evaluation_logs`, change-based) |

**Conclusion:** Current PdM is **operational alerting / baseline Phase 0–1**, not **pattern discovery**. Pattern detection needs **time-indexed telemetry** (and usually **labels** or weak supervision).

---

## Target architecture

**Principles**

1. **Separate lanes:** Guest/forecast AI (Studio, Insights) vs **OT telemetry & PdM** share **park/asset identity** but stay **decoupled** until product explicitly defines cross-features and UX.
2. **Single writer for truth:** MQTT → optional **telemetry persistence** layer → PdM evaluation reads **last value** from TS or buffer consistently after restart.
3. **Rules + models:** Keep **threshold rules** for transparency and fast path; add **pattern / ML layer** that reads TS and writes **findings** (not silent replacement of rules).
4. **Explicit APIs:** e.g. asset-scoped telemetry history and pattern events; avoid overloading `/ai/insights/summary` without a deliberate schema.

**Conceptual diagram**

```text
MQTT (Sparkplug) ──► in-memory buffer (live UI, hot path)
        │
        └──► [NEW] OT metric sample writer ──► time-series store (PostgreSQL / TSDB)
                        │
                        ├──► PdM threshold engine (latest point + rules)
                        ├──► PdM evaluation logs (outcome changes) [existing]
                        └──► Pattern / anomaly job ──► pattern_events + UI

AI Studio ◄── ride/park snapshots (existing)     OT features ──► [optional] Studio dataset v2
AI Insights ◄── forecasts / zones (existing)     OT risk panel ──► [optional] separate insight surface
UNS / canonical ◄── integration domain            ◄── optional join keys for unified analytics
```

---

## Required data model

| Piece | Purpose |
|-------|---------|
| **Append-only OT samples** | `(park_id, asset_id, device_id?, metric_name, observed_at, value, quality?, …)` — partitioned by time; retention policy. |
| **Rollups (optional)** | Minute/hour aggregates for UI and training scale. |
| **Pattern / anomaly outputs** | Events: window, score, type, explanation JSON, model id — separate from threshold **evaluation logs**. |
| **Existing** | `park_asset_pdm_rules`, `park_asset_pdm_evaluation_logs`, `asset_downtime_events` (labels). |

Exact table names can follow repo naming conventions when implemented.

---

## Backend services

| Service | Responsibility |
|---------|------------------|
| **Telemetry writer** | From MQTT handler or buffer drain → batched inserts into TS store. |
| **Telemetry query** | Range / last-N / aggregate APIs with park RBAC. |
| **PdM evaluation** | Prefer “latest from TS” once available; buffer fallback for dev. |
| **Pattern engine** | Scheduled or streaming: reads TS + optional labels → writes pattern events. |
| **Optional exporter** | Snapshots or Parquet for offline training; optional push of **aggregated** OT features into a governed feature path. |

---

## Frontend implications

- **PdM / Add-on board:** Sparklines and range selectors backed by **telemetry history API**; link evaluation log entries to chart time ranges.
- **AI Studio:** New dataset / target types **only** if product adds OT-aware training; not automatic.
- **AI Insights:** Separate operations-risk or PdM widget **if** desired—do not conflate with zone crowd “hotspots” without API design.

---

## MVP roadmap (P0–P5)

| Phase | Scope |
|-------|--------|
| **P0** | Architecture and contracts documented (this doc); migrations for existing PdM tables applied in envs; ops clarity: buffer vs DB. |
| **P1** | Persist samples for **metrics referenced by enabled PdM rules** (or small allowlist); retention (e.g. 7–30 days). |
| **P2** | Read APIs + PdM UI: metric history charts. |
| **P3** | Simple detectors (e.g. deviation from trailing baseline); `pattern_events` table + list UI. |
| **P4** | Join **downtime / incident** labels; optional supervised model; optional registration beside `AiStudioModel`. |
| **P5** | Optional cross-product: Studio OT datasets or dedicated Insights surface; governance and SLOs for TS volume. |

---

## Non-goals (for this concept)

- Replacing **guest** forecast pipelines with OT data without explicit product scope.
- Storing **full** MQTT payload blobs indefinitely for all topics without retention and cost controls.
- Implicitly training **one** model that mixes crowd hotspots and bearing temperature without feature and label hygiene.
- Mandating **Feast** or a specific TSDB vendor in this document—implementation may choose Postgres partitions first, then scale out.

---

## Explicit facts (checklist)

- **AI Studio does not consume PdM today** — training rows come from snapshot-based feature mapping, not `park_asset_pdm_*`.
- **AI Insights (summary) does not consume PdM today** — it aggregates zone **crowd** forecasts from `forecasts`.
- **Sparkplug live buffer is in-memory only** — not durable across process restarts.
- **True PdM pattern detection requires persisted OT time series** (plus, for supervised learning, labels or outcome windows)—evaluation logs alone are **outcome snapshots**, not dense metric history.

---

## References (code pointers)

- Sparkplug buffer: `src/services/mqtt-sparkplug-live-buffer.service.js`
- PdM: `src/services/predictive-maintenance.service.js`, `src/models/park-asset-pdm-rule.model.js`, `park-asset-pdm-evaluation-log.model.js`
- AI Studio: `src/services/ai-studio.service.js`, `src/services/ai-studio-dataset.service.js`, `src/controllers/ai-studio.controller.js`
- AI Insights summary: `src/services/ai-forecast.service.js` (`getInsightsSummary`), `src/controllers/ai.controller.js`
- Forecasts: `src/models/forecast.model.js`
- Canonical: `src/models/canonical-inbound-message.model.js`
