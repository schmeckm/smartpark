# Euro-Mir — reference regression case (AI / ML forecast pipeline)

This document pins **Europa-Park → Euro-Mir** (`themeparks_wiki`) as a reproducible end-to-end check for the forecast stack described in [ADR 0001](./adr/0001-forecast-architecture.md).

## Stable identifiers

| Role | Value |
|------|--------|
| Internal park id (`X-Park-Id`) | `0519e1e9-9866-481e-b54d-2b81836ff4a2` |
| ThemeParks external **park** id | `639738d3-9574-4f60-ab5b-4c392901320b` |
| Euro-Mir external **entity** id | `d1bd3846-b26a-4308-aca8-634a248115ba` |

## Expected pipeline

1. **Ingest** — Adapter / canonical path writes `ride_wait_time_samples` (provider `themeparks_wiki`).
2. **Feature store** — `POST /api/v1/ai/forecasts/refresh` or the scheduled **AI orchestrator** (`AI_SAMPLING_ENABLED`, default interval 300s in Docker Compose) runs `buildSnapshots()` → `ride_feature_snapshots_5m` / `park_feature_snapshots_5m` (5m UTC buckets, idempotent upserts).
3. **Forecast** — Ride grid calls `GET /api/v1/ai/parks/{externalParkId}/entities/forecast/summary?provider=themeparks_wiki`. Single-ride detail uses `GET /api/v1/ai/entities/{externalEntityId}/forecast/summary` **with** `externalParkId` query param when the ride has &lt; 4 snapshot buckets (park/type fallback).
4. **ML layer** — `mergeMlEnterpriseLayer` after X-layer; influencing factors are deduped by coarse group (staffing, weather, …).

## Known gaps (dev / demo)

- **Weather / traffic / events** may be missing in park X-layer → `featureDataQuality` hints and `forecastDataQualityStatus: WARNING` while numeric forecasts still return; confidence is nudged down in the X-layer.
- **Rolling 15m / 60m** on snapshots are filled from `ride_wait_time_samples` in the bucket window when samples exist.

## Automated smoke

From repo root (Postgres reachable; API optional for HTTP-only tail of test):

```bash
npm run smoke:euromir-e2e
```

Env:

- `API_URL` — default `http://127.0.0.1:3000`
- `SKIP_WAIT=1` — skip `/api/v1/ai/health` wait (still fails if login/forecast calls error)
- `AUTO_REFRESH=1` — call `POST /api/v1/ai/forecasts/refresh` once if no ride snapshots yet

Exit codes: `0` pass, `1` assertion failure, `2` API unreachable during wait.

## Manual UI check

1. Select Europa-Park (header `X-Park-Id`).
2. **AI Insights → Ride forecast grid** — search “Euro-Mir”.
3. Open detail — confirm +15/+60, confidence, source, top factors, data quality list, and (when applicable) the **“Forecast available, but external features incomplete”** banner.
