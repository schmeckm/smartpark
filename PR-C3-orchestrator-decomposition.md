# Phase C3 — IntegrationOrchestratorService Decomposition

Decomposes the 1,091-line `IntegrationOrchestratorService` god-class into 8 focused per-context services and turns the legacy file into a thin facade. Removes the two hard-coded `provider === 'themeparks_wiki'` branches and replaces them with an extensible post-ingest hook registry. Adds a final auto-discovering governance gate so any new orchestrator-context module automatically falls under the no-`provider === '<key>'`-branch rule.

## Summary

| Metric | Before | After |
|---|---|---|
| `IntegrationOrchestratorService` LOC | **1,091** | **~300** (facade) |
| Bounded contexts in one class | **9** | **0** (1 per module) |
| Hard-coded `provider === '<key>'` branches in orchestrator | **2** | **0** |
| Mid-function `require('../models')` in orchestrator | **6** | **0** |
| Direct unit tests covering orchestrator logic | **0** | **100+** (across 9 new test files) |
| Governance gates | 5 | **6** (new auto-discovery gate) |
| `npm test` count | 454 | **470** |

The orchestrator's public API is unchanged — every method in the contract test (`REQUIRED_PROTO_METHODS`) is still present, and the constructor is still zero-arg. Controllers, bootstrap, and downstream callers required no changes.

## Commit-by-commit

| Commit | Scope |
|---|---|
| `b92302d` C3.0 | Inventory doc + lock-in contract tests + provider-branch baseline + governance script. **No production code touched.** |
| `c2c5295` C3.1 | Extract `ManualUnsNodeService` (3 methods → delegations) |
| `8c3562d` C3.2 | Extract `ProviderBrowserService` (10 methods + 6 helpers → delegations) |
| `ff5592e` C3.3 | Extract `IntegrationSettingsService` (settings, bootstrap, polling-config) |
| `d456cda` C3.4 | Extract `SparkplugTopicSchemaService` (3 methods + 2 helpers) |
| `c25241f` C3.5 | Inline canonical-message query into `CanonicalInboundMessageService`; controller now calls it directly |
| `c12b509` C3.6 | Extract `UnsTopicSuggestionService` (~190 LOC) |
| `f622cc3` C3.7 | Extract `CanonicalIngestionPipelineService` + `canonical-ingestion-hooks` registry. **Removes the 2 hard-coded `themeparks_wiki` branches.** Provider modules self-register via `canonical-ingestion-hooks.bootstrap.js` |
| `4ae9992` C3.8 | Extract `IntegrationPollingService` (background loop) |
| `f794e37` C3.9 | Slim facade (300 LOC) + final auto-discovering governance gate. Dead imports removed. |

## Architectural impact

### Open/Closed is now satisfied

A new provider:
1. Implements its sync logic in `src/modules/adapters/<provider>/`
2. Self-registers post-ingest hooks via `canonicalIngestionHooks.registerAfterEntities` / `registerAfterLive`
3. Adds one line to `canonical-ingestion-hooks.bootstrap.js`

**No orchestrator code is touched.** This was previously impossible — the orchestrator had hard-coded `if (provider === 'themeparks_wiki')` branches that any new provider would have had to either (a) pile on top of as a second `if` branch, or (b) silently skip the post-ingest work for.

### Auto-discovering governance gate

`scripts/check-orchestrator-provider-branches.mjs` now auto-discovers its scan target list at runtime: every `*.js` file under `src/modules/integrations/orchestrator/` (excluding `*.test.js`) is automatically scanned. **Adding a new orchestrator-context module puts it under the gate without baseline edits.** Adding a `provider === '<key>'` branch fails the build with a clear error pointing to the hook registry as the correct alternative.

Current state: **0 hard-coded provider control-flow branches in 10 auto-discovered file(s).**

## Public API contract preserved

The `integration-orchestrator.service.contract.test.js` lock-in test pins the public API surface. All assertions still pass:

- `IntegrationOrchestratorService` class export: unchanged
- `SETTING_KEYS` export: unchanged (proxy to `INTEGRATION_SETTING_KEYS`)
- Every method in `REQUIRED_PROTO_METHODS`: present and a function
- Constructor: zero-arg, no DB access at construction time
- `bootstrap/registrations/default.js`: unchanged

## Verification

All steps run on every commit (stop-on-red):

```
npm test               -> 470/470 (was 454, +16 net from 9 new test suites)
npm run lint           -> clean
npm run governance:ci  -> all 6 gates green:
  [check:openapi-drift]                       OK
  [check:route-duplicates]                    OK — 6/6 baseline
  [check:root-mount-baseline]                 OK — 73 routes / 13 prefixes
  [check:adapter-keys-baseline]               OK — 5/5 adapter keys
  [check:orchestrator-provider-branches]      OK — 0 branches in 10 files
  [check:openapi-build]                       OK — 282 paths
```

## Backward compatibility

- **No DB migrations.** `SETTING_KEYS` proxies to `INTEGRATION_SETTING_KEYS`; the persisted keys in `app_settings` are unchanged.
- **No route changes.** All HTTP surface is untouched.
- **No frontend changes required.** The admin dashboard's API client is unaffected.
- **No bootstrap changes.** `bootstrap/registrations/default.js` still calls `orchestrator.bootstrap()` and `orchestrator.startPollingIfEnabled()` exactly as before.
- **Hook semantics preserved.** The pipeline wraps each hook in try/catch — a hook failure never blocks canonical ingestion (matches pre-C3.7 behavior).

## Rollback strategy

Each commit C3.0–C3.9 is independently revertible:

- **C3.0** is purely additive (doc + tests + governance script). `git revert b92302d` restores main.
- **C3.1–C3.6, C3.8** each extract one bounded context. `git revert <sha>` restores the orchestrator's inline implementation for that context.
- **C3.7** is the only commit with semantic risk (replaces hard-coded branches with hooks). The themeparks-sync hooks are wired via `canonical-ingestion-hooks.bootstrap.js`; a revert there restores the inline branches.
- **C3.9** is purely cosmetic (dead-import removal + governance gate widening + doc refresh). Safe to revert in isolation.

## Files

### New files

- `src/modules/integrations/orchestrator/manual-uns-node.service.js` (+ test)
- `src/modules/integrations/orchestrator/provider-browser.service.js` (+ test)
- `src/modules/integrations/orchestrator/integration-settings.service.js` (+ test)
- `src/modules/integrations/orchestrator/sparkplug-topic-schema.service.js` (+ test)
- `src/modules/integrations/orchestrator/uns-topic-suggestion.service.js` (+ test)
- `src/modules/integrations/orchestrator/canonical-ingestion-pipeline.service.js` (+ test)
- `src/modules/integrations/orchestrator/canonical-ingestion-hooks.js` (+ test)
- `src/modules/integrations/orchestrator/canonical-ingestion-hooks.bootstrap.js`
- `src/modules/integrations/orchestrator/integration-polling.service.js` (+ test)
- `src/services/integration-orchestrator.service.contract.test.js`
- `scripts/check-orchestrator-provider-branches.mjs` (+ test)
- `docs/governance/orchestrator-provider-branches-baseline.json`
- `docs/architecture/orchestrator-inventory.md`

### Modified files

- `src/services/integration-orchestrator.service.js` — now a 300-line facade
- `src/controllers/integrations.controller.js` — calls `CanonicalInboundMessageService` directly (C3.5)
- `src/modules/adapters/themeparks/themeparks-sync.service.js` — self-registers post-ingest hooks (C3.7)
- `eslint.config.js` — removed orchestrator from `MAX_LINES_ALLOW_LIST`; lazy-require ownership moved from orchestrator to themeparks-sync.service
- `package.json` — added `check:orchestrator-provider-branches` to `governance:ci`

## Test plan

- [x] All 470 tests pass on every C3.x commit
- [x] `npm run lint` clean on every commit
- [x] `npm run governance:ci` all 6 gates green on every commit
- [x] `IntegrationOrchestratorService.contract.test.js` confirms public API surface preserved
- [x] `canonical-ingestion-hooks.test.js` confirms themeparks self-registration via bootstrap
- [x] `check-orchestrator-provider-branches.test.mjs` confirms 0 branches in 10 auto-discovered files

## What's next (out of scope for this PR)

- **C3.10 (deferred):** Migrate controllers/bootstrap to direct imports (e.g. `IntegrationSettingsService` instead of `orchestrator.getSettings()`); eventually delete the facade. Many small touches across the controller — best done in a follow-up.
- **C4 follow-up:** The orchestrator inventory (§7) lists four scoping options for the themeparks-sync.service / orchestrator boundary clarification (A–D). Now that the hook registry exists, option A (documentation + boundary cleanup) is even more straightforward.
