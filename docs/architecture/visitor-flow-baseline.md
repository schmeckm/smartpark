# Visitor flow baseline (Phase 0)

This note pins down what the **visitor-flow / process-mining** stack looks like
**today**, before any of the future phases (DFG endpoint, density contract,
camera/UNS ingestion, re-identification) land. It is the contract Phase 1+ will
extend without breaking.

## Goals

- Make the existing event-log pipeline observable, testable, and demoable
  **without** requiring real visitor data or hardware.
- Lock the ingest contract (`POST .../geo/flow/events/batch`) and the read
  contract (`GET .../geo/flow/simulation`) so future phases can plug in.
- Anchor the roadmap (Phase 1 → Phase 7) against a known starting point.

## Data model

```
parks ─┐
       ├── visitor_journey_events ──► park_assets
       │     id              uuid (pk)
       │     park_id         uuid  fk parks.id
       │     case_id         varchar(160)   anonymous trip id
       │     asset_id        uuid  fk park_assets.asset_id
       │     event_type      varchar(40)   ARRIVAL | ZONE_ENTER | ZONE_EXIT | …
       │     occurred_at     timestamptz
       │     source          varchar(64)   ingest | seed | camera-agg | camera-reid | …
       │     payload         jsonb
```

Indexes (`src/migrations/20260519120000-visitor-journey-events.js`):

- `idx_visitor_journey_events_park_occurred (park_id, occurred_at)`
- `idx_visitor_journey_events_park_case_occurred (park_id, case_id, occurred_at)`

The `case_id` is the unit of process mining. It MUST NOT be derived from any
PII; treat it as an ephemeral pseudonym. For phases that involve cameras
(Phase 4+), the camera edge worker generates a salted hash with a rotating
salt and a hash lifetime ≤ 30 minutes — see
[`uns-topic-layout.md`](./uns-topic-layout.md) for the planned topic shape.

`source` is intentionally a free-form short string so each phase can tag its
provenance:

| Phase | `source` value(s) |
|---|---|
| Phase 0 (synthetic seeder) | `seed` |
| Phase 0 (real ingest) | `ingest` (default) |
| Phase 4 (aggregated cameras) | `camera-agg` |
| Phase 6 (re-id tracks) | `camera-reid` |

## HTTP contract

Routes are mounted under `/api/v1/parks/:parkSlug/...` via
`src/modules/platform/platform.routes.js`. Both endpoints accept a park slug
**or** UUID (see `resolveParkRow`).

### `POST /:parkSlug/geo/flow/events/batch`

Ingests one or more journey events.

```json
{
  "events": [
    {
      "caseId": "case-2026-05-08-0001",
      "assetId": "11111111-2222-3333-4444-555555555555",
      "occurredAt": "2026-05-08T09:12:00Z",
      "eventType": "ARRIVAL",
      "source": "ingest",
      "payload": {}
    }
  ]
}
```

- `caseId` is truncated to 160 chars.
- `eventType` defaults to `ARRIVAL`, truncated to 40 chars.
- `source` defaults to `ingest`, truncated to 64 chars.
- `assetId` MUST belong to the park; otherwise the API responds with
  `400 ASSET_NOT_IN_PARK` (the first offending id is included).
- Returns `{ inserted: <number> }` on success.

If the table is missing (migration not run), the controller returns
`503 SCHEMA_MIGRATION_REQUIRED` rather than a Postgres internal error.

### `GET /:parkSlug/geo/flow/simulation`

Reads the flow graph in one of two modes:

| Query | Behavior |
|---|---|
| `mode=synthetic` (default) | Monte-Carlo flow over current geo-pressure proxy |
| `mode=from_log&from=...&to=...` | Aggregates real journey events between `from` and `to` (default last 24 h) |

Response shape (both modes):

```json
{
  "park": { "id": "...", "slug": "...", "name": "...", "latitude": 0, "longitude": 0 },
  "generatedAt": "ISO timestamp",
  "mode": "synthetic_process_mining" | "from_log",
  "parameters": { /* echo of effective inputs */ },
  "nodes": [{ "id": "...", "slug": "...", "name": "...", "entityType": "RIDE", "lat": 0, "lng": 0, "pressureScore": 0 }],
  "edges": [{ "source": "<slug>", "target": "<slug>", "sourceName": "...", "targetName": "...", "value": 0 }],
  "ticks": [{ "step": 0, "label": "Transition 1 (cumulative)", "links": [{ "source": "<slug>", "target": "<slug>", "value": 0 }] }],
  "sampleCases": [[{ "slug": "...", "name": "..." }]],
  "meta": {
    "totalEdges": 0,
    "edgesReturned": 0,
    "transitionsSimulated": 0,
    "guestsSimulated": 0,
    "eventsInWindow": 0,
    "casesInWindow": 0,
    "casesWithPath": 0
  }
}
```

`mode=from_log` returns a `meta.code = "LOG_NO_TRANSITIONS"` envelope (still
HTTP 200) when the time window contains no usable transitions. Phase 1
endpoints (DFG, variants, performance) will reuse the same empty-state
convention so the UI can render uniformly.

`pressureScore` on `from_log` nodes is filled from the **live geo-pressure
snapshot** — the same scoring used by `mode=synthetic`. The visualization
therefore still has operational context (ride load, stress) even when the data
source is the journey log.

## Frontend touch points

- `admin-dashboard/src/views/platform/PlatformVisitorFlowView.vue`
  Tick replay + ECharts force graph + Leaflet overlay. Has an explicit
  "no transitions" empty state with a deep link to the synthetic seeder
  CLI and the ingest endpoint.
- `admin-dashboard/src/views/platform/PlatformAssetMapView.vue`
  Geographic view of assets, wait-time heat, geo-pressure cells, hotspots.
  **Currently does not render flow data.** Phase 1 will add a flow layer.

## Operational tools

### Synthetic seeder

Three equivalent forms (the script accepts all three):

```bash
# 1) Direct node call — works in any shell (recommended for Windows / PowerShell)
node scripts/seed-visitor-journey-events.js --park europa_park --cases 200 --days 1

# 2) Equals form — works through `npm run` even on Windows / PowerShell where
#    `npm run X -- --flag value` may strip the `--flag` tokens.
npm run seed:journey-events -- --park=europa_park --cases=200 --days=1

# 3) Positional fallback — order: park, cases, transitions, days
node scripts/seed-visitor-journey-events.js europa_park 200 7 1
```

Generates realistic-looking case sequences and inserts them with
`source: 'seed'`. See
[`scripts/seed-visitor-journey-events.js`](../../scripts/seed-visitor-journey-events.js)
for arguments and behavior. Idempotent enough for dev use; pass `--clear` to
remove previously-seeded rows for the chosen park before inserting new ones,
or `--dry-run` to preview without writing.

### Manual ingest

```bash
curl -X POST $API/api/v1/parks/europa_park/geo/flow/events/batch \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"caseId":"manual-1","assetId":"...","occurredAt":"2026-05-08T10:00:00Z"}]}'
```

## What Phase 0 explicitly does **not** do

- **No** new endpoint surface (DFG, variants, conformance) — those are Phase 1.
- **No** density contract — the asset map still draws circles from wait time;
  the contract change is Phase 2.
- **No** UNS topic subscriber — Phase 3.
- **No** camera edge worker — Phase 4+.

Phase 0 is purely about closing the gap between "the table exists" and
"the journey-log read path is provably wired end-to-end". Anything beyond
that is a deliberate Phase 1+ choice.

## Roadmap pointer

The full multi-phase plan (DFG → density contract → UNS subscriber → cameras
→ re-id → closed loop) is tracked separately. This document only covers the
Phase 0 contract; future phases extend it without breaking the shapes
documented here.
