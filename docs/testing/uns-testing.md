# UNS migration architecture — automated tests

This document describes the UNS governance test layout (Spy, registry mirror, ride capabilities, registry publisher, operations facts, signal deprecation, UNS Hub UI).

## Prerequisites

- Node 20+
- Postgres with migrations applied (`npm run db:migrate`) and default seeds (`npm run db:seed`) for integration/e2e credentials.

## Root package scripts

| Script | Purpose |
|--------|---------|
| `npm test` | RBAC manifest check + Node `--test` unit suite (includes UNS-focused tests). |
| `npm run test:integration` | Opt-in HTTP + Spy DB integration tests under `src/integration-tests/uns/`. |
| `npm run test:e2e` | Delegates to `admin-dashboard` Playwright (`npm run test:e2e --prefix admin-dashboard`). |

## Unit tests (fast, mocked)

| Area | File |
|------|------|
| UNS Spy | `src/services/uns-spy.service.test.js` |
| Ride signal capabilities | `src/services/ride-signal-capability.service.test.js` (+ existing activation / Sparkplug scope tests) |
| Registry publisher | `src/services/registry-publisher.service.test.js` |
| Operations facts | `src/services/operations-facts.service.test.js` |
| Signal deprecation | `src/services/registry-signal-deprecation.service.test.js` |
| Safety regression (static imports) | `src/services/uns-governance-safety.static.test.js` |

Dev dependency: `proxyquire` for isolating Sequelize/MQTT edges without touching runtime connectors.

## Integration tests

Set **`UNS_INTEGRATION_TESTS=1`** and ensure `.env` points at the target database.

Deprecation HTTP shape in production is  
`POST /api/v1/master-data/rides/:rideAssetId/registry-signal-deprecations/deprecate`  
(body includes `signalKey`, optional booleans) — not a `:signalKey` path segment.

- `src/integration-tests/uns/uns-api.integration.test.js` — Supertest against in-process `app` (`require('../app')`): mirror summary RBAC, spy events list, MQTT inbound unknown list, operations facts park header mismatch, deprecate guard on unknown ride.
- `src/integration-tests/uns/uns-mqtt-spy.integration.test.js` — Writes an `mqtt_inbound_messages` row and runs `processInboundMqttRow` so Spy persistence + `GET /api/v1/uns-spy/events` stay aligned **without** starting the MQTT connector.

Shared helper: `src/test-utils/integration-http.js`.

### MQTT simulation helper

`src/test-utils/mqtt-test-publisher.js` opens a standalone `mqtt` client for publishing into the **same broker** the API uses when `MQTT_ENABLED=true`. Use this when the API process is running (`server.js`) with `UNS_SPY_ENABLED=true` to validate broker-fed flows.

The HTTP shortcut `POST /api/v1/uns/test/publish` still requires a connected connector client (`MQTT not connected` otherwise).

**Note:** Valid `tpuns/...` messages are still processed by the connector’s legacy ingestion path (including `uns_latest_states` updates) when that stack is active — Spy observe-only runs in parallel via `mqtt-topic-observer.service.js`.

## Sample SQL fixtures

See `docs/testing/fixtures/uns-integration-sample.sql` for an optional HR_MANAGER-only user pattern used to assert `integrations.read` denial without changing RBAC manifests.

## Playwright (UNS Hub UI)

From `admin-dashboard/`:

```bash
npm install
npx playwright install
```

Run API + Vite (proxy to API), then:

```bash
cd admin-dashboard
npm run test:e2e
```

Environment:

- `PLAYWRIGHT_BASE_URL` — defaults to `http://localhost:5173`.
- `PLAYWRIGHT_START_WEB_SERVER=1` — optional `vite dev` auto-start from `playwright.config.ts`.
- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` — default to seeded `admin@smartpark.com` / `Smartpark123!`.

Tests live in `admin-dashboard/e2e/uns-hub.spec.ts`.

## Scope boundaries (non-goals)

Per product constraints, tests **do not** modify:

- MQTT connector subscription logic,
- ThemeParks sync jobs,
- Registry publisher production branching beyond mocks,
- `uns_nodes` writers,
- `uns_latest_states` writers,

except where already exercised by existing ingestion when running a full stack with MQTT enabled.
