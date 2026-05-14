# IntegrationOrchestratorService — Decomposition Inventory

Status (Phase C3.9): **decomposition complete** — the orchestrator is
now a slim facade (≈ 300 LOC, was 1,091) that wires per-context services
together and re-exposes the legacy public API for unchanged controllers
and bootstrap. Read this before touching anything in
`src/modules/integrations/orchestrator/` or extending the orchestrator
with new behavior.

This document is the safety net for **Phase C3** (decomposing the
`IntegrationOrchestratorService` into bounded contexts). It exists so the
refactor can proceed in small, reviewable commits without losing track of
what the current service actually does.

The corresponding lock-in tests live at:
- `src/services/integration-orchestrator.service.contract.test.js`
- `src/controllers/integrations.controller.contract.test.js` (already in main)
- `scripts/check-orchestrator-provider-branches.mjs` + baseline JSON

---

## 1 Why this phase exists

The current `IntegrationOrchestratorService`:

| Metric | Measured (2026-05-08) |
|---|---|
| File size | **1,091 lines** (eslint allow-list still says `1003` from earlier baseline — drifted +88) |
| Public methods | **32+** (counting controller + bootstrap + uns-master-data callers) |
| Bounded contexts mixed in one class | **9** (see §3) |
| Hard-coded `'themeparks_wiki'` control-flow branches | **2** (see §4.1) |
| Mid-function `require('../models')` / sibling-service requires | **6** (see §4.2) |
| Direct `.registryService` access from outside | **8+ in controller** |
| Direct unit tests | **0** (only indirect coverage via controller contract test) |

The original audit (Phase 0) flagged this file as the single biggest
violation of Open/Closed and Single-Responsibility in the codebase. C3
decomposes it without a rewrite — by extracting bounded contexts as
**slim service modules**, then turning the orchestrator into a thin
facade over them, and finally retiring the facade once all callers move
to the per-module imports.

---

## 2 Public API surface (locked-in)

These are the methods consumed externally. They MUST NOT change shape
during decomposition (otherwise downstream callers break).

### 2.1 Consumed by `src/controllers/integrations.controller.js`

```
listProviders()
getProviderConfig(provider)
patchProviderConfig(provider, body)
listAvailableDestinations(provider)
listAvailableParks(provider, destinationId)
getProviderEntity(provider, entityId)
listProviderEntityChildren(provider, entityId)
getProviderEntityLive(provider, entityId)
getProviderEntitySchedule(provider, entityId, options)
syncDestinations(provider)
syncParks(provider, destinationId)
syncEntities(provider, parkId)
syncLive(provider, parkId)
syncCalendar(provider, parkId, options)
syncAllParksInDestination(provider, destinationId)
listCanonicalMessages(filters)
getCanonicalMessage(id)
reprocessCanonicalMessage(id)
listMappings(filters)
patchMapping(id, patch)
getSettings()
patchSettings(input)
listManualUnsNodes()
addManualUnsNode(input)
removeManualUnsNode(id)
getUnsTopicSuggestions()
materializeUnsNodesFromSuggestions()
getSparkplugTopicSchemaDocument({ source })
putSparkplugTopicSchemaDocument(body)
deleteSparkplugTopicSchemaDocument()
```

Plus the leaky **property access** `integrationService.registryService.*`
used by the controller for **8 different registry calls** (list / get /
install / patch / uninstall / reload / health / installLocal). Decoupling
this is part of the decomposition (see §6.4) but **not** a goal of the
first commits.

### 2.2 Consumed by `src/bootstrap/registrations/default.js`

```
new IntegrationOrchestratorService()
.bootstrap()
.startPollingIfEnabled()
```

These two methods are the lifecycle seam. They must keep working until
the bootstrap layer is updated to register the new per-context services
explicitly.

### 2.3 Referenced by other services

- `src/modules/uns/uns-master-data-generation.service.js` (doc comment
  only — refers to `buildDynamicUnsTopicNodesFromIntegrations` shape, no
  runtime dependency).

---

## 3 Bounded contexts mixed in one class

The current 1,091 lines fall cleanly into the following groups. Each
group is a separate bounded context that will become its own module.

| # | Bounded context | Approx. lines | Methods | Risk |
|---|---|---|---|---|
| 3.1 | Settings (provider/park selection, polling flags, AI factors) | ~100 | `bootstrap`, `getSettings`, `patchSettings`, `resolveUnsParkKey`, `selectedParkOrThrow` | low |
| 3.2 | Provider browsing (read-only, no DB writes) | ~200 | `listProviders`, `getProviderConfig`, `patchProviderConfig`, `resolveProvider`, `listAvailableDestinations`, `listAvailableParks`, `getProviderEntity`, `listProviderEntityChildren`, `getProviderEntityLive`, `getProviderEntitySchedule` (+ `normalizeDestinationAndParkRows` helper) | low |
| 3.3 | Canonical ingestion pipeline (provider-fetch → normalize → ingest) | ~250 | `syncDestinations`, `syncParks`, `syncEntities`, `syncLive`, `syncCalendar`, `syncAllParksInDestination` | **high** — contains hard-coded `themeparks_wiki` branches |
| 3.4 | External-entity mapping read/write | ~10 | `listMappings`, `patchMapping` | trivial (already a thin pass-through to `ExternalEntityMappingService`) |
| 3.5 | Canonical message read/reprocess | ~10 | `listCanonicalMessages`, `getCanonicalMessage`, `reprocessCanonicalMessage` | trivial (already a thin pass-through to `CanonicalInboundMessageService`) |
| 3.6 | Manual UNS nodes (user-managed UNS topology) | ~50 | `listManualUnsNodes`, `addManualUnsNode`, `removeManualUnsNode` | low |
| 3.7 | UNS topic suggestions (dynamic + manual + master-data merge) | ~190 | `_unsSchemaMatchesPark`, `_applyUploadedUnsSchemaEntries`, `buildDynamicUnsTopicNodesFromIntegrations`, `_buildUnsSuggestionCore`, `getUnsTopicSuggestionFlatRows`, `materializeUnsNodesFromSuggestions`, `getUnsTopicSuggestions` | medium — touches Sparkplug, master-data, theme-parks domain registry |
| 3.8 | Sparkplug topic schema document (override CRUD) | ~80 | `getSparkplugTopicSchemaDocument`, `putSparkplugTopicSchemaDocument`, `deleteSparkplugTopicSchemaDocument` | low |
| 3.9 | Background polling loop | ~40 | `startPollingIfEnabled` | low |

The single facade `IntegrationOrchestratorService` then becomes ~80 lines
of `this.X = new XService(); listProviders() { return this.X.list(); }`
delegations — and is eventually replaced by direct imports.

---

## 4 Architectural smells (the things C3 fixes)

### 4.1 Hard-coded provider branches (Open/Closed violation)

```js
// integration-orchestrator.service.js, syncEntities()
if (String(selected.provider || '').toLowerCase() === 'themeparks_wiki' && selected.externalParkId) {
  const { sequelize, ...models } = require('../models');
  const { syncParkFromThemeParks } = require('../modules/adapters/themeparks/themeparks-sync.service');
  platformMasterData = await syncParkFromThemeParks(sequelize, models, String(selected.externalParkId));
}

// integration-orchestrator.service.js, syncLive()
if (String(selected.provider || '').toLowerCase() === 'themeparks_wiki' && selected.externalParkId) {
  const { sequelize, ...models } = require('../models');
  const { syncThemeParksLiveOnly } = require('../modules/adapters/themeparks/themeparks-sync.service');
  platformLive = await syncThemeParksLiveOnly(sequelize, models, String(selected.externalParkId));
}
```

These two branches are the exact "if `provider === X`, run vendor-specific
post-processing" pattern that breaks every time a new provider is added.

**Replacement (target):** a registry of post-ingest hooks keyed by
provider key, populated from the adapter package itself. The pipeline
service iterates registered hooks; no `if`-on-provider in core code.

```js
// canonical-ingestion-pipeline.service.js (target)
const hooks = postIngestHooks.get(selected.provider) ?? [];
for (const hook of hooks) {
  try {
    results[hook.name] = await hook.afterEntitiesSync(ctx);
  } catch (e) {
    logger.warn({ err: e.message, hook: hook.name }, 'post-ingest hook failed');
    results[hook.name] = { error: e.message };
  }
}
```

The check script `scripts/check-orchestrator-provider-branches.mjs`
locks the **current** branch count to the baseline so a new branch
cannot slip in during the refactor without an explicit baseline update.

### 4.2 Mid-function `require()` (deferred imports)

| Line | Module | Reason given (today) |
|---|---|---|
| 547–548 | `../models`, `../modules/adapters/themeparks/themeparks-sync.service` | inside `if (provider === 'themeparks_wiki')` — disappears with §4.1 |
| 601–602 | same as above | inside `if (provider === 'themeparks_wiki')` — disappears with §4.1 |
| 852 | `../modules/uns/uns-master-data-generation.service` | inside `try`/`catch` — likely hoist-able |
| 928 | `../modules/uns/uns.service` | inside `materializeUnsNodesFromSuggestions` — circular-dep guard |

The eslint allow-list (`MID_FN_MODELS_ALLOW_LIST`) currently records
the orchestrator with **2 violations**. Removing §4.1 reduces this to 2
remaining (the master-data and uns.service requires), which we then
verify case-by-case in the per-context extractions.

### 4.3 Theme-parks-specific helpers in core code

The orchestrator imports four helpers whose name is theme-parks-flavored:

```js
const {
  resolveThemeParksPublicationDomain,
  loadEntityDomainRegistry,
  mergeThemeParksEntityRegistryFromMessages,
  mergeThemeParksEntityRegistryFromLiveMessages,
} = require('../modules/uns/theme-parks-entity-domain.service');
```

Two possibilities to verify in C3.7 (UNS topic suggestion extraction):
- The helpers are theme-parks-specific and should be invoked only via
  the post-ingest hook registry (§4.1).
- The helpers are mis-named and are actually generic UNS-domain registry
  helpers; renaming + relocating to `src/modules/uns/entity-domain-registry.service.js`
  removes the theme-parks coupling without functional change.

We will not pre-decide; the answer comes out of reading
`theme-parks-entity-domain.service.js` during C3.7.

### 4.4 Leaky `registryService` access from controller

```js
// integrations.controller.js
const integrationService = new IntegrationOrchestratorService();
// …
await integrationService.registryService.installLocalAdapterPackage(body);
await integrationService.registryService.uninstallInstalledAdapterPackage(req.params.id);
// (8 such accesses)
```

C3 will keep this working (the registry is an injected collaborator) but
will document it. The cleanup is a follow-up (C6 candidate) where the
controller imports `ProviderAdapterRegistryService` directly instead of
reaching through the orchestrator instance.

---

## 5 Caller map

```
                                         ┌──────────────────────────────────┐
                                         │ src/controllers/                 │
                                         │   integrations.controller.js     │
                                         │   (47 handlers, ~30 use orch)    │
                                         └────────────────┬─────────────────┘
                                                          │ method calls
src/bootstrap/registrations/default.js                    │
   │                                                      │
   │ orchestrator.bootstrap()                             │
   │ orchestrator.startPollingIfEnabled()                 │
   ▼                                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ src/services/integration-orchestrator.service.js  (1,091 lines)         │
│                                                                         │
│  Settings ──► AppSettingRepository                                      │
│  Provider browsing ──► ProviderAdapterRegistryService (.getAdapter etc) │
│  Sync pipeline ──► CanonicalInboundMessageService.ingest                │
│            └──► (themeparks_wiki branch only) themeparks-sync.service   │
│  Mapping ──► ExternalEntityMappingService                               │
│  UNS suggestions ──► theme-parks-entity-domain.service                  │
│                  ├──► uns-topic-generator.service                       │
│                  ├──► sparkplug-topic-builder.service                   │
│                  └──► uns-master-data-generation.service                │
│  Sparkplug schema ──► AppSettingRepository (single key)                 │
│  Polling loop ──► PlatformSettingsService + this.syncLive()             │
└─────────────────────────────────────────────────────────────────────────┘
                                                          ▲
                                                          │ doc reference only
                                            src/modules/uns/
                                              uns-master-data-generation.service.js
```

---

## 6 Target structure (post-C3)

```
src/modules/integrations/
├── adapter-framework/                  (already in main, post-C5)
│   ├── adapter-framework.service.js
│   ├── adapter-installed-scheduler.service.js
│   ├── adapter-inventory.service.js
│   ├── adapter-manifest-validator.service.js
│   ├── adapter-observation-validator.service.js
│   ├── adapter-observation.schema.js
│   ├── adapter-operations.service.js
│   ├── adapter-output-profile-names.js
│   ├── adapter-package-loader.service.js
│   ├── adapter-pipeline-log.service.js
│   ├── adapter-runtime-contract.js
│   └── adapter-runtime.service.js
└── orchestrator/                        (new — produced by C3)
    ├── integration-settings.service.js          (§3.1)
    ├── provider-browser.service.js              (§3.2)
    ├── canonical-ingestion-pipeline.service.js  (§3.3 + post-ingest hooks)
    ├── post-ingest-hooks.registry.js            (replaces §4.1 branches)
    ├── manual-uns-node.service.js               (§3.6)
    ├── uns-topic-suggestion.service.js          (§3.7)
    ├── sparkplug-topic-schema.service.js        (§3.8)
    ├── integration-polling.service.js           (§3.9)
    └── index.js                                  (slim facade — back-compat)
```

The legacy file `src/services/integration-orchestrator.service.js` keeps
its current path **only** as a 80-line re-export of the facade, so
existing `require('../services/integration-orchestrator.service')` calls
keep working. It is removed in a final commit once every caller has been
migrated.

---

## 7 Decomposition plan (commit-level)

Each commit ends with a green `npm test`, `npm run lint`,
`npm run governance:ci`. Stop on red.

| Commit | Scope | Files touched | Risk | Status |
|---|---|---|---|---|
| C3.0 | Inventory doc + lock-in tests + provider-branch baseline + governance script. No production code touched. | this doc + 3 new test/script files + `package.json` (1 new script) + governance baseline | trivial | **DONE** |
| C3.1 | Extract `manual-uns-node.service.js`. Orchestrator delegates to it. | new module + orchestrator (3 methods → 3 delegations) | low | **DONE** |
| C3.2 | Extract `provider-browser.service.js`. Orchestrator delegates. | new module + orchestrator (10 methods → 10 delegations) | low | **DONE** |
| C3.3 | Extract `integration-settings.service.js` (settings, bootstrap, polling-config). | new module + orchestrator | low | **DONE** |
| C3.4 | Extract `sparkplug-topic-schema.service.js`. | new module + orchestrator (3 methods + 2 helpers) | low | **DONE** |
| C3.5 | Inline canonical-message query into `CanonicalInboundMessageService`. The 3 thin pass-throughs (`listCanonicalMessages`, `getCanonicalMessage`, `reprocessCanonicalMessage`) are removed from the orchestrator surface; the controller calls `CanonicalInboundMessageService` directly. Contract test updated. | controller + orchestrator | low | **DONE** |
| C3.6 | Extract `uns-topic-suggestion.service.js` (~190 LOC) + clarified theme-parks helpers. | new module + orchestrator | medium | **DONE** |
| C3.7 | Extract `canonical-ingestion-pipeline.service.js` together with `canonical-ingestion-hooks.js` registry. Kills the 2 hard-coded `themeparks_wiki` branches (§4.1). Provider modules self-register via `canonical-ingestion-hooks.bootstrap.js`. | new modules + themeparks-sync.service self-registration + orchestrator | highest — semantic change, behavior preserved | **DONE** |
| C3.8 | Extract `integration-polling.service.js`. Orchestrator's `startPollingIfEnabled()` collapses to a one-line delegation. | new module + orchestrator | low | **DONE** |
| C3.9 | Convert legacy file to slim facade (≈ 300 LOC) + final governance gate that auto-discovers every file under `src/modules/integrations/orchestrator/` and forbids `provider === '<key>'` branches anywhere in the orchestrator surface. Dead imports removed. | orchestrator → facade + governance script + baseline | low | **DONE** |
| C3.10 | (Optional, deferred) migrate callers to direct imports; eventually delete the facade. | many small touches in controller | medium — many small edits | pending |

C3.0 is intentionally **doc + tests only**. No production source file is
modified. After C3.0 lands, every subsequent commit can be reverted in
isolation if anything breaks.

---

## 8 Lock-in tests added in C3.0

| Test file | Asserts |
|---|---|
| `src/services/integration-orchestrator.service.contract.test.js` | • the orchestrator class exports a member named `IntegrationOrchestratorService`<br>• `SETTING_KEYS` is exported and freezes the 10 known keys<br>• every method name in §2.1 / §2.2 / §2.3 exists on the instance prototype<br>• every such method is a function (no accidental property)<br>• `new Service()` constructs without DB access (no top-level side effects) |
| `scripts/check-orchestrator-provider-branches.mjs` + `docs/governance/orchestrator-provider-branches-baseline.json` | • the count of `provider.*===.*'<key>'` branches in the orchestrator file matches baseline<br>• new branches require an explicit baseline bump |
| `scripts/check-orchestrator-provider-branches.test.mjs` | • script logic itself (parses input, counts matches, diffs against baseline, exits non-zero on drift) |

These tests run as part of the existing `npm test` and the existing
`npm run governance:ci` (extended in C3.0 to invoke the new script).

---

## 9 Rollback strategy

Every commit C3.1 … C3.10 is independently revertible. C3.0 itself is
revertible too — it's purely additive (one new doc, three new test
files, one extended package.json script, one new governance baseline).
No code under `src/` outside the new test file is modified.

If the full C3 series turns out to be wrong, `git revert` of C3.0 alone
brings the codebase back to today's main. If only one extraction proves
wrong, revert just that one commit — the orchestrator's old
implementation is preserved up to C3.9.
