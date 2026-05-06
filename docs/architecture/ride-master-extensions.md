# Ride / asset master extensions (Phases B–H)

## Purpose

Phase B adds a **small, additive JSON metadata** area for **per-ride / per-asset signal hints** (enabled flags, future ML/board eligibility booleans, coarse capability switches). This is **metadata preparation only**: it does not replace runtime UNS behavior, MQTT encoding, or any consumer routing.

## Canonical models

| Layer | Canonical row | Storage |
| ----- | -------------- | ------- |
| Enterprise platform | **`park_assets`** (`ParkAsset`) | `master_profile` JSONB, nested key **`unsAssetExtensions`** |
| MDM | **`mdm_rides`** (`MdmRide`) | Top-level **`extensions`** JSONB column (same JSON shape as the nested value above) |

Parks (`parks.master_profile`) may reuse the same nested key if park-level defaults are needed later; Phase B focuses on assets and MDM rides.

Existing rows with empty `master_profile` or `extensions` behave as **no configuration**: helpers return a **normalized empty document** and signal gates default to **disabled / ineligible** so consumers do not crash.

## JSON shape (schema version 1)

```json
{
  "schemaVersion": 1,
  "domains": ["operations", "queue", "green"],
  "signals": {
    "queue.wait_time_min": {
      "enabled": true,
      "mlEligible": true,
      "boardEligible": true
    }
  },
  "capabilities": {
    "hasQueueSignal": true,
    "hasCycleSignal": true,
    "hasEnergyMetering": false,
    "supportsGreenOptimization": false
  }
}
```

- **`domains`**: Optional hint list; values are normalized to the UNS topic-layout domain allowlist (`operations`, `queue`, `green`, `maintenance`, `weather`, `guestflow`, `staffing`, `safety`). Unknown entries are dropped.
- **`signals`**: Map keyed by **`domain.metric`** style keys (e.g. `queue.wait_time_min`). Missing keys imply **not enabled** / **not eligible** for gated reads.
- **`capabilities`**: Coarse booleans for UX or future automation; not wired to Add-on Board, ML Studio, or Green KPI logic in Phase B.

## Service

`src/services/ride-master-extensions.service.js` exposes:

- `getExtensions(rideOrAsset)`
- `mergeExtensions(rideOrAsset, patch)` — returns a **normalized** full document; callers persist it under `master_profile.unsAssetExtensions` or `mdm_rides.extensions`.
- `getSupportedDomains`, `getSignals`, `isSignalEnabled`, `isSignalMlEligible`, `isSignalBoardEligible`
- `withUnsExtensionsOnMasterProfile(masterProfile, extensionsDoc)` — merges the nested key into a copy of `masterProfile` (does not write the DB).

Constants: `UNS_ASSET_EXTENSIONS_KEY` (`unsAssetExtensions`).

Invalid or partial JSON is coerced; **helpers do not throw** on bad data (normalization runs inside a safe path).

## Phase C — read-only HTTP API

Admin UI and other consumers can load normalized metadata **without** touching MQTT encoders, signal registry tables, or board/ML routing.

| Method | Path | Source |
| ------ | ---- | ------ |
| `GET` | `/api/v1/mdm/rides/:id/extensions` | `MdmRide.extensions` |
| `GET` | `/api/v1/assets/:assetId/extensions` | `ParkAsset.master_profile.unsAssetExtensions` |

- **Auth / RBAC:** `rides.read` (same family as ride/asset detail).
- **404:** Unknown MDM ride id or unknown `park_assets.asset_id`.
- **200 with empty shapes:** No extensions configured; response still includes `domains: []`, `signals: {}`, and default **false** capability flags after normalization.
- **Envelope:** `{ "success": true, "data": { ... } }` where `data` matches the read DTO from `toReadApiPayload()` (`entityType`, `entityId`, `domains`, `signals`, `capabilities`). `entityType` is `ride` for MDM rows and `park_asset` for platform assets.

OpenAPI: `src/openapi/openapi.yaml` — paths `/mdm/rides/{id}/extensions` and `/assets/{assetId}/extensions`, schemas `RideMasterExtensionsRead` / `EnvelopeRideMasterExtensionsRead`.

Phase C introduced **read-only GETs** for these paths. **Phase E** adds validated **PATCH** (see Phase E below); older master-data JSON editors remain separate.

## Phase D — admin UI (read-only visibility)

The admin dashboard shows **Signals & capabilities** using the Phase C endpoints only (no new write APIs).

| UI surface | Component | `entityType` / endpoint |
| ---------- | --------- | ------------------------ |
| MDM ride detail | `MdmRideDetailView.vue` → `SignalsCapabilitiesPanel` | `ride` → `GET /api/v1/mdm/rides/:id/extensions` |
| Platform ride master editor | `PlatformRideMasterEditorView.vue` | `park_asset` → `GET /api/v1/assets/:assetId/extensions` |
| Master Data drawer (attractions, shows, restaurants, shops) | New drawer tab **Signals & caps** | `park_asset` + selected row `assetId` |

Component: `admin-dashboard/src/components/masterdata/SignalsCapabilitiesPanel.vue`

- **Domains:** rendered as badges from `data.domains`.
- **Capabilities:** four booleans with Yes/No styling (`hasQueueSignal`, `hasCycleSignal`, `hasEnergyMetering`, `supportsGreenOptimization`).
- **Signals table:** columns Signal key, Domain, Metric (split on first `.` in the key), Enabled, Board eligible, ML eligible, **Green relevant** (true when domain segment is `green`).
- **Empty state (200, no configured metadata):** “No signal metadata configured yet.”
- **404:** in-panel message “No extension metadata found for this asset.” — the rest of the parent screen still loads independently.
- **Other HTTP errors:** toast `warning`; panel stops loading without throwing.

i18n namespace: `signalsCapabilities.*` (`en`, `de`, `fr`, `es`).

### Manual QA (no unit test runner in admin-dashboard)

Admin-dashboard uses Playwright for e2e only; there is no Vitest/Jest setup for Vue SFCs. After `npm run dev` (UI) + API running with migrations:

1. **MDM ride:** open `/mdm/rides/:id` for a real ride UUID — panel should load or show empty / 404 message without breaking the JSON editors.
2. **Platform asset:** open ride master editor for a platform asset UUID — same checks.
3. **Master Data:** Master Data → Attractions (or Shows / Restaurants / Shops) → open an asset drawer → tab **Signals & caps** — should match `/assets/:id/extensions` for that `park_assets.asset_id`.
4. **404 simulation:** use a random UUID in the MDM URL — page shell loads; panel shows the 404-specific copy.
5. **Optional:** seed `unsAssetExtensions` or `mdm_rides.extensions` JSON and confirm badges, capability chips, and table rows match the API.
6. **Phase E (edit):** With `rides.update`, open the same surfaces with **Save / Discard**; change domains, capabilities, and signals; confirm `PATCH` returns 200 and reload shows persisted values. Try an invalid signal key and confirm HTTP 400.

## Phase E — PATCH API and admin editing

| Method | Path | Permission |
| ------ | ---- | ----------- |
| `PATCH` | `/api/v1/mdm/rides/:id/extensions` | `rides.update` |
| `PATCH` | `/api/v1/assets/:assetId/extensions` | `rides.update` |

- **Body:** Partial patch merged with `mergeExtensions` on the server, then persisted (`mdm_rides.extensions` or `park_assets.master_profile.unsAssetExtensions`).
- **Validation (HTTP 400, `INVALID_EXTENSIONS_PATCH`):** `domains[]` entries must be in `SUPPORTED_DOMAINS`; each `signals` key must match `domain.metric` (slug segments) with `domain` in that allowlist; `replaceSignals: true` requires a `signals` object (may be `{}`). Unknown top-level keys are stripped.
- **Signal map replace:** Send `replaceSignals: true` and a full `signals` object to replace the entire map (used by the admin UI on save). Omit `replaceSignals` (or set `false`) to deep-merge per-key; send `null` for a signal value to remove that key.
- **Response:** `{ success: true, data: <normalized read DTO> }` (same shape as GET).

**UI:** `SignalsCapabilitiesPanel` accepts optional prop `editable` (default `false`). When `editable` is true and the user has `rides.update`, editors and Save/Discard are shown; saves use `replaceSignals: true` with the full draft signal map. No MQTT, registry, board, or ML activation is performed.

**Validation (Phase E.1):** Optional Playwright coverage and a manual checklist live in **[`docs/validation/mdm-ride-signal-metadata-e2e.md`](../validation/mdm-ride-signal-metadata-e2e.md)** (save → reload → persisted signal row).

## Phase F — Add-on Board signal source picker (admin, metadata only)

- **Component:** `admin-dashboard/src/components/addon-board/BoardSignalSourcePicker.vue` — loads the **same GET extension endpoints** as Phase C (no dedicated `source-candidates` API). Surfaces only signals with **`enabled: true`** and **`boardEligible: true`**, grouped by **domain** segment of the key (`domain.metric`).
- **Emits:** `update:modelValue` / `select` with the chosen **`signalKey`** for future widget configuration UIs.
- **Add-on Board L3:** Optional **custom signal widgets** block when **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true`** (build-time **rollback** switch; omit / `false` hides UI only). Passes **`entityType: park_asset`** and the board’s selected **`rideId`** (platform **`assetId`**). Picker selection alone does **not** alter runtime KPIs, MQTT encoders, ML Studio, or Green KPI math.

**Validation:** Add-on Board (Phases F–N) — **[`docs/validation/addon-board-signal-source-picker-qa.md`](../validation/addon-board-signal-source-picker-qa.md)**. ML Studio (Phases O–P) — **[`docs/validation/ml-studio-signal-picker-qa.md`](../validation/ml-studio-signal-picker-qa.md)**.

## Phase G — Add-on Board widget source draft (persisted metadata)

- **Storage:** `park_assets.master_profile.addonBoardWidgetSourceDraft` — JSON object `{ sourceType, entityType, entityId, signalKey }` (same shape as the UI contract). One draft per ride asset; **PUT** replaces it for that asset only.
- **API (park-scoped `X-Park-Id`):**  
  - `GET /api/v1/addon-board/rides/:rideId/widget-source-draft` — **`rides.read`**; `data` is **`null`** when no draft; when a draft exists, **`data`** is **`{ draft, resolved, latestValue }`** (Phase H: `resolved.valid` vs current extensions; **Phase I:** `latestValue` read-only from persisted UNS / canonical / snapshot when `resolved.valid`, else **`null`**). **Phase Q:** optional additive **`signalPreview`** (normalized status + eligibility). **404** if the asset is not in the park.  
  - `PUT` same path — **`rides.update`**; body must match path `rideId` on `entityId`; **`signalKey`** must exist on that asset’s extensions with **`enabled`** and **`boardEligible`** or **400** `INVALID_WIDGET_SOURCE`. Response body remains the flat **`draft`** object.
- **UI:** Still behind **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`**: **Save as widget source** persists the current radio selection; changing rides clears the **unsaved** picker state only; each asset keeps its own draft until overwritten by another save.

## Phase H — Add-on Board widget source preview (read-only)

- **GET enrichment:** When a draft exists, **`data`** includes **`draft`** and **`resolved`** where **`resolved`** contains **`valid`**, **`domain`**, **`metric`**, **`enabled`**, **`boardEligible`** derived from **current** `unsAssetExtensions` for that asset (same rules as save: supported domain + enabled + boardEligible ⇒ `valid: true`).
- **UI:** L3 **preview tile** (separate from the picker) shows **`signalKey`**, source type, entity, domain/metric, status, and flags; if **`valid`** is false, shows **“Saved source is no longer eligible.”** No KPI math or board runtime wiring from this tile.

## Phase I — Add-on Board widget source live preview (read-only scalar)

- **GET:** Same handler adds **`latestValue`** when **`resolved.valid`** is true: **`{ value, unit, ts, quality, source }`** from the same persistence layers as registry-preview dry-run (**`uns_latest_states`** first, then canonical inbound, then ride feature snapshot). **`latestValue: null`** when nothing is stored or lookup fails (HTTP **200** preserved). Invalid drafts do not trigger a lookup. **No raw MQTT** in this path; does not change Add-on Board KPI runtime.
- **UI:** Still behind **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`**. When valid, shows the scalar or **“No live value available yet.”**

## Phase J — Promote draft to persisted L3 custom widget (metadata)

- **Storage:** `park_assets.master_profile.addonBoardCustomWidgets` — JSON **array** of widget objects (`widgetId`, `title`, `source`, `display`, `enabled`). **`widgetId`** is stable from **`signalKey`** (e.g. `signal_queue_wait_time_min`). Re-promoting the same signal **replaces** that entry. Not merged into file-based board templates (`config/addon-board/templates`).
- **API:** **`GET /api/v1/addon-board/rides/:rideId/custom-widgets`** — list for the ride asset. **`POST /api/v1/addon-board/rides/:rideId/widgets/from-source-draft`** — requires existing draft and **`resolved.valid`**; **`rides.update`**. No derived KPI engine, ML Studio, or Green KPI; display intent is **`latest_value`** metadata only.
- **UI:** **Promote to board widget** + **Custom widgets** section on L3 (same Vite flag). Standard layout strip / SWDEC cards unchanged.

## Phase K — L3 custom widget tiles (read-only latest value)

- **GET `.../custom-widgets`:** Each **enabled** row with **`source.sourceType: SIGNAL_METADATA`** and **`display.type: latest_value`** includes **`resolved`** and **`latestValue`** using the same server path as Phase I (**`signal-preview.service`** → UNS latest / canonical / snapshot; **no MQTT** in the handler). **`sourceEntityMismatch: true`** when stored **`source.entityId`** ≠ path **`rideId`** (no live lookup). Optional **`signalPreview`** (Phase Q). Disabled or non-`latest_value` rows return **`resolved` / `latestValue` as `null`** without lookup.
- **UI:** Same **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** gate — **Custom widgets** area renders **read-only tiles** (title, value, unit, timestamp, source, quality); **“No live value available yet.”** when valid but no row; eligibility warning when **`resolved.valid`** is false; entity-mismatch copy when **`sourceEntityMismatch`**. Tiles refresh when **ride detail** reloads on L3. Standard SWDEC / layout KPIs unchanged.

## Phase L — L3 custom widget lifecycle (admin)

- **API (park-scoped, `rides.update`):**  
  - **`PATCH /api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId`** — body may include **`title`** (non-empty string, max 200) and/or **`enabled`** (boolean). At least one field required. **`source`** and **`display`** are **not** accepted (lifecycle only). Response **`{ success, data: { widget } }`** with the same enriched shape as **GET `.../custom-widgets`** (Phase K preview when applicable). **404** `ASSET_NOT_FOUND` / **`CUSTOM_WIDGET_NOT_FOUND`**; **400** `INVALID_CUSTOM_WIDGET_PATCH` for validation failures.  
  - **`DELETE`** same path — removes the widget from **`addonBoardCustomWidgets`**. **204** No Content on success; **404** if asset or widget missing.
- **UI:** Same Vite flag — per-tile **rename** (inline save/cancel), **enabled** checkbox, **remove** with browser confirm; list reloads after each action.

## Phase M — Custom widget health (observability)

- **GET / PATCH widget responses:** Each list row (and PATCH **`data.widget`**) includes derived **`health`**: `ok` | `invalid_source` | `disabled` | `no_live_value` | `entity_mismatch`, computed only from **`enabled`**, **`sourceEntityMismatch`**, **`resolved.valid`**, and **`latestValue`** (Phase K). No new persistence, routes beyond existing list/PATCH, or change to latest-value resolution.
- **UI:** Same Vite flag — strip summary (totals: OK / invalid / disabled / no live value) and a **health badge** per tile.

## Phase N — Stabilize custom signal widgets (admin UX)

- **UI:** Stable product copy (**custom signal widgets**), short in-panel help, and a subtle banner that custom widgets rely on **approved signal metadata** from ride master data. **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** remains the **rollback** switch (not an experiment flag): when disabled, L3 hides picker, draft preview, promote, and tiles; persisted **`master_profile`** data is unchanged.
- **RBAC:** Read-only operators with **`rides.read`** still see picker + draft preview + **GET** custom-widget tiles when the flag is on; **PUT** draft, **POST** promote, and **PATCH**/**DELETE** tiles stay behind **`rides.update`** (same as Phases G–L).

## Phase O — ML Studio extension signal picker (read-only candidates)

- **Component:** `admin-dashboard/src/components/ml/MLSignalSourcePicker.vue` — same **`GET .../extensions`** contract as Phase C (`entityType: ride` → MDM ride id; `park_asset` → platform **`assetId`**). Lists only signals with **`enabled: true`** and **`mlEligible: true`**, grouped by **domain** (`domain.metric` key), emits **`signalKey`** via **`v-model`** / **`select`**.
- **Integration:** **AI Studio → Datasets** — “Extension ML feature candidates” panel: scope **Platform asset** (reuses entity type + **Specific asset** from the tab) or **Ride master** (MDM ride dropdown). Selection is **local UI draft only**; no new persistence, no change to feature snapshot generation, no training pipeline wiring from this picker.
- **Validation:** [`docs/validation/ml-studio-signal-picker-qa.md`](../validation/ml-studio-signal-picker-qa.md).

## Phase P — ML Studio feature draft persistence (metadata)

- **API:** **`GET`/`PUT /api/v1/ai/studio/feature-drafts`** (park context `X-Park-Id`). **`PUT`** validates **`selectedSignalKeys`** against current **`GET .../extensions`** rows (**`enabled` + `mlEligible`** only). Persisted JSON lives in **`app_settings`** under **`aiStudio.featureDrafts`** (per-park map keyed by `entityType:entityId:datasetScope`). **`datasetScope`** today is **`single_asset`** only. Does **not** wire drafts into training, **`ride_feature_snapshots_5m`**, MQTT, or Green KPI.
- **UI:** Multi-select + **Save feature draft** (**`ai.refresh`**); shows last saved keys and **updated** timestamp.
- **Validation:** same QA doc (Phase P steps).

## Phase Q — Unified signal preview layer (runtime read model, read-only)

- **Service:** **`src/services/signal-preview.service.js`** — **`resolveSignalPreview({ parkId, entityType, entityId, signalKey, usage, extensionsRecord, options })`** with **`usage`**: `board` | `ml` | `green` | `generic`. Resolves extensions via **`getExtensions`**, applies usage gates (**`board`** ⇒ **`boardEligible`**; **`ml`** / **`green`** ⇒ **`mlEligible`**; **`green`** reuses ML eligibility until a dedicated Green flag exists), derives a single **`status`** precedence (`entity_mismatch` → `missing_signal` → `disabled` → `not_board_eligible` / `not_ml_eligible` → `no_live_value` → `valid`), and optionally loads **`latestValue`** only through **`readAddonBoardWidgetLatestValue`** (same three persistence layers as Phase I). **No** raw MQTT in the browser, **no** new event bus, **no** automatic ML or KPI pipelines.
- **Consumers:** Add-on Board widget source draft preview and custom-widget enrichment call this module; **`assertMlEligibleSelections`** (ML Studio feature drafts) lives here for a single source of truth. Future Green preview panels and KPI projections can reuse the same contract without changing Phase B–P storage.
- **API additive field:** **`signalPreview`** on **`GET .../widget-source-draft`** (when `data` non-null) and on **`GET`/`PATCH .../custom-widgets`** widget rows — normalized `{ signalKey, domain, metric, eligibility, status, latestValue, entityType?, entityId? }`. Legacy **`resolved`**, **`latestValue`**, and **`health`** remain authoritative for existing UI; clients may ignore **`signalPreview`**.
- **OpenAPI:** **`SignalRuntimePreview`** schema (`src/openapi/openapi.yaml`).

**HTTP surfaces that expose optional `signalPreview` (additive):**

| Method | Path | Notes |
| ------ | ---- | ----- |
| `GET` | `/api/v1/addon-board/rides/:rideId/widget-source-draft` | When `data` is non-null (`AddonBoardWidgetSourcePreview`), includes optional **`signalPreview`**. |
| `GET` | `/api/v1/addon-board/rides/:rideId/custom-widgets` | Each enriched widget row may include **`signalPreview`**. |
| `PATCH` | `/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId` | Response `data.widget` matches **GET** list shape when preview applies. |

**Not exposed here:** **`POST`** promote (`.../widgets/from-source-draft`) returns the persisted **base** widget only (no preview fields until **GET** `.../custom-widgets`). **`PUT`** widget-source-draft returns the draft object only. ML Studio **`GET`/`PUT .../ai/studio/feature-drafts`** uses shared validation only; responses have **no** `signalPreview`.

## Explicitly out of scope (Phases B–Q)

- **Phase Q** adds a **read-only** shared preview resolver and optional **`signalPreview`** JSON only; it does **not** add consumer routing, MQTT subscriptions in the admin app, automatic ML training, or Green KPI math.
- **Normalized signal registry tables** and catalog governance
- **Signal approval workflows**
- **Consumer routing** (MQTT, boards, ML pipelines) — no behavior change
- **Green KPI** business logic
- **Add-on Board** and **ML Studio** **runtime** wiring from extension flags or widget drafts (Phases F–Q: **admin metadata**, draft + preview + **Phase J** custom widget JSON + **Phase K** read-only tile hydration + **Phase L** PATCH/DELETE lifecycle + **Phase M** derived **`health`** + **Phase N** stable UX copy and rollback-documented flag + **Phase O** ML Studio extension picker + **Phase P** persisted **feature draft** JSON in **`app_settings`** + **Phase Q** shared read-only **`signal-preview.service`** only; no automatic widgets, no KPI engine or consumer wiring from drafts, picker, or saved draft keys)
Reversibility: remove nested data or clear `extensions`; optional migration `down` removes `mdm_rides.extensions` if the column is rolled back.

## Current baseline after Phase Q

This section records the **frozen architecture line** after Phases A–Q (final stabilization pass, no new product scope).

- **Metadata storage** remains as in Phases B–E and G–J: `mdm_rides.extensions`, `park_assets.master_profile.unsAssetExtensions`, `addonBoardWidgetSourceDraft`, `addonBoardCustomWidgets`, and **`app_settings`** `aiStudio.featureDrafts` — **no new tables** for signal preview.  
- **Signal Preview Service** is the single read-only place for extension-backed **metadata resolution**, **usage eligibility**, **latest persisted scalar** (UNS latest → canonical inbound → ride feature snapshot), and **normalized preview status** / optional **`signalPreview`** on Add-on Board GETs and ML draft validation (`assertMlEligibleSelections`).  
- **HTTP contracts** for existing routes are unchanged except for **additive** optional `signalPreview` where documented in OpenAPI (`SignalRuntimePreview`). **`resolved`**, **`latestValue`**, and **`health`** remain the primary fields for current admin UI.  
- **Out of scope** for this baseline: KPI engines, ML training, admin MQTT live streams, signal registry/catalog approval workflows, Green optimization, and automatic consumer routing from drafts or preview payloads.  
- **Normative ADR:** [`docs/architecture/adr/ADR-0003-signal-preview-service.md`](adr/ADR-0003-signal-preview-service.md) (see also [`docs/adr/0002-signal-preview-service.md`](../adr/0002-signal-preview-service.md)).
