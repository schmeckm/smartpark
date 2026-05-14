# ML / forecast phased roadmap (non-breaking)

This document sequences evolution of **governed ML and ADR-style forecasting** in Smart Park OS. **Phase 0 is binding:** no forecast or API semantics change unless an explicit env flag is on and the related phase is implemented. **ML must consume governed 5-minute feature snapshots** (`park_feature_snapshots_5m`, `ride_feature_snapshots_5m`); MQTT/UNS remains **distribution / ops / readiness**, not the ML system-of-record.

## Rules (all phases)

- Do not replace the ML engine in one big-bang refactor.
- Backward compatible: existing HTTP shapes and dashboards keep working.
- Feature flags default **off**; production behavior matches pre-phase deployments when flags are off.
- Semantics of numeric forecasts do not change unless the phase that owns the behavior is shipped **and** the relevant flag is enabled.

## Phase 0 — Freeze + flags + regression (current)

**Goals:** Establish env toggles and golden tests so later edits are detectable.

- **Env (default `false`):** `ML_TRACE_ENABLED`, `ML_PROFILE_ENABLED`, `ML_FEATURE_WEIGHTS_ENABLED` — exposed on `src/config/env.js` and structured flags `getFlags().mlForecast.*`.
- **Regression:** `src/services/ml/ml-forecast-phase0.regression.test.js` locks `snapshotToFeatureMap`, vector order, and `baselineForecastFromSnapshot` for a fixed fixture.

## Phase 1 — Additive prediction trace (implemented)

**Flag:** `ML_TRACE_ENABLED` (default off). **Observability only:** Phase 1 does **not** influence numeric predictions, model selection, or baseline math. With the flag off, no trace rows are written and ride wait forecasting behaves exactly as before Phase 1.

**Storage:** Postgres tables `ml_prediction_traces` (one row per prediction request: full ordered X from governed `snapshotToFeatureMap` → mask, sources, per-feature status, missing list, input hash) and `ml_prediction_results` (one row per horizon: predicted value, confidence copy, reason codes, fallback flag).

**Service:** `src/services/ml/ml-prediction-trace.service.js` — `scheduleRideWaitMlTrace` is invoked from `predictRideWaitTimes` **after** the forecast payload is computed; trace writes run in a detached async chain, catch all DB errors, and **never throw** back to the caller.

**Read API:** `GET /api/v1/ai/ml/prediction-traces`, `GET /api/v1/ai/ml/prediction-traces/filter-options` (distinct model/target names for the current park, for UI filters), and `GET /api/v1/ai/ml/prediction-traces/:predictionId` (requires `ai.read` and `X-Park-Id`; list/detail/filter-options are scoped to the current park). **Read-only** — no mutation of forecasts.

**Tests:** `src/services/ml/ml-prediction-trace.service.test.js` (unit, toggles `env.mlTraceEnabled` and stubs model writes). Phase 0 regression (`ml-forecast-phase0.regression.test.js`) remains the semantics freeze for feature map + baseline.

Optional DB-backed checks can be added behind an opt-in integration flag; default CI relies on unit coverage + Phase 0 regression.

## Phase 2 — ML Feature Monitor UI (implemented)

**Scope:** Read-only admin UI; **no** API or forecast behavior changes beyond consuming existing Phase 1 trace endpoints.

**Route (canonical):** `/ai/ml/feature-monitor` (alias redirect: `/ai/ml` → Feature Monitor). **Navigation:** AI section → “Feature monitor” (requires `ai.read`).

**Frontend:** `admin-dashboard/src/views/ai/MLFeatureMonitorView.vue` — filters (ride, **model and target dropdowns** populated from `GET /api/v1/ai/ml/prediction-traces/filter-options`, with **All** = no filter and exact-match semantics unchanged for `modelName` / `targetName` query params; free-text fallback if that endpoint fails), time range, limit; main trace list, slide-over detail with trace metadata, **X** feature table (`featureVectorJson` + optional `featureSourcesJson` / `featureStatusJson` / missing list), and **per-horizon results** from `ml_prediction_results`. Defensive parsing when optional JSON is absent lives in `admin-dashboard/src/utils/mlPredictionTracesDisplay.ts`.

**API client:** `admin-dashboard/src/services/api/mlPredictionTraces.api.ts` (re-exports `listMlPredictionTraces`, `getMlPredictionTraceFilterOptions`, `getMlPredictionTrace` from `admin-dashboard/src/api/client.ts`).

**Filter options (read-only):** `GET /api/v1/ai/ml/prediction-traces/filter-options` — distinct, alphabetically sorted `model_name` and `target_name` from `ml_prediction_traces` for the active park (null/empty omitted). Same auth and park context as the trace list.

**Operational note:** Traces appear only when `ML_TRACE_ENABLED=true` on the API and ride-wait forecasts run for the active park.

## Phase 3 — Park ML Profile & Ride ML Profile (metadata only) **(implemented)**

**Flag:** `ML_PROFILE_ENABLED` (default off). When off, profile CRUD routes return **404** with body `{ success: false, code: 'ML_PROFILE_DISABLED', message: '...' }` (same pattern as other ML feature gates).

**Scope:** **Additive metadata only.** Profiles are stored in Postgres (`ml_park_profiles`, `ml_ride_profiles`) and editable from the admin UI. They are **not** read by ride-wait forecasting, baseline math, or feature snapshots in Phase 3 — **forecast calculation and prediction results are unchanged.**

**Storage:** UUID `id`, scoped by `park_id` (and `ride_id` for ride profiles), named/versioned rows with JSONB sections per domain (crowd, weather, calendar, etc.) plus `notes`, `enabled`, timestamps. Unique `(park_id, profile_name, profile_version)` and ride analogue.

**API:** `GET`/`POST`/`PUT` under `/api/v1/ai/ml/park-profiles` and `/api/v1/ai/ml/ride-profiles` (requires `X-Park-Id`, `ai.read` for GET, `ai.refresh` for write). Cross-park access is rejected.

**Concept (UI):** Rows are **operational forecast behavior metadata**, not raw trained ML models. **Park profiles** hold park-wide default context (weather, crowd, calendar, etc.); **ride profiles** attach to a specific ride and **override or enrich** ride-level behavior (queue dynamics, weather sensitivity, staffing/downtime assumptions, throughput). The **forecast engine** is unchanged in Phase 3; later phases may consume **effective** merged configuration. The admin UI (`MLProfilesView`) presents this as **operational forecast behavior profiles** with grouped controls, explainability copy, and an effective park+ride preview where data allows.

**Frontend:** Route **`/ai/ml/profiles`** — `admin-dashboard/src/views/ai/MLProfilesView.vue` (park/ride tabs; operator-focused **behavior** editor with sliders and summaries; **Advanced JSON** for full blobs; timing/weights tabs; validation unchanged). Navigation: AI → **Forecast profiles** (short label). ML Feature Monitor and ride overview surfaces show **assigned** ride profile context when APIs are enabled. **Disabled** when the API returns `ML_PROFILE_DISABLED`.

**Tests:** Service/unit checks in `src/services/ml/ml-metadata-profile.test.js`; optional DB integration behind env (see integration test file if present).

## Phase 4 — Optional manual feature weights **(implemented)**

**Flags:** `ML_PROFILE_ENABLED` (to store profiles), `ML_FEATURE_WEIGHTS_ENABLED` (to apply weights for trace explainability), and `ML_TRACE_ENABLED` (to persist traces).

**Scope:** Manual **business** weights are **profile metadata** (Postgres `feature_weights_json` on `ml_park_profiles` / `ml_ride_profiles`). They default to **1.0** per training feature when unspecified. Weights are **merged** for traces: defaults → park profile → ride profile (ride overrides park on the same key). Keys must match `TRAINING_FEATURE_NAMES` (`ride-feature-vector.util.js`).

**Non-breaking:** Baseline ride-wait **forecast output is unchanged** unless a later phase wires weighted vectors into the prediction path. When `ML_FEATURE_WEIGHTS_ENABLED=false`, traces omit populated `weighted_feature_vector_json` (column stays `{}`). The ordered `feature_vector_json` in traces is **unchanged** from Phase 1.

**Tracing:** When tracing is on and feature weights are on, `ml_prediction_traces.weighted_feature_vector_json` stores per-feature `{ rawValue, normalizedValue, weight, weightedValue, source, status }` for explainability (separate from learned model coefficients).

**Tests / util:** `src/services/ml/ml-feature-weight.util.js` (`normalizeFeatureWeights`, `mergeParkAndRideWeights`, `buildWeightedFeatureVector`); service tests cover defaults, park/ride override, validation, and forecast engine isolation.

## Phase 5 — Learned coefficients vs manual weights **(implemented, read-only visibility)**

**Scope:** **Explainability only.** Active ridge models already persist payloads in Postgres (`ml_model_registry.model_payload` — `ridge_v1` with standardized weights). Manual business weights stay **Phase 4 profile metadata / `weighted_feature_vector_json`** — **forecast math is unchanged**; ridge inference still uses the stored payload only.

**Read API:**
- **`GET /api/v1/ai/ml/prediction-traces/:predictionId/coefficients`** — resolves the registry model used for coefficients (preferring the 60m horizon `SOURCE_ML_MODEL` metadata in `ml_prediction_results`) and returns `{ predictionId, modelName, modelVersion, coefficients: [{ feature, coefficient, direction, absoluteRank }] }`. Empty `coefficients` for baseline-only, fallback traces, offline registry rows, or non-ridge payloads. **Read-only;** separate from mutation or retraining.

**Detail endpoint unchanged for compatibility:** `GET .../prediction-traces/:predictionId` still includes `learnedCoefficients` and `manualBusinessWeights` for existing clients.

**Frontend:** **`/ai/ml/feature-monitor`** drawer section **«Learned Model Coefficients»** loads coefficients from the coefficients endpoint and shows manual business weights per feature from **`weighted_feature_vector_json.weight`** when the trace captured them (`ML_TRACE_ENABLED` + `ML_FEATURE_WEIGHTS_ENABLED`). Learned coefficients and manual weights are visibly separate columns.

---

## Phase 6 — ML Forecast Health Strip **(implemented, read-only observability)**

**Scope:** **UI only**, using **existing APIs and trace data**. The strip **does not** change prediction math, trace logging, model training, manual weights, or learned-coefficients resolution logic; it **does not** add backend tables.

**Frontend:** **`/ai/ml/feature-monitor`** (`admin-dashboard/src/views/ai/MLFeatureMonitorView.vue`) — responsive grid **above the trace table** (before the trace hint line). **`GET /api/v1/ai/feature-data-quality`** loads in parallel on mount, park switch, and after trace refresh; failures soften DQ-backed cards only and **never** block trace list loading.

**Cards (Phase 6):** (1) Feature completeness from `kpis.avgCompletenessScore`; (2) Missing features total from weather/calendar/traffic/staffing snapshot KPI sums; (3) **Stale signals** — park-wide live/stale UNS counts are **not wired** on this route (`Not available` / N/A); (4) Trace quality from loaded traces (`fallbackUsed` ratio) plus **NO_GOVERNED_SNAPSHOT** horizons appended to the primary line when a trace detail is open with matching reason codes; (5) **Model / data mismatch** when DQ hints suggest snapshot gaps or the selected trace shows **NO_GOVERNED_SNAPSHOT** / mixed **SOURCE_ML_MODEL** vs baseline-only horizons; (6) Coefficient availability using **`learnedCoefficients`** on trace detail **or** `GET .../prediction-traces/:id/coefficients`; (7) Explanation health from **`lowConfidenceForecastCount`**.

**Pure helpers / unit tests:** `admin-dashboard/src/utils/mlForecastHealthStrip.mjs`, `admin-dashboard/src/utils/mlForecastHealthStrip.test.mjs` (`npm run test:unit` in `admin-dashboard`).

---

## Phase 7 — Forecast accuracy tracking **(implemented, observational only)**

**Scope:** Measure how accurate ride-wait forecasts are over time by comparing **`ml_prediction_results`** (Phase 1 traces) to **governed `ride_feature_snapshots_5m`** at **prediction time + `horizon_minutes`** (±7.5 minute alignment window, same family as training dataset joins). **Observational only:** this phase does **not** retrain models, auto-correct forecasts, modify predictions, change manual business weights, change learned coefficients, or alter the forecast engine. Accuracy writes are **additive** and failures **never** affect forecasting.

**Storage:** Postgres table **`ml_forecast_accuracy_logs`** (one row per evaluated horizon; unique on `prediction_id` + `horizon_minutes` + `target_name`). Metrics: absolute / percentage / squared error, bias, `accuracy_status` (`OK` / `WARNING` / `CRITICAL` / `UNKNOWN`).

**Service:** `src/services/ml/ml-forecast-accuracy.service.js` — `evaluateForecastAccuracy`, `evaluatePredictionTrace`, `calculateAccuracyMetrics`, `listAccuracyLogs`, `getAccuracyKpis`. Evaluation runs when accuracy **GET** endpoints are called (bounded batch catch-up), not from the prediction hot path.

**Read API:** `GET /api/v1/ai/ml/forecast-accuracy`, `GET /api/v1/ai/ml/forecast-accuracy/kpis`, `GET /api/v1/ai/ml/forecast-accuracy/:id` (requires `ai.read`, `X-Park-Id`; park-scoped).

**Frontend:** **`/ai/ml/feature-monitor`** — section **Forecast accuracy** with KPI cards, table, optional ECharts predicted-vs-actual series, and an additional **health strip card** (after Phase 6 cards) driven by mean percentage error thresholds via `badgeForecastAccuracyHealth` (≤10% OK, ≤25% warning, else critical). Accuracy loads **independently** of trace list success.

**Tests:** `src/services/ml/ml-forecast-accuracy.service.test.js`; health-strip thresholds in `admin-dashboard/src/utils/mlForecastHealthStrip.test.mjs`.

### Closed-period snapshot eligibility **(implemented)**

**Goal:** Keep historical rows in `ride_feature_snapshots_5m` during park or ride closures, but **exclude** them from ML training joins and forecast-accuracy “actual” resolution unless explicitly eligible.

**Columns (additive):** `park_is_open`, `ride_is_open`, `forecast_eligible`, `training_eligible`, `accuracy_eligible` (NOT NULL default `true`), `data_quality_reason` (nullable — `PARK_CLOSED`, `RIDE_CLOSED`, or null when OK).

**Writer:** `AiFeatureStoreService.buildSnapshots` evaluates scheduled operating hours per park bucket (same sources as park snapshots), sets eligibility on each ride upsert, and **does not** drop rows when the park or ride is closed.

**Forecast read path:** `predictRideWaitTimes` checks `forecast_eligible` on the latest governed snapshot; when false it returns **zero** horizon predictions with **`fallbackUsed`** / closed reason codes (**no ridge math** change for eligible snapshots).

**Accuracy:** `resolveActualWaitFromGovernedSnapshot` ignores `accuracy_eligible = false` rows; if only ineligible snapshots exist in the ±7.5m window, evaluation stays **UNKNOWN** with `evaluation_reason` set (`ml_forecast_accuracy_logs.evaluation_reason`). KPIs expose **`closedPeriodUnknownCount`** so the Feature Monitor health strip can show **N/A** instead of treating closed periods as model failure.

**Training datasets:** `ride-dataset.service`, `ai-training-dataset.service`, and `ai-studio-dataset.service` filter with `training_eligible = true` (and skip ineligible rows when pairing future waits).

**Trace UI:** `ml_prediction_traces.governed_snapshot_quality_reason` surfaces closed-period context on Feature Monitor Standard **X** when present.

### Feature Store Readiness **(implemented)**

**Goal:** Help operators see whether `ride_feature_snapshots_5m` is being populated, whether governed wait times appear, and whether forecast accuracy *can* be evaluated — without implying a model defect when the park is simply closed or sampling is off.

**Read API:** `GET /api/v1/ai/ml/feature-store-readiness?rideId=&from=&to=` (optional query; window defaults to trailing 7 days). Same auth as other ML read routes (`ai.read`, `X-Park-Id`). **Read-only** — no snapshot rebuild; use `POST /api/v1/ai/forecasts/refresh` where appropriate.

**Ride-scoped snapshot debug:** `GET /api/v1/ai/ml/feature-store-snapshot-debug?rideId=<uuid>&windowHours=` (defaults to 2h, clamped 1–72) returns rolling-window row counts plus the latest snapshot rows — used in ML Feature Monitor for quick “feature store vs wait vs closure” diagnosis.

**Signals:** Effective `AI_SAMPLING_ENABLED` (source `DB`/`ENV`/`DEFAULT`), last finished `ai_pipeline_runs` row, and SQL aggregates on `ride_feature_snapshots_5m` (totals, freshness, numeric wait coverage, `accuracy_eligible` + reason buckets). Dominant **PARK_CLOSED** / **RIDE_CLOSED** periods surface as **WARNING**, not **CRITICAL**, so closed parks are not framed as ML failure.

**Frontend:** ML Feature Monitor (`/ai/ml/feature-monitor`) shows a **Feature Store Readiness** strip with per-dimension status, short copy, suggested actions, optional **Run pipeline refresh** when `ai.refresh` is granted, and a non-blocking **unknown** state if the readiness call fails.

---

## Phase 8 — Governance & deeper analytics *(backlog)*

Feature drift, registry hardening, retraining candidates — mostly read/analytics and alerts; training pipeline changes stay incremental.

---

*For ADR forecast vs ridge vs Studio split, see `docs/architecture/ai-insights-studio-forecast-consistency-assessment.md`.*
