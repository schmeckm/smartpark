# Generic adapter runtime (local packages)

This document describes the **local adapter package** contract, how observations flow through validation and output encoders, and how to run smoke tests. **All adapter packages live under** `src/integrations/adapter-packages/<adapterKey>/` and are loaded by `AdapterPackageLoaderService` + `AdapterRuntimeService`.

## Adapter contract (`index.js` + `manifest.json`)

Each package lives in a directory named after `adapterKey` (or any folder whose `manifest.json` contains that key). On load, the runtime asserts:

- **Manifest** (`AdapterManifestValidatorService` + `assertManifest` in `src/modules/integrations/adapter-framework/adapter-runtime-contract.js`): `adapterKey`, `version`, `runtime: NODE`, `entrypoint` (defaults to `index.js`), `name`, `adapterType`, `capabilities`; optional Home Assistant–style fields such as `iotClass`, `providedDomains`, `providedMetrics`.
- **Runtime** (`assertRuntimeContract`): exported async functions:

| Function | Role |
|----------|------|
| `validateConfig(config, context)` | Returns `{ valid: boolean, errors?: string[] }`. |
| `discover(config, context)` | Returns an array of discovered entities (shape is adapter-specific). |
| `poll(config, context)` | Returns an array of **normalized observations** for the core pipeline. |
| `health(config, context)` | Returns `{ ok, message? }` for connectivity checks. |

## Normalized observation schema

Observations from `poll()` are validated with Joi in `src/modules/integrations/adapter-framework/adapter-observation.schema.js` (via `AdapterObservationValidatorService`). Required core fields include:

`eventType`, `domain`, `assetSlug`, `metric`, `value`, `eventTime` (ISO-8601), `source`

Optional / defaulted: `unit`, `quality`, `confidence`, `provider`, `externalParkId`, `externalEntityId`, `rawPayload`, `metadata`.

Extra keys are stripped. See the schema file for the exact rules.

## Output profiles

`OutputRouterService` (`src/services/output-router.service.js`) maps each observation to encoders:

| Internal key | Encoder |
|--------------|---------|
| `uns_json` | `src/output-encoders/uns-json.encoder.js` — UNS topic `tpuns/...` |
| `sparkplug_json` | `src/output-encoders/sparkplug-json.encoder.js` — `spBv1.0/.../DDATA/...` (JSON MVP) |
| `canonical_historian` | `src/output-encoders/canonical-historian.encoder.js` — rows for `CanonicalInboundMessageService.ingest()` |

HTTP bodies may use **aliases** (`UNS_JSON`, `SPARKPLUG_JSON`, `CANONICAL_HISTORIAN`); they are normalized in `src/modules/integrations/adapter-framework/adapter-output-profile-names.js`.

Default profile list when omitted comes from env `OUTPUT_PROFILES` (comma-separated internal keys). Sparkplug topic defaults use `SPARKPLUG_GROUP_ID` and `SPARKPLUG_EDGE_NODE` in `src/config/env.js`.

## Local package layout

Single root:

```text
src/integrations/adapter-packages/<adapterKey>/
  manifest.json
  index.js          # exports validateConfig, discover, poll, health
  README.md         # optional; shown in admin “Devices & Services” detail when present
  assets/
    logo.svg        # optional; or set manifest.logoPath
    banner.png      # optional; or banner.jpg / .webp / .svg, or manifest.bannerPath
```

Loader: `src/modules/integrations/adapter-framework/adapter-package-loader.service.js` — `scanPackages()` walks the integrations tree only. It also discovers `readmePath` (`README.md` or `manifest.readmePath`) and `bannerPath` (manifest or `assets/banner.{png,jpg,webp,svg}`). Same-origin **relative** paths are returned on the adapters API as `readmeAssetUrl` / `bannerAssetUrl` / `logoAssetUrl` (e.g. `/api/v1/integrations/adapters/packages/:adapterKey/asset?path=…`) so browsers behind Vite/Docker are not given internal hostnames like `http://api:3000/…`. That GET is mounted on the root Express app **without** JWT so `img` tags work (`src/app.js`).

## Unified `runAdapter()`

`AdapterRuntimeService.runAdapter({ adapterKey, mode, config, context, profiles, emit, autoApply })` with `mode` in `poll` | `discover` | `health`:

- **poll** — delegates to `run()` (encode + optional emit + `adapter_run_logs` on success/failure when DB is up).
- **discover** / **health** — no observation validation, no encode/emit, **no** adapter run log (read-friendly paths).

Response shape (poll) includes both legacy keys (`encodedOutputs`, `emittedOutputs`) from `runLocal()` and unified `encoded`, `emitted`, `success`, `mode`.

## Runtime flow (poll)

Used by `AdapterRuntimeService.run()` / `runLocal()` / `runAdapter({ mode: 'poll', ... })`:

1. Load package (`loadByAdapterKey`) — manifest + contract asserted.
2. `validateConfig(config, context)`.
3. `poll(config, context)` → raw array.
4. Validate each item → `observations` + `validationErrors`.
5. For each valid observation: `OutputRouterService.encodeAll()` → `encodedOutputs` / `encoded`.
6. If emit flags set: `OutputRouterService.emit()` (MQTT via `publishMqtt`, canonical via `ingest`) → `emittedOutputs` / `emitted`; otherwise emitted blocks include `skipped: true`.
7. Insert `adapter_run_logs` row when the table exists (failures are non-fatal for API response; see `runLogError`).

**Discover-only** path: `discoverLocal()` → `runAdapter({ mode: 'discover' })` — no encode/emit and no run log.

**Health** path: `healthLocal()` → `runAdapter({ mode: 'health' })`.

## HTTP API (all under `/api/v1/integrations`, authenticated)

| Method | Path | Permission | Notes |
|--------|------|------------|--------|
| GET | `/adapters/packages` | **read** | `data` = Sequelize `adapter_packages` rows; `meta.localIntegrationPackages` = `scanPackages()` |
| POST | `/adapters/run-local` | **manage** | Generic poll pipeline; body `emit` toggles MQTT + canonical together. |
| POST | `/adapters/discover-local` | **read** | Discovery only. |
| POST | `/adapters/health-local` | **read** | `health()` only. |
| POST | `/adapters/demo/run` | **manage** | Same as run for `demo_static_adapter` + default `parkSlug`; supports `emitMqtt` / `ingestCanonical` separately. |
| POST | `/output/encode` | **read** | Single observation encode (no adapter). |
| POST | `/output/emit` | **manage** | Single observation encode + optional publish/ingest. |

## Smoke tests

From the repository root (loads `.env` if present; DB optional for assertions):

```bash
npm run smoke:adapter-runtime
npm run smoke:adapters
```

- `smoke:adapter-runtime` — `runLocal()` on the demo adapter.
- `smoke:adapters` — `scanPackages()` plus `runAdapter({ mode: 'poll', ... })` and encoder assertions.

## Where future adapters fit

| Domain | Typical `poll()` output | Notes |
|--------|-------------------------|--------|
| **ThemeParks.wiki** (or similar API) | Queue time + status observations per ride | Map API entities to `assetSlug` / `externalEntityId`; reuse canonical `WAIT_TIME_UPDATED` / `ENTITY_STATUS_UPDATED`. |
| **Holiday calendar** | Observations with domain `calendar`, metrics such as `blackout` / `expected_crowd` | May extend canonical types or route via UNS only until canonical supports them. |
| **Weather** | `WEATHER_OBSERVATION_UPDATED`-style payloads | Historian encoder today focuses on wait/status; extend encoder or use dedicated integration path. |
| **Traffic / parking** | e.g. `vehicle_count`, `occupancy` | Same pattern as demo `main_entry` — UNS + Sparkplug for telemetry; canonical when message types exist. |
| **Camera AI** | Detections as metrics (`queue_estimate`, `density`) | High rate: consider batching before `emit`; respect `permissions` in manifest for MQTT/DB. |

Keep **one observation per metric event** (or batch in adapter, then split in runtime) so validation and encoders stay predictable.

## Related files

- `src/modules/integrations/adapter-framework/adapter-manifest-validator.service.js` — manifest rules.
- `src/modules/integrations/adapter-framework/adapter-runtime.service.js` — orchestration.
- `src/modules/integrations/adapter-framework/adapter-observation-validator.service.js`
- `src/services/output-router.service.js`
- `src/services/mqtt-connector.service.js` — `publishMqtt`
- `src/services/canonical-inbound-message.service.js` — `ingest`
- `src/migrations/20260426120001-adapter-run-logs.js`
