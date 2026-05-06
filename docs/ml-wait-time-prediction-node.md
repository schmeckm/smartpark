# Ride wait-time prediction (Node.js Phase 2)

This document describes the **Node.js-only** wait-time ML layer built on `ride_feature_snapshots_5m`, the **`ml_model_registry`** table, ridge regression models, and the **`/ml/*`** HTTP surface. There is **no Python or separate ML microservice** in this phase.

## Data flow

1. Adapters (e.g. ThemeParks.wiki) ingest canonical messages; the AI feature store writes **`ride_feature_snapshots_5m`** every five minutes.
2. **`ride-dataset.service`** joins snapshot at time \(t\) with the nearest snapshot at \(t + H\) minutes (15, 30, 60) for the same ride key (`provider`, `externalParkId`, `externalEntityId`), within a ±7.5 minute window around the target bucket.
3. **`ride-model-training.service`** trains **ridge regression** models (serialized JSON: means, stds, weights) per horizon. **Global** models use all rides in the park slice; **ride-specific** models run only when volume and coverage rules pass and the 60-minute validation MAE beats the active global model by at least **10%** (when a global model exists).
4. Models are stored in **`ml_model_registry`** (`model_payload`, `metrics`, `feature_list`).
5. **`ride-prediction.service`** resolves, per horizon: **ride-specific → global → baseline** (`ride-baseline-forecast.service`). Failures never throw to API consumers; missing snapshots still return baseline predictions.
6. **`addon-board-ml-bridge.service`** exposes **non-throwing** helpers: `getRideBoardMlFields` (L3), `getParkBoardMlAggregates` (L0/L1), plus pure helpers `aggregateFromRideForecastParts` / `parkDemandIndexFromAvg60` for tests and custom UIs.

## HTTP API (under `/api/v1`, authenticated)

| Method | Path | Permission | Purpose |
|--------|------|--------------|---------|
| GET | `/ml/predict/rides/:rideId` | `ai.read` | Horizons query `horizon=15,30,60` (comma-separated). `rideId` = **`park_assets.asset_id`** (UUID). |
| GET | `/ml/predict/park-summary` | `ai.read` | **L0/L1 Add-on Board roll-up**: optional `zoneId` (L1), `criticalAtMinutes` (default 55), `limit` (default 80), `offset` (0–500, paging). Returns `parkDemandForecastIndex`, `averageForecastWaitTime60`, `forecastCriticalRides`, `zones[]`, optional `cacheHit`. |
| GET | `/ml/dataset/rides` | `ai.read` | Dataset builder stats for the current park (optional `rideId`, `from`, `to`, `rowLimit`). |
| POST | `/ml/train/wait-time/global` | `ai.refresh` | Train global models for **current `X-Park-Id`**. Optional body `{ "rowLimit": 12000 }`. |
| POST | `/ml/train/wait-time/rides/:rideId` | `ai.refresh` | Attempt ride-specific training for one asset. |

OpenAPI: see `src/openapi/openapi.yaml` paths `/ml/...`.

## Training scheduler

`MlTrainingSchedulerService` (started from `server.js`) runs a **minute tick**:

- **03:00 UTC daily**: `trainGlobalModel` for **each park** (sequential, ~2.5s pause between parks to spread load).
- **Ride batch** (~every 5 days at **05:00 UTC**): for each park, attempts `trainRideModel` on up to **6** RIDE assets (name order); most runs skip when dataset rules are not met — see logs.

## ML park-summary cache

`GET /api/v1/ml/predict/park-summary` results are cached in memory for **45 seconds** per key `(parkId, zoneId, threshold, limit, offset)` to cap load when dashboards refresh often.

**Interpretation:** If every included 60-minute forecast is exactly **0** (common when there are no feature snapshots and the baseline falls back to empty signal), the roll-up treats the park average as **unknown** (`averageForecastWaitTime60: null`, `parkDemandForecastIndex: UNKNOWN`) instead of misleading **LOW**.

## How to run training manually

```bash
# After auth + X-Park-Id header
curl -X POST "https://<host>/api/v1/ml/train/wait-time/global" \
  -H "Authorization: Bearer <token>" \
  -H "X-Park-Id: <park-uuid>" \
  -H "Content-Type: application/json" \
  -d "{\"rowLimit\":12000}"
```

## How to call prediction

```bash
curl "https://<host>/api/v1/ml/predict/rides/<asset-uuid>?horizon=15,30,60" \
  -H "Authorization: Bearer <token>" \
  -H "X-Park-Id: <park-uuid>"
```

Response fields include `predictionMode` (`RIDE_SPECIFIC_MODEL`, `GLOBAL_RIDE_MODEL`, `HYBRID_MODEL`, `BASELINE_ONLY`), `modelId`, `confidence`, `predictions[]` with `source` **`ML_MODEL`** or **`BASELINE`**, and `topFactors`.

### Park / zone summary (L0 / L1)

```bash
curl "https://<host>/api/v1/ml/predict/park-summary?criticalAtMinutes=55&limit=80" \
  -H "Authorization: Bearer <token>" \
  -H "X-Park-Id: <park-uuid>"
```

Optional: `zoneId=<zone-uuid>` to restrict to one zone (L1). Demand index is **LOW** / **MEDIUM** / **HIGH** from the park-wide (or zone-scoped) average of **60-minute** forecasts on **operationally open** rides (`openingFlag` and `status` heuristics).

## Feature vector (training)

Names in `ride-feature-vector.util.js`: `current_wait_time`, `wait_time_trend_30m`, `ride_status_num`, `park_crowd_index`, `zone_congestion_score` (from `x_features_extras` or fallback to park index), `rain_mm`, `temperature_c`, `school_holiday`, `time_of_day` (UTC hour fraction).

## Known limitations

- **Ridge MVP**, not gradient boosting; quality depends on snapshot density and label noise.
- **Global scheduler** now iterates **all parks** nightly; very large fleets may still need tuning (row limits, job queue).
- **Ride-specific** training requires **≥5000** dataset rows, **≥30** coverage days, **≥80%** valid 60-minute targets, and better-than-global 60-minute MAE when a global model exists.
- **Zone congestion** may fall back to `park_crowd_index` if extras are absent.
- **Add-on Board** UI routes from the product spec are not implemented here; use **`addon-board-ml-bridge.service`** when wiring L0/L1/L3.

## Database migration

Run `npm run db:migrate` to create **`ml_model_registry`** (`20260521100000-ml-model-registry-wait-time.js`).

## Smoke (DB)

With Postgres reachable and migrations applied:

```bash
npm run smoke:ml-addon-board
```
