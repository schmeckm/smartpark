# MDM ride signal metadata — manual & Playwright validation (Phase E.1)

This document is the **minimal validation layer** for editing **ride-level** UNS extension metadata (domains, capabilities, signal flags) from the admin UI. It does **not** cover Add-on Board, ML Studio, or Green KPI runtime behavior.

## Preconditions

- API reachable from the browser (e.g. backend on `http://localhost:3000`, Vite dev server proxying `/api` — see root `README.md`).
- Admin dashboard running (e.g. `cd admin-dashboard && npm run dev`).
- A user with **`rides.update`** (default E2E admin matches `admin-dashboard/e2e/uns-hub.spec.ts` env overrides).
- A valid **MDM ride UUID** that exists in the environment under test.

## Manual checklist

1. **Open ride master data**  
   Navigate to **`/mdm/rides/<rideUuid>`**. Confirm the page loads and the **Signals & capabilities** heading is visible.

2. **Edit signal metadata**  
   In the panel (editable when you have `rides.update`): add a test signal key in **`domain.metric`** form (e.g. `queue.e2e_manual_check`) via **New signal key** + **Add signal**, or toggle a capability / domain checkbox.  
   Use only supported domains — see `UNS_EXTENSION_DOMAINS` in `admin-dashboard/src/lib/unsExtensionDomains.ts` (must match backend `SUPPORTED_DOMAINS`).

3. **Save**  
   Click **Save** in the signal panel (not **Save all** in the JSON section below). Expect a success toast (**Signal metadata saved.**).

4. **Reload**  
   Hard refresh the browser (`Ctrl+Shift+R` / `Cmd+Shift+R`) or navigate away and back to the same ride URL.

5. **Verify persisted values**  
   Confirm the same signal row (or capability / domain choices) still appear in read-only or editable view. Optionally confirm via `GET /api/v1/mdm/rides/<rideUuid>/extensions`.

## Optional Playwright test

The spec **`admin-dashboard/e2e/mdm-ride-extensions.spec.ts`** automates the same flow using a **unique** `queue.e2e_pw_<timestamp>` signal key (add → save → reload → expect text).

### Environment variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `E2E_MDM_RIDE_ID` | **Yes** for the MDM extensions test | Existing MDM ride UUID. If unset, the test is **skipped** so CI stays green without seed data. |
| `E2E_ADMIN_EMAIL` | No | Defaults per `uns-hub.spec.ts`. |
| `E2E_ADMIN_PASSWORD` | No | Defaults per `uns-hub.spec.ts`. |
| `PLAYWRIGHT_BASE_URL` | No | Default `http://localhost:5173`. |
| `PLAYWRIGHT_START_WEB_SERVER` | No | Set to `1` to let Playwright start Vite (see `playwright.config.ts`). |

### Command

Install Playwright browsers once per machine (`npx playwright install` from `admin-dashboard/` if you see “Executable doesn't exist”).

```bash
cd admin-dashboard
set E2E_MDM_RIDE_ID=<your-uuid>   # Windows cmd
# export E2E_MDM_RIDE_ID=<your-uuid>   # Unix
npm run test:e2e -- e2e/mdm-ride-extensions.spec.ts
```

The test leaves a harmless `queue.e2e_pw_*` row in extensions until someone removes it; that is acceptable for smoke environments.

## Related architecture

- [`docs/architecture/ride-master-extensions.md`](../architecture/ride-master-extensions.md) — full Phase B–E contract and UI behavior.
