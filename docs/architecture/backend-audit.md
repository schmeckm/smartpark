# Smart Park OS — Backend architecture audit (Phase 1)

**Scope:** Documentation-only snapshot for Phase 1 (no breaking API or schema removals).  
**Date:** 2026-05-04  
**Stack:** Node.js, Express, Sequelize, PostgreSQL; Vue admin; MQTT/UNS; adapter pipeline.

## 1. Executive summary

The backend follows a sensible ingestion direction (**adapters → canonical inbound messages → feature snapshots → boards/ML**), but growth has introduced **parallel concepts**: legacy `zones`/`rides` alongside **platform** `parks`/`park_assets`, and **multiple route mount styles** (`src/routes/v1/index.js` vs direct `app.use` in `src/app.js` for visit plans, staff, master-data, and some integration routes). OpenAPI historically lagged some live routes; Phase 1 closes part of that gap.

**Target direction (later phases):** a thin **operations facts** read layer (see `src/services/operations/operations-facts.service.js`) so Add-on Board, SQDC, and ML consumers share stable read paths without duplicating KPI assembly.

## 2. Route inventory (main API)

| Mount | File | Notes |
|-------|------|--------|
| `/api/v1` | `src/routes/v1/index.js` | Core v1 router + Swagger UI |
| `/api/v1/visit-plans`, `/api/v1/visit-actuals` | `src/app.js` | Root-mounted for proxy reliability |
| `/api/v1/staff`, `/api/v1/master-data` | `src/app.js` | Same pattern |
| `/api/v1/adapters` | `src/app.js` | Adapter operations center |
| Select POST/GET integrations & AI feature-store | `src/app.js` | Duplicate registration for proxy stacks |

**Module routers** (still under `/api/v1`): `uns`, `mdm`, `parks`, `assets`, `observations`, `park-rides`, `sync`, `templates`, etc. — see `index.js`.

## 3. Service clusters

- **Canonical / adapters:** `canonical-inbound-message.service.js`, `canonical-message-apply.service.js`, `adapter-runtime.service.js`, `ingestion.service.js`, …
- **Feature store / ML:** `ai-feature-store.service.js`, `ml/*`, `ml-forecast-layer.service.js`, …
- **Boards:** `addon-board.service.js`, `sqdc-board.service.js`, `sqdc.service.js`
- **Operations (new):** `operations/operations-facts.service.js` — safe wrappers with fallbacks; boards **not** refactored onto it yet in Phase 1.

## 4. Data stores (high level)

- **Master:** `parks`, `park_zones`, `park_assets`, MDM tables, legacy `zones`/`rides` (deprecation strategy TBD).
- **Canonical:** `canonical_inbound_messages`
- **Time-series / snapshots:** `ride_feature_snapshots_5m`, `park_feature_snapshots_5m`, `ride_wait_time_samples`
- **SQDC:** `sqdc_*` tables
- **ML registry:** `ml_model_registry` (+ legacy `ml_model_versions` / forecasts — rationalize later)

## 5. Phase 1 deliverables (this release)

| Item | Location |
|------|----------|
| Source-of-truth matrix | `docs/architecture/source-of-truth.md` |
| Read-path indexes (additive) | `src/migrations/20260525120000-phase1-read-path-indexes.js` |
| Operations facts service (no board wiring) | `src/services/operations/operations-facts.service.js` |
| Tests | `src/services/operations/operations-facts.service.test.js` |
| OpenAPI gaps | `src/openapi/openapi.yaml` (SQDC, incidents, platform settings, visits, adapters, readiness) |
| Readiness | `GET /api/v1/health/ready` |

## 6. Follow-up (not Phase 1)

- Unify all mounts under one router story.
- Deprecate writes to legacy `rides`/`zones` where platform is authoritative.
- Expand `operations-facts` with park-level aggregates and wire Add-on Board / SQDC incrementally.
- Optional: `GET /api/v1/ml/operations-status` if product still requires it — verify branch and document.
