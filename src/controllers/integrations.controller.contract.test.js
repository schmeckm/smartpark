'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const integrationsController = require('./integrations.controller');

/**
 * Phase C0/C1 surface lock-in for the `/api/v1/integrations/*` HTTP layer.
 *
 * This controller is the ONLY consumer of:
 *   - IntegrationOrchestratorService (1,098 lines)
 *   - AdapterRuntimeService
 *   - AdapterInventoryService
 *   - the legacy ProviderAdapterRegistryService (indirectly)
 *
 * Phase C2+ will decompose the orchestrator into per-context services. The
 * exact shape of the controller's exports is observable to:
 *   - src/routes/v1/integrations.routes.js (HTTP routes)
 *   - src/app.js (5 root-mounted routes — see Phase A5 baseline)
 *   - admin-dashboard/src/api/client.ts (~50 calls to /api/v1/integrations/*)
 *
 * Removing or renaming any export here is therefore a breaking change. This
 * test asserts the export set is exactly the locked-in set; refactors that
 * legitimately need to add or remove a handler MUST update this list (and
 * separately update the routes file + dashboard client + OpenAPI doc).
 */

const REQUIRED_EXPORTS = [
  // Provider adapters (legacy framework, /integrations/providers/*).
  'getFeatureFlags',
  'listProviders',
  'getProviderConfig',
  'patchProviderConfig',
  'listProviderDestinations',
  'listProviderParks',
  'getProviderEntity',
  'listProviderEntityChildren',
  'getProviderEntityLive',
  'getProviderEntitySchedule',
  // Provider sync (HTTP poll into canonical pipeline).
  'syncDestinations',
  'syncParks',
  'syncEntities',
  'syncLive',
  'syncCalendar',
  'syncAllParksInDestination',
  // Canonical inbound message store.
  'listCanonicalMessages',
  'getCanonicalMessage',
  'reprocessCanonicalMessage',
  // External-entity mapping / settings.
  'listMappings',
  'patchMapping',
  'getSettings',
  'patchSettings',
  // UNS suggestions, manual nodes, sparkplug schema.
  'getUnsSuggestions',
  'listManualUnsNodes',
  'createManualUnsNode',
  'deleteManualUnsNode',
  'getUnsSparkplugSchema',
  'putUnsSparkplugSchema',
  'deleteUnsSparkplugSchema',
  'materializeUnsNodes',
  // Adapter packages framework (new) + run/discover/health entry points.
  'listAdapterPackages',
  'reloadAdapterPackages',
  'healthAdapterPackage',
  'encodeAdapterOutput',
  'emitAdapterOutput',
  'runDemoAdapter',
  'runLocalAdapter',
  'discoverLocalAdapter',
  'healthLocalAdapter',
  'getAdapterPackageAsset',
  // Installed-adapter management (DB + YAML install config).
  'listInstalledAdapters',
  'getInstalledAdapter',
  'installLocalAdapter',
  'patchInstalledAdapter',
  'deleteInstalledAdapter',
  // Inventory + pipeline log diagnostics.
  'getAdapterInventory',
  'getAdapterPipelineLog',
];

test('integrations.controller: exposes exactly the locked-in handler set', () => {
  const actual = Object.keys(integrationsController).sort();
  const expected = [...REQUIRED_EXPORTS].sort();
  assert.deepEqual(
    actual,
    expected,
    [
      'integrations.controller exports differ from the locked-in set.',
      `+ added (in code, missing here): ${actual.filter((k) => !expected.includes(k)).join(', ') || '(none)'}`,
      `- removed (in here, missing in code): ${expected.filter((k) => !actual.includes(k)).join(', ') || '(none)'}`,
      'Either restore the missing handler, or update REQUIRED_EXPORTS in this test AND the routes file AND OpenAPI AND the dashboard client.',
    ].join('\n')
  );
});

test('integrations.controller: every exported handler is a function', () => {
  const failures = [];
  for (const k of REQUIRED_EXPORTS) {
    if (typeof integrationsController[k] !== 'function') {
      failures.push(`${k} is ${typeof integrationsController[k]}, expected function`);
    }
  }
  assert.equal(failures.length, 0, `Non-function controller exports:\n  - ${failures.join('\n  - ')}`);
});
