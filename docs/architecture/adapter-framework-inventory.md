# Adapter framework inventory (Phase C0/C1)

**Status**: read-only inventory. No code was moved or renamed in this phase. The accompanying
governance baseline (`docs/governance/adapter-keys-baseline.json`) and the lock-in tests added
alongside this document are the safety net that Phase C2 will refactor against.

The audit (R3) flagged "two adapter frameworks" — `src/integrations/adapters/*` and
`src/integrations/adapter-packages/*`. This investigation contradicts that framing: the two are
**layered**, not **duplicate**. The five inner provider classes are HTTP clients reused by the new
runtime contract. Phase C consolidation should therefore preserve both layers and clarify their
relationship, not delete one.

---

## 1. Layer architecture (current state)

```
HTTP layer
├── src/controllers/integrations.controller.js         (48 handlers)
├── src/controllers/integration.controller.js          (1 handler — /integration/logs, deprecated)
├── src/controllers/adapters.controller.js             (operations center: dashboard, run-now, pause)
└── src/app.js                                         (root-mounted alias: install-local, pipeline-log)

   │
   ▼

Service facade
└── src/services/provider-adapter-registry.service.js  (the bridge, ~70 lines)
        ├── owns: ProviderAdapterRegistry              (legacy)
        ├── owns: AdapterFrameworkService              (new)
        └── owns: ProviderAdapterConfigRepository      (DB)

   │
   ▼ legacy framework (HTTP clients) ──┬─►  ▼ new framework (runtime contract)

src/integrations/adapters/                         src/adapter-framework/
├── provider-adapter.interface.js                  ├── adapter-framework.service.js   (DB + install + lifecycle)
├── provider-adapter-registry.js                   └── adapter-runtime-contract.js    (assertRuntimeContract)
├── http-client.js
├── themeparks-wiki.adapter.js  ◄──┐               src/services/
└── wartezeiten-app.adapter.js  ◄──│──── used by ─►├── adapter-package-loader.service.js   (scans, requires, validates)
                                   │               ├── adapter-runtime.service.js          (encode + emit + log)
                                   │               ├── adapter-manifest-validator.service.js
                                   │               ├── adapter-observation-validator.service.js
                                   │               ├── adapter-inventory.service.js
                                   │               ├── adapter-operations.service.js
                                   │               ├── adapter-installed-scheduler.service.js
                                   │               ├── adapter-pipeline-log.service.js
                                   │               ├── adapter-output-profile-names.js
                                   │               └── adapter-observation.schema.js
                                   │
                                   │               src/integrations/adapter-packages/
                                   ├──────  used by ────┬── themeparks_wiki/index.js   (wraps ThemeParksWikiAdapter)
                                   └──────  used by ────┤── wartezeiten_app/index.js   (wraps WartezeitenAppAdapter)
                                                        ├── weather_open_meteo/index.js    (standalone)
                                                        ├── calendar_school_holidays/index.js (standalone)
                                                        └── opcua_edge/index.js            (standalone)
```

**Key insight**: `adapter-packages/themeparks_wiki/index.js` and `adapter-packages/wartezeiten_app/index.js`
each `require('../../../integrations/adapters/<provider>.adapter')` — the inner provider class is
re-used. The two frameworks are not parallel implementations; the legacy one is the inner HTTP-client
layer, and the new one is the runtime contract that wraps it.

---

## 2. Per-adapter dependency map

| adapterKey | manifest | runtime entrypoint | inner HTTP client | install YAML | DB row | DB-seeded | Provider in legacy registry |
|---|---|---|---|---|---|---|---|
| `themeparks_wiki` | `src/integrations/adapter-packages/themeparks_wiki/manifest.json` | `…/themeparks_wiki/index.js` | `src/integrations/adapters/themeparks-wiki.adapter.js` | _(none yet)_ | upserted at boot | yes (`ensureSeedConfigs`) | ✅ |
| `wartezeiten_app` | `…/wartezeiten_app/manifest.json` | `…/wartezeiten_app/index.js` | `src/integrations/adapters/wartezeiten-app.adapter.js` | _(none yet)_ | upserted at boot | yes | ✅ |
| `weather_open_meteo` | `…/weather_open_meteo/manifest.json` | `…/weather_open_meteo/index.js` | _(no separate inner class — uses `src/services/open-meteo-client.js`)_ | `data/adapter-install-config/weather_open_meteo.install.yaml` | upserted at boot | no | — |
| `calendar_school_holidays` | `…/calendar_school_holidays/manifest.json` | `…/calendar_school_holidays/index.js` | _(self-contained: no separate HTTP client)_ | _(none yet)_ | upserted at boot | no | — |
| `opcua_edge` | `…/opcua_edge/manifest.json` | `…/opcua_edge/index.js` | _(self-contained)_ | `data/adapter-install-config/opcua_edge.install.yaml` | upserted at boot | no | — |

The DB row for each package is created/upserted by
`AdapterFrameworkService.reloadLocalPackages()` at boot through the loader. The unique column is
`adapter_packages.adapter_key` (migration: `src/migrations/20260426100001-adapter-framework-phase1.js`).

---

## 3. Contracts

### 3.1 `manifest.json` (validated by `AdapterManifestValidatorService`)
Required fields: `adapterKey`, `name`, `version`, `runtime`, `entrypoint`, `adapterType`, `capabilities[]`.
Optional fields: `description`, `category`, `website`, `documentationUrl`, `qualityTier`, `tags[]`,
`iotClass`, `providedDomains[]`, `providedMetrics[]`, `configSchema`, `permissions`, `logoPath`,
`bannerPath`, `readmePath`. All five production manifests pass validation.

### 3.2 Runtime contract (`assertRuntimeContract`)
Every adapter package's `index.js` MUST export:
```
validateConfig(config) -> { valid, errors }
discover(config)       -> Array<{ id, name, entityType }>
poll(config)           -> Array<observation> | { observations, debug }
health(config)         -> { ok, message }
```
All five production packages comply.

### 3.3 Adapter-key constraint (`assertSafeAdapterKey`)
`AdapterInstallConfigRepository` validates keys against `/^[a-z0-9_-]{1,120}$/i`. All five production
keys comply. The DB column is `VARCHAR(120) UNIQUE`.

### 3.4 HTTP surface (`integrations.controller.js` + `adapters.controller.js`)
- `integrations.controller.js`: 48 handlers (locked in by `integrations.controller.contract.test.js`).
- `adapters.controller.js` mounted at `/api/v1/adapters/*`: dashboard, health, runs, status, run-now, pause, activate, disable.
- `app.js` root mounts (Phase A5 baseline): `/integrations/installed-adapters/install-local`, `/integrations/adapters/install-local` (alias, deprecated B2), `/integrations/installed-adapters/:id` DELETE, `/integrations/adapters/packages/:adapterKey/asset` GET, `/integrations/adapters/pipeline-log` GET.

### 3.5 Provider registry (`ProviderAdapterRegistry`)
Hard-codes the set `{ themeparks_wiki, wartezeiten_app }` via `new ThemeParksWikiAdapter()` and `new
WartezeitenAppAdapter()` at construction. The legacy framework is **closed** — adding a new provider
to the legacy framework is a code change, not configuration.

---

## 4. Cross-system references (high-risk on rename)

If any `adapterKey` is renamed, ALL of these must move atomically (and a Sequelize migration must
backfill the DB column):

| Reference | Examples |
|---|---|
| Filesystem | `src/integrations/adapter-packages/<key>/`, `data/adapter-install-config/<key>.install.yaml` |
| Manifest | `manifest.adapterKey` field inside the package |
| DB | `adapter_packages.adapter_key` (UNIQUE), `adapter_run_logs.adapter_key`, install metadata blobs |
| Service constants | `IntegrationOrchestratorService` defaults `themeparks_wiki` (3 hard-codes) |
| Env defaults | `EXTERNAL_PARK_DATA_DEFAULT_PROVIDER=themeparks_wiki` |
| Selected-park service | `src/services/themeparks-wiki-selected-park.service.js` |
| Themeparks sync module | `src/modules/adapters/themeparks/themeparks-sync.{routes,controller,service}.js` |
| OpenAPI components | `EnvelopeAdapterPackageOne`, `InstallLocalAdapterRequest`, banner asset paths |
| Admin dashboard | 14 files reference adapter keys or `/integrations/*` routes |
| Environment names | Open-Meteo client, calendar holidays client (constants) |

This is why **Phase C0/C1's primary deliverable is the lock-in tests, not file moves**. An accidental
rename would silently break the runtime in non-obvious ways (DB row missing, install YAML not found,
sync module dispatching to a non-existent provider).

---

## 5. Duplicate responsibilities (real, after de-coupling the layered ones)

The audit's R3 was partially wrong (legacy/new are layered). However, three real duplications remain:

### 5.1 Inner provider classes belong inside their packages
`themeparks-wiki.adapter.js` and `wartezeiten-app.adapter.js` are imported only by:
- the legacy `ProviderAdapterRegistry`
- the matching `adapter-packages/<key>/index.js`
The cleanest target is to move each class file inside its package directory and have the legacy
registry import from there. **C2 candidate**.

### 5.2 `IntegrationOrchestratorService` mixes 6 bounded contexts
1,091 lines covering: provider sync, canonical ingest, mappings, settings, UNS suggestions, manual UNS
nodes. Its dependency on `provider-adapter-registry.service` is one input among many; decomposing the
orchestrator is a Phase C3 task, not strictly part of the framework consolidation.

### 5.3 `themeparks` sync module duplicates orchestrator paths
`src/modules/adapters/themeparks/themeparks-sync.service.js` has its own per-park sync that the
orchestrator also exposes via the generic provider sync (`/integrations/<provider>/sync/*`). The
sync module is a single-provider wrapper; the orchestrator is the generic path. **C4 candidate**:
fold the sync module into the orchestrator's themeparks-specific code path so there's exactly one way
to sync a park from themeparks.wiki.

---

## 6. Proposed canonical target (post Phase C)

```
src/modules/integrations/                                # consolidated module (DDD-lite)
├── adapter-framework/                                    # the runtime contract layer
│   ├── adapter-framework.service.js                      # was src/adapter-framework/
│   ├── adapter-runtime-contract.js
│   ├── adapter-runtime.service.js                        # was src/services/
│   ├── adapter-package-loader.service.js                 # was src/services/
│   ├── adapter-manifest-validator.service.js
│   ├── adapter-observation-validator.service.js
│   └── adapter-pipeline-log.service.js
├── packages/                                             # was src/integrations/adapter-packages/
│   ├── themeparks_wiki/
│   │   ├── manifest.json
│   │   ├── index.js
│   │   ├── client.js                                     # was src/integrations/adapters/themeparks-wiki.adapter.js
│   │   └── README.md
│   ├── wartezeiten_app/
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── client.js                                     # was wartezeiten-app.adapter.js
│   ├── weather_open_meteo/                               # already self-contained
│   ├── calendar_school_holidays/
│   └── opcua_edge/
├── providers/                                            # legacy registry; eventually built FROM packages/
│   ├── provider-adapter.interface.js
│   ├── provider-adapter-registry.js                      # auto-built from packages/<key>/client.js
│   └── http-client.js                                    # shared HTTP client
├── canonical/                                            # was scattered across orchestrator
│   ├── canonical-ingest.service.js
│   ├── canonical-apply.service.js
│   └── canonical.contract.js
├── controllers/
│   ├── providers.controller.js                           # provider sync paths (was orchestrator)
│   ├── canonical.controller.js                           # canonical messages
│   ├── mappings.controller.js
│   ├── settings.controller.js
│   ├── installed-adapters.controller.js                  # install-local, packages, run-local, etc.
│   └── pipeline-log.controller.js
├── routes/
│   └── integrations.routes.js                            # composes the controllers above
└── repository/
    ├── adapter-package.repository.js                     # was src/repositories/
    ├── adapter-install-config.repository.js
    ├── adapter-run-log.repository.js
    └── provider-adapter-config.repository.js
```

The `IntegrationOrchestratorService` god-class is dissolved into the per-context controllers + a thin
`canonical/` module. The legacy provider-adapter framework becomes a generated artefact of the
package framework rather than a separate code root.

---

## 7. Phase C ticket plan

The original audit roadmap listed C1–C4 generically. With the inventory in hand, the actually
sequenced tickets are:

| # | Ticket | Risk | What it ships |
|---|---|---|---|
| **C0** | Inventory + lock-in tests (THIS PHASE) | none | Baseline JSON + 4 contract tests + governance gate. No code moved. |
| **C1** | Provider-class co-location | low | Move `themeparks-wiki.adapter.js` into `adapter-packages/themeparks_wiki/client.js` (and same for wartezeiten). Update the 2 importers (the package's `index.js` and the registry). NO logic change, NO key change, NO migration. |
| **C2** | Build legacy registry FROM packages | low | `ProviderAdapterRegistry.constructor` reads from package directories that declare a `providerAdapterClient` field in `manifest.json`. Removes hard-coded `new XAdapter()` calls. |
| **C3** | Decompose `IntegrationOrchestratorService` | high | Split the 1,091-line god service into 6 per-context services under `src/modules/integrations/`. Largest ticket. |
| **C4** | Fold `src/modules/adapters/themeparks` into the canonical sync path | medium | Replace per-park direct sync calls with `IntegrationOrchestratorService.syncLive(themeparks_wiki, parkId)`. |
| **C5** | Move `src/adapter-framework/` and `src/services/adapter-*` under `src/modules/integrations/adapter-framework/` | medium | Pure file relocation; no behaviour change. Updates many imports. |

**Recommended next step (C1)**: provider-class co-location, because:
- Deletes one of the audit's flagged "two roots" without touching adapter keys, DB, install YAML, or
  the dashboard.
- Reuses the lock-in tests added in C0 to prove no contract regression.
- Shrinks `src/integrations/adapters/` to one file (`provider-adapter.interface.js` +
  `http-client.js`) which can be moved to a shared location in C2.
- Keeps the PR small (~6 files moved, ~10 imports updated).

---

## 8. Out of scope of Phase C

- Adding new adapter packages.
- Replacing the YAML install-config storage with a DB-only approach.
- Changing the OpenAPI contract for adapter operations.
- Migrating the admin-dashboard to a different API surface.

---

## 9. Lock-in safety net (added in this PR)

| Test file | Asserts |
|---|---|
| `scripts/check-adapter-keys-baseline.{mjs,test.mjs}` | Filesystem ↔ baseline parity; manifest.adapterKey === directory name; baseline file shape valid. Wired into `npm run governance:ci`. |
| `src/integrations/adapter-packages/contract.test.js` | `scanPackages` + `loadAll` agree; every key resolves; runtime contract holds; provider-key subset matches the legacy registry. |
| `src/integrations/adapters/provider-adapter-registry.test.js` | Legacy registry returns exactly the baseline provider keys; provider-info shape stable; `get(unknown)` throws AppError 404; mutation safety. |
| `src/repositories/adapter-install-config.repository.contract.test.js` | `assertSafeAdapterKey` regex; `defaultInstallDocument` shape; every YAML in `data/adapter-install-config/` is well-formed and allow-listed; saveFull→load roundtrip. |
| `src/controllers/integrations.controller.contract.test.js` | The 48 controller exports are exactly the locked-in set, all are functions. |
