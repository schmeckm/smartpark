# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) where versioning applies.

## [Unreleased]

### Stabilization (Phase Q baseline)

- **Validation:** Full backend `npm test` (unit tests + RBAC sync + Express route list harness), `admin-dashboard` `vue-tsc -b --noEmit`, `npm run audit:routes` (route inventory + OpenAPI gap report), and successful parse of `src/openapi/openapi.yaml`.  
- **Docs:** Architecture ADR [`docs/architecture/adr/ADR-0003-signal-preview-service.md`](docs/architecture/adr/ADR-0003-signal-preview-service.md) and **Current baseline after Phase Q** section in [`docs/architecture/ride-master-extensions.md`](docs/architecture/ride-master-extensions.md). No new tables or endpoints in this pass.

### Signal resolution & preview (consolidation)

- **`src/services/signal-preview.service.js`:** single read-only resolver for signal metadata state, usage eligibility (`board` / `ml` / `green` / `generic`), latest value (same chain as Phase I: `uns_latest_states` → canonical inbound → `ride_feature_snapshot`), normalized **`status`**, and optional **`signalPreview`** payloads. Lookup failures return **`latestValue: null`** and log a warning; APIs stay **200**.
- **Refactors:** `addon-board-widget-source.service.js`, `addon-board-ride-custom-widgets.service.js`, and ML draft validation (`assertMlEligibleSelections` in `ai-studio-feature-draft.service.js`, implemented in signal-preview) delegate to this layer to remove duplicated resolution logic. Existing **`resolved`**, **`latestValue`**, and **`health`** contracts unchanged; **`signalPreview`** is additive on widget draft **GET** and custom-widget list/PATCH payloads.
- **Tests:** `signal-preview.service.test.js` (status precedence, board/ML paths, disabled/missing/entity mismatch/no value/lookup failure); existing Add-on Board and AI Studio tests updated for the new module boundary.
- **OpenAPI:** `SignalRuntimePreview` schema + optional `signalPreview` on draft preview and custom widget objects; alignment pass clarifies **POST** promote (**base** widget only, no preview fields), **PATCH** response (matches **GET** enrichment including optional `signalPreview`), and **PUT** feature-drafts (shared validation, no `signalPreview` in responses).
- **Not in this release:** automatic ML routing, KPI engines, Green optimization, frontend MQTT, or new governance tables.

### Documentation & validation

- **Phase E.1:** Optional Playwright spec and manual checklist for MDM ride signal metadata (open ride → edit → save → reload → verify persistence). See [`docs/validation/mdm-ride-signal-metadata-e2e.md`](docs/validation/mdm-ride-signal-metadata-e2e.md).

### UNS & ride master extensions (Phases A–E)

- **Phase A — UNS topic layout:** Domain allowlist and topic-layout rules used by UNS and extension metadata (`docs/architecture/uns-topic-layout.md`).
- **Phase B — Storage & helpers:** Normalized JSON under `mdm_rides.extensions` and `park_assets.master_profile.unsAssetExtensions` (`domains`, `signals` keyed as `domain.metric`, `capabilities`); merge/read helpers in `ride-master-extensions.service.js`.
- **Phase C — Read API:** `GET /api/v1/mdm/rides/:id/extensions` and `GET /api/v1/assets/:assetId/extensions` with RBAC (`rides.read`), 404 for unknown entities, stable read DTO.
- **Phase D — Admin visibility (read-only):** `SignalsCapabilitiesPanel` on MDM ride detail, platform ride master editor, and Master Data **Signals & caps** tab.
- **Phase E — Admin editing:** `PATCH` on the same extension paths (`rides.update`), Joi validation (`SUPPORTED_DOMAINS`, signal key shape), `mergeExtensions` persistence, panel **editable** mode with Save/Discard and `replaceSignals` on save.

Phases B–E are **metadata only**; Add-on Board, ML Studio, and Green KPI are not activated from these flags in this release line.

### Add-on Board — Phase F (signal source picker)

- **`BoardSignalSourcePicker.vue`:** Loads **`GET .../extensions`** (same as Phase C; no new backend). Lists only signals with **`enabled` and `boardEligible`**, grouped by domain, emits `signalKey` / `v-model`. Empty state when none qualify.
- **Integration:** Add-on Board **L3 (Ride)** custom signal widgets block behind **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER=true`** (`addonBoardSignalSourcePickerEnabled`; build-time **rollback** only). Uses **`park_asset`** + board **`rideId`** (platform asset id). Picker selection alone is **not persisted** and does **not** change runtime KPIs, MQTT, or ML Studio.
- **QA:** Manual checklist + optional Playwright (`admin-dashboard/e2e/addon-board-signal-picker.spec.ts`, `PLAYWRIGHT_ADDON_BOARD_PICKER` for Vite-injected flag) — [`docs/validation/addon-board-signal-source-picker-qa.md`](docs/validation/addon-board-signal-source-picker-qa.md).

### Add-on Board — Phase G (widget source draft persistence)

- **Storage:** `park_assets.master_profile.addonBoardWidgetSourceDraft` (JSON `{ sourceType: SIGNAL_METADATA, entityType: park_asset, entityId, signalKey }`).
- **API:** `GET` / `PUT /api/v1/addon-board/rides/:rideId/widget-source-draft` with park context; **PUT** requires **`rides.update`** and validates **`enabled` + `boardEligible`** on extensions (**400** `INVALID_WIDGET_SOURCE`), unknown asset **404**. (GET response shape extended in **Phase H** when a draft exists.)
- **UI:** Same **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** block — **Save as widget source**; reload retains draft per asset (preview tile in Phase H).

### Add-on Board — Phase H (widget source preview tile)

- **GET** `.../widget-source-draft` returns **`{ draft, resolved }`** when a draft exists (`resolved.valid` reflects current **`enabled` + `boardEligible`** on extensions); **`data: null`** when absent.
- **UI:** Read-only **preview tile** on L3 (separate from picker) with title **`signalKey`**, domain/metric, status, and warning when no longer eligible — no live KPI values.

### Add-on Board — Phase I (read-only live value preview)

- **GET** `.../widget-source-draft` extends the preview with **`latestValue`** when **`resolved.valid`** is true: scalar + **`unit`**, **`ts`**, **`quality`**, **`source`** from persisted UNS latest state, canonical inbound, or ride feature snapshot (same read path as registry preview dry-run; **no raw MQTT** in this handler). **`latestValue: null`** when nothing is stored, the draft is invalid, or lookup fails (response stays **200**; failures logged at **warn**).
- **UI:** Same **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** gate — L3 preview tile shows the live scalar when present, otherwise **“No live value available yet.”** Invalid-draft warning unchanged. Does **not** change Add-on Board KPI runtime.
- **Contract:** OpenAPI **`AddonBoardWidgetSourceLatestValue`** + controller/service tests.

### Add-on Board — Phase J (promote draft → persisted custom widget)

- **Storage:** `park_assets.master_profile.addonBoardCustomWidgets` — array of normalized widget configs (`widgetId`, `title`, `source`, `display`, `enabled`); metadata only, same asset scope as the draft.
- **API:** **`GET /api/v1/addon-board/rides/:rideId/custom-widgets`** (`rides.read`) returns **`{ widgets }`**. **`POST /api/v1/addon-board/rides/:rideId/widgets/from-source-draft`** (`rides.update`) requires a saved draft and **`resolved.valid`**; upserts by **`widgetId`** (**201**). Errors **`DRAFT_MISSING`**, **`DRAFT_NOT_VALID`**, **`DRAFT_ENTITY_MISMATCH`** (**400**). Does not modify JSON board templates or standard KPI tiles.
- **UI:** Same feature flag — **Promote to board widget** when the preview is valid; **Custom widgets** list under L3. Preview tile unchanged.
- **Contract:** OpenAPI **`AddonBoardRideCustomWidget`** + service/controller tests; route inventory regenerated.

### Add-on Board — Phase K (L3 custom widget read-only tiles)

- **API:** **`GET .../custom-widgets`** returns each enabled **`SIGNAL_METADATA` + `latest_value`** widget with **`resolved`** and **`latestValue`** (shared **`resolveSignalMetadataLatestPreview`** path as Phase I; **`sourceEntityMismatch`** when stored **`entityId`** ≠ path ride). No new MQTT or KPI engine.
- **UI:** Same **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** — **Custom widgets** grid tiles (title, value, unit, ts, source, quality); empty-state copy when no row; invalid-source and entity-mismatch warnings.
- **Contract:** OpenAPI **`AddonBoardRideCustomWidget`** extended; service/controller tests; QA checklist step 15.

### Add-on Board — Phase L (custom widget lifecycle)

- **API:** **`PATCH /api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId`** (`rides.update`) — **`title`** and/or **`enabled`** only; **400** `INVALID_CUSTOM_WIDGET_PATCH`; **404** `CUSTOM_WIDGET_NOT_FOUND` / `ASSET_NOT_FOUND`. **`DELETE`** same path — **204**; same 404s. **`source`** / **`display`** rejected in patch body.
- **UI:** Same feature flag — per-tile **rename**, **enabled** checkbox, **remove** (confirm), reload list after each action.
- **Contract:** OpenAPI **`AddonBoardCustomWidgetPatch`** + paths; validator/service/controller tests; QA step 16; architecture Phase L.

### Add-on Board — Phase M (custom widget health)

- **API:** **`GET`/`PATCH`** custom widget payloads include derived **`health`** (`ok`, `invalid_source`, `disabled`, `no_live_value`, `entity_mismatch`) from existing Phase K fields only — no new storage or latest-value logic changes.
- **UI:** Same **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** — summary strip (totals + OK / invalid / disabled / no live value) and per-tile health badge.
- **Contract:** OpenAPI **`AddonBoardRideCustomWidget.health`**; `deriveCustomWidgetHealth` unit tests; QA step 17; architecture Phase M.

### Add-on Board — Phase N (stabilize custom signal widgets)

- **UI:** L3 copy uses **custom signal widgets** wording (no “experimental” framing). Short help plus an info banner: approved signal metadata from ride master data. Panel styling aligned with stable operations chrome (same **`VITE_ADDON_BOARD_SIGNAL_SOURCE_PICKER`** **rollback** switch: `false` / omit hides UI; data in DB unchanged).
- **RBAC:** Unchanged — **`rides.read`** for picker, draft **GET**, custom-widget **GET** tiles; **`rides.update`** for draft **PUT**, promote **POST**, and tile **PATCH**/**DELETE** (read-only users see tiles but not write controls).
- **Docs:** README, admin-dashboard **`.env.example`**, architecture (**Phase N**), validation QA (**Phase N** / read-only note); **`featureFlags.ts`** comment documents rollback semantics.

### ML Studio — Phase O (extension ML signal picker)

- **UI:** Reusable **`MLSignalSourcePicker.vue`** — loads existing **`GET .../extensions`** for **`ride`** or **`park_asset`**; filters **`enabled` + `mlEligible`**; groups by domain; empty state when none. Integrated on **AI Studio → Datasets** as **Extension ML feature candidates** (local draft **`signalKey`** only — no training, snapshot, MQTT, or Green changes).
- **Docs:** Architecture **Phase O**; manual QA [`docs/validation/ml-studio-signal-picker-qa.md`](docs/validation/ml-studio-signal-picker-qa.md); **en/de** `mlSignalPicker` + `aiStudio.mlSignalPicker*` strings.

### ML Studio — Phase P (persist feature draft metadata)

- **API:** **`GET /api/v1/ai/studio/feature-drafts`** (`ai.read`, park context) — query **`entityType`** (`ride` \| `park_asset`), **`entityId`**, **`datasetScope`** (default **`single_asset`**); returns saved draft or **`data: null`**. **`PUT`** same path (`ai.refresh`) — body **`{ entityType, entityId, datasetScope?, selectedSignalKeys[] }`**; each key must exist on extensions with **`enabled`** and **`mlEligible`** (**400** `INVALID_ML_FEATURE_DRAFT`); unknown entity **404** (`NOT_FOUND` / `ASSET_NOT_FOUND`).
- **Storage:** JSON under **`app_settings`** key **`aiStudio.featureDrafts`**, namespaced by park and composite key (no new table; no snapshot / training / MQTT changes).
- **UI:** Multi-select picker, **Save feature draft**, server **saved** summary + timestamp; reload loads persisted keys.
- **Docs/tests:** OpenAPI paths + schemas; **`ai-studio-feature-draft.service.test.js`** (validation helpers); QA doc updated; **CHANGELOG**; architecture **Phase P**.
