# WODAN — outdoor coaster regression case (AI / ML forecast pipeline)

This document pins **Europa-Park → WODAN** (Timburcoaster, `themeparks_wiki`) as a second end-to-end check beside [Euro-Mir](./euromir-forecast-regression.md). WODAN validates **outdoor coaster** behaviour: **ML profile `OUTDOOR_COASTER_HIGH_CAPACITY`**, **weather sensitivity**, **capacity / throughput signals**, **staffing gap** in snapshots or factors, and **forecast data quality** semantics when externals (e.g. weather) are incomplete — **`forecastDataQualityStatus` must stay `WARNING`, not `FAIL`**.

## Stable identifiers

| Role | Value |
|------|--------|
| Internal park id (`X-Park-Id`) | `0519e1e9-9866-481e-b54d-2b81836ff4a2` |
| ThemeParks external **park** id | `639738d3-9574-4f60-ab5b-4c392901320b` |
| WODAN external **entity** id | `686c3cc3-3b30-4033-b245-e0856737bb26` |
| Outdoor coaster ML profile id (seed) | `b0000001-0000-4000-8000-000000000001` (`OUTDOOR_COASTER_HIGH_CAPACITY`) |

## Expected pipeline

1. **Ingest** — `ride_wait_time_samples` for `provider=themeparks_wiki` and the entity id above.
2. **Ride master** — `ride_master_data.theoretical_capacity_pph` > 0 and `weather_sensitive` aligned with outdoor exposure (capacity heuristics + weather path).
3. **Feature store** — `POST /api/v1/ai/forecasts/refresh` or the AI orchestrator builds `ride_feature_snapshots_5m` (rolling 15m/60m from samples when enough data exists).
4. **ML** — Active `asset_ml_profile_assignment` with `OUTDOOR_COASTER_HIGH_CAPACITY`; smoke can `PUT /api/v1/ai/assets/{assetId}/ml-profile` when none exists, then refresh (unless `ASSIGN_ML=0` / `AUTO_REFRESH=0`).
5. **Forecast** — `GET /api/v1/ai/parks/{externalParkId}/entities/forecast/summary?provider=themeparks_wiki` includes WODAN with `forecast15Minutes`, `forecast60Minutes`, `forecastSource`, `confidence`, `topInfluencingFactors`, `forecastDataQualityStatus`, and `featureDataQuality` hints when externals are missing.

## WODAN-specific expectations (vs generic indoor / dark ride)

- **Effective ML profile** — `OUTDOOR_COASTER_HIGH_CAPACITY` with `weatherSensitive` and `rainSensitive` true in the profile payload.
- **Capacity** — `snapshotContext.capacity.theoreticalCapacityPph` or a capacity/throughput-related influencing factor.
- **Staffing** — `snapshotContext.staffing.staffingGapNormal` when the park heuristic provides it; at most one staffing-named factor after dedupe in `topInfluencingFactors`.
- **Data quality** — Missing or partial weather must surface as **`WARNING`** (and `featureDataQuality` hints), **never** `FAIL` / `FAILED` on `forecastDataQualityStatus` for that scenario.

## Automated smoke

From repo root (Postgres reachable; API optional for DB-only partial pass):

```bash
npm run smoke:wodan-e2e
```

Env:

- `API_URL` — default `http://127.0.0.1:3000`
- `SKIP_WAIT=1` — skip `/api/v1/ai/health` wait
- `AUTO_REFRESH=1` — call `POST /api/v1/ai/forecasts/refresh` when no snapshots (or after new ML assign when `AUTO_REFRESH` is not `0`)
- `ASSIGN_ML=0` — skip `PUT` ML profile assignment
- `INTERNAL_PARK_ID`, `EXTERNAL_PARK_ID`, `EXTERNAL_ENTITY_ID` — overrides
- `OUTDOOR_COASTER_PROFILE_ID` — override default outdoor profile UUID

Exit codes: `0` pass, `1` assertion failure, `2` API unreachable during wait (when `SKIP_WAIT` is not set).

## Manual UI check

1. Select Europa-Park (`X-Park-Id`).
2. **AI Insights → Ride forecast grid** — search “WODAN”.
3. Open detail — confirm +15/+60, confidence, source, top factors, data quality list, and when weather is incomplete the **warning** treatment (not a hard failure state on the row).
