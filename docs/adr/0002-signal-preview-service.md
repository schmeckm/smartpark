# ADR 0002: Signal Preview Service — shared read-only resolution (RC baseline)

- **Status:** Accepted (release-candidate baseline frozen 2026-05-06)  
- **Date:** 2026-05-06  
- **Context:** Add-on Board and ML Studio need the same interpretation of extension metadata, usage eligibility, latest persisted scalar, and a single health/status model—without duplicating lookup chains or inventing new runtime buses. Green KPIs and Signal Discovery are explicitly out of scope for this ADR.

---

## Decision

**Signal Preview Service** (`src/services/signal-preview.service.js`) is the **shared read-only runtime resolution layer** for:

- Signal metadata derived from ride-master extension JSON (`computeSignalMetadata`, `getExtensions`).
- Optional latest scalar value via existing UNS → canonical inbound → registry preview chain (`readAddonBoardWidgetLatestValue` inside `fetchLatestValueForParkAsset`).
- A **normalized status** enum consumed by HTTP DTOs and the admin dashboard (`deriveUnifiedStatus`, `serializeSignalPreview`).

It does **not** perform MQTT subscriptions in the admin app, automatic ML training, KPI engines, consumer routing, or writes of any kind. Callers remain explicit about `usage`: `board` | `ml` | `green` | `generic`.

---

## Normalized status contract (API-stable for RC)

Statuses returned on previews (when not using legacy-only paths):

| Status | Meaning |
|--------|---------|
| `valid` | Metadata and eligibility gates pass; if latest value was requested, a row was found (or `skipLatestValue` was set). |
| `missing_signal` | Unknown domain prefix, or no extension entry for the key. |
| `disabled` | Entry exists but `enabled` is false. |
| `not_board_eligible` | Board usage but `boardEligible` is false. |
| `not_ml_eligible` | ML/Green usage but `mlEligible` is false. |
| `entity_mismatch` | Draft or widget source does not match the resolved asset entity. |
| `no_live_value` | Metadata OK for lookup path but no latest value row (empty feed, lag, or registry miss)—**not** a hard error. |

Latest-value lookup failures log at **warn** and surface as `no_live_value` or `null` latest value, not 500s, unless an upstream caller maps differently.

---

## Backward compatibility guarantees

1. **Legacy UNS topic layouts:** Preview uses `buildCanonicalUnsTopic` with `domainFromSignalKey` / `metricFromSignalKey`; legacy board resolution remains available on the preview object as `legacy.resolved` for consumers that still expect the older `valid` / `domain` / `metric` / `enabled` / `boardEligible` shape (`buildLegacyBoardResolved`).
2. **Add-on Board:** Widget source draft and custom-widget flows attach **optional additive** `signalPreview` alongside existing `resolved` / `latestValue` fields; absence of the field is valid for older clients.
3. **ML Studio:** `assertMlEligibleSelections` preserves Phase-O semantics (each key must exist on extensions with `enabled` and `mlEligible`). Preview serialization strips `legacy` from outward DTOs via `serializeSignalPreview`.

---

## Security & placement

- Preview logic is invoked **only** from services/controllers that already enforce **park context** and **RBAC** (Add-on Board routes: `rides`/`ops` read or `rides` update; platform/MDM extensions: `rides` read/update).
- No standalone public “signal preview” HTTP route exists; there is nothing to expose outside existing permission models.

---

## Non-goals (explicit)

- Green KPI surfaces, Signal Discovery, ML training orchestration, new persistence tables, or admin MQTT clients.
- Replacing `OperationsFactsService` or board threshold configuration (see ADR 0001 and platform settings registry for those concerns).

---

## Consequences

- New preview or “what would this signal look like?” behavior should extend this module rather than re-implementing `readAddonBoardWidgetLatestValue` or extension parsing in feature services.
- Breaking changes to the preview contract require an **ADR amendment** or a **superseding ADR** tagged to a release.

---

## HTTP exposure (OpenAPI `SignalRuntimePreview`)

- **Additive `signalPreview`:** **GET** `/api/v1/addon-board/rides/:rideId/widget-source-draft` (when `data` non-null), **GET** `/api/v1/addon-board/rides/:rideId/custom-widgets`, and **PATCH** `/api/v1/addon-board/rides/:rideId/custom-widgets/:widgetId` when the handler returns the enriched widget shape.
- **POST** `/api/v1/addon-board/rides/:rideId/widgets/from-source-draft` returns a **base** widget only (no `signalPreview`); clients call **GET** `.../custom-widgets` for preview fields.
- **PUT** `/api/v1/addon-board/rides/:rideId/widget-source-draft` persists the draft; response body is the draft object only (no `signalPreview`).
- **ML feature drafts** (**GET**/**PUT** `/api/v1/ai/studio/feature-drafts`): shared module validates selections only; responses include **no** `signalPreview`.
