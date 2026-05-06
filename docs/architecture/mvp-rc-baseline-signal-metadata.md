# MVP / release-candidate baseline — signal metadata & preview

This document captures the **architecture baseline** for Smart Park OS signal metadata and the **Signal Preview Service** at RC freeze. It is descriptive, not a runtime spec (see ADR 0002 for the normative decision).

## Layering

1. **Authoritative metadata:** Ride-master extension JSON on `park_assets` (platform) and MDM ride rows, validated at PATCH time (`ride-master-extensions-patch.validator.js`).
2. **Read projection:** `ride-master-extensions.service` normalizes `getExtensions` for consumers.
3. **Preview resolution:** `signal-preview.service.js` combines metadata eligibility with optional latest value from `registry-preview.service` / UNS topic construction (`uns-topic-generator.service.js`).
4. **Feature surfaces:** `addon-board-widget-source.service.js`, `addon-board-ride-custom-widgets.service.js`, and `ai-studio-feature-draft.service.js` call preview helpers; they do not reimplement topic or registry logic.

## Compatibility matrix (verified at RC)

| Concern | Mechanism |
|---------|-----------|
| Legacy UNS topic layouts | `legacy.resolved` on preview + canonical topic builder shared with existing UNS docs ([uns-topic-layout.md](uns-topic-layout.md)). |
| Add-on Board | Optional `signalPreview` on draft/widget payloads; RBAC unchanged on `/api/v1/addon-board/*`. QA trace: [../validation/addon-board-signal-source-picker-qa.md](../validation/addon-board-signal-source-picker-qa.md). |
| ML Studio | `assertMlEligibleSelections` unchanged semantics; QA trace: [../validation/ml-studio-signal-picker-qa.md](../validation/ml-studio-signal-picker-qa.md). |

## Graceful degradation (runtime)

| Condition | Behavior |
|-----------|----------|
| Missing metadata / unknown key | Status `missing_signal`; board save paths reject via `assertSignalBoardEligible` where appropriate. |
| Missing live value | Status `no_live_value` when lookup was attempted and allowed; warn log on registry read exception, returns null latest. |
| Invalid signal (bad domain / no entry) | `INVALID_SIGNAL` on board eligibility assert; preview status `missing_signal` or `not_*_eligible` depending on usage. |
| Disabled signal | Status `disabled`; ML draft validation fails with `INVALID_ML_FEATURE_DRAFT` if disabled keys selected. |
| Deleted / unknown asset | HTTP **404** from controllers when the asset or ride row does not exist (before preview); no orphan preview DTOs. |

## Tooling outputs (regenerated on audit)

- Route inventory: `docs/generated/express-routes.inventory.md` (+ `.json`).
- OpenAPI heuristic gap report: `docs/generated/openapi-gap-report.md` (from `npm run audit:routes`).

Signal-related routes touched by this baseline (extensions, widget-source-draft, custom-widgets) are marked **`inOpenApi: true`** in the latest audit table where Express paths match documented templates.

## Feature flags (safe defaults)

Platform boolean/number settings resolve **DB → env → code default** (`platform-settings.service.js`). Registry entries relevant to boards use conservative defaults (e.g. weather adapters default **off**; AI sampling default **on** with bounded interval). No RC signal-preview feature is gated by a separate kill-switch; behavior is metadata-driven.

## Related ADRs

- [ADR 0002 — Signal Preview Service](../adr/0002-signal-preview-service.md)
- [ADR 0001 — Forecast & ML feature architecture](../adr/0001-forecast-architecture.md)
