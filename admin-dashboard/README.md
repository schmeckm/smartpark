# Smart Park OS — Admin dashboard

Vue 3 + TypeScript + Vite operations UI for Smart Park OS.

**Forecast architecture (normative):** backend ADR **[`docs/adr/0001-forecast-architecture.md`](../docs/adr/0001-forecast-architecture.md)** — the dashboard must call Forecast APIs only; do not compute parallel forecasts in the UI.

## Features

- **Live crowd heatmap** — zone utilization with color pressure and forecast readout
- **Rides table** — status, wait times, throughput, criticality
- **Staff allocation board** — roster columns per zone plus unassigned pool
- **Recommendations** — priority badges, accept / reject / done (PATCH to API)
- **WebSocket** — `zones:updated`, `events:created`, `recommendations:created`, `recommendations:updated` via Socket.IO client

## Development

1. Start the Smart Park OS API (e.g. `docker compose up` or `npm run dev` at repo root on port **3000**).
2. From this folder:

```bash
npm install
npm run dev
```

3. Open **http://localhost:5173**. Vite proxies `/api/v1/*` and `/socket.io` to the backend.

## Production build

Set **`VITE_API_URL`** to the public origin of the API (no trailing slash), then:

```bash
npm run build
npm run preview
```

Serve `dist/` from any static host; the browser must reach the API origin for REST and Socket.IO (configure CORS on the API accordingly).

## E2E (Playwright)

First-time setup downloads browser binaries:

```bash
npx playwright install
npm run test:e2e
```

- **`tests/e2e/uns-hub.spec.ts`** — UNS hub smoke (runs against a live API + dev server).
- **`tests/e2e/mdm-ride-extensions.spec.ts`** — MDM ride **Signals & capabilities** save/reload persistence; the suite is **skipped** until you set **`E2E_MDM_RIDE_ID`**. See **[`../docs/validation/mdm-ride-signal-metadata-e2e.md`](../docs/validation/mdm-ride-signal-metadata-e2e.md)** for env vars and a manual checklist.
- **`tests/e2e/addon-board-signal-picker.spec.ts`** — Add-on Board L3 **custom signal widgets** picker + ride-change behavior (Phases **F+**); deeper flows (draft save, preview, promote, tiles, health) are in **[manual QA](../docs/validation/addon-board-signal-source-picker-qa.md)**. Skipped unless **`E2E_ADDON_BOARD_PARK_ID`** + **`E2E_ADDON_BOARD_RIDE_ID`**. With **`PLAYWRIGHT_START_WEB_SERVER=1`**, set **`PLAYWRIGHT_ADDON_BOARD_PICKER=1`** so Vite gets **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true`** (UI **rollback** switch on for the test). See the same QA doc for **`rides.read`** vs **`rides.update`** expectations.
