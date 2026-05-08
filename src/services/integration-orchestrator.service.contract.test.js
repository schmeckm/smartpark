'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const moduleUnderTest = require('./integration-orchestrator.service');

/**
 * Phase C3.0 — public-surface lock-in for `IntegrationOrchestratorService`.
 *
 * This file is a 1,091-line god-class that mixes 9 bounded contexts
 * (settings, provider browsing, sync pipeline, mapping, manual UNS nodes,
 * UNS suggestions, sparkplug schema, canonical-message query, polling).
 *
 * Phase C3.1+ will extract those bounded contexts into per-context
 * service modules and turn the orchestrator into a thin facade. To make
 * each extraction reviewable in isolation, this test pins the public
 * API of the orchestrator AS IT EXISTS TODAY:
 *
 *   - the export shape (`IntegrationOrchestratorService`, `SETTING_KEYS`)
 *   - the exact set of method names callers depend on
 *   - that every such method is a function on the prototype
 *   - that the constructor does not throw at zero-arg call time
 *
 * Any C3.x commit that legitimately renames or removes a method MUST
 * update REQUIRED_PROTO_METHODS in this file (and the corresponding
 * caller). That keeps "I changed the public API" visible in PR diffs.
 *
 * See: docs/architecture/orchestrator-inventory.md (§2 Public API surface)
 */

const REQUIRED_PROTO_METHODS = [
  // Lifecycle (consumed by src/bootstrap/registrations/default.js).
  'bootstrap',
  'startPollingIfEnabled',

  // Provider browsing (read-only).
  'listProviders',
  'getProviderConfig',
  'patchProviderConfig',
  'resolveProvider',
  'listAvailableDestinations',
  'listAvailableParks',
  'getProviderEntity',
  'listProviderEntityChildren',
  'getProviderEntityLive',
  'getProviderEntitySchedule',

  // Sync (provider → canonical pipeline).
  'syncDestinations',
  'syncParks',
  'syncEntities',
  'syncLive',
  'syncCalendar',
  'syncAllParksInDestination',
  'selectedParkOrThrow',

  // Canonical message access.
  'listCanonicalMessages',
  'getCanonicalMessage',
  'reprocessCanonicalMessage',

  // External-entity mapping.
  'listMappings',
  'patchMapping',

  // Settings.
  'getSettings',
  'patchSettings',
  'resolveUnsParkKey',

  // Manual UNS nodes.
  'listManualUnsNodes',
  'addManualUnsNode',
  'removeManualUnsNode',

  // UNS topic suggestions / materialize.
  'buildDynamicUnsTopicNodesFromIntegrations',
  'getUnsTopicSuggestionFlatRows',
  'materializeUnsNodesFromSuggestions',
  'getUnsTopicSuggestions',

  // Sparkplug topic schema document.
  'getSparkplugTopicSchemaDocument',
  'putSparkplugTopicSchemaDocument',
  'deleteSparkplugTopicSchemaDocument',
];

const REQUIRED_SETTING_KEYS = {
  selectedProvider: 'externalParkData.selectedProvider',
  selectedDestination: 'externalParkData.selectedDestination',
  selectedPark: 'externalParkData.selectedPark',
  autoApplyEnabled: 'externalParkData.autoApplyEnabled',
  pollingEnabled: 'externalParkData.pollingEnabled',
  pollingIntervalSeconds: 'externalParkData.pollingIntervalSeconds',
  aiForecastFactors: 'ai.forecast.factorConfigs',
  unsManualNodes: 'uns.manualNodes',
  unsSparkplugSchemaOverride: 'uns.sparkplugTopicSchema',
};

test('integration-orchestrator: module exports the documented surface', () => {
  assert.equal(
    typeof moduleUnderTest.IntegrationOrchestratorService,
    'function',
    'IntegrationOrchestratorService must be exported as a class (function)'
  );
  assert.equal(typeof moduleUnderTest.SETTING_KEYS, 'object', 'SETTING_KEYS must be exported');
  assert.notEqual(moduleUnderTest.SETTING_KEYS, null, 'SETTING_KEYS must not be null');
});

test('integration-orchestrator: SETTING_KEYS pins the 9 known app_settings keys', () => {
  const actual = moduleUnderTest.SETTING_KEYS;
  for (const [k, v] of Object.entries(REQUIRED_SETTING_KEYS)) {
    assert.equal(
      actual[k],
      v,
      `SETTING_KEYS.${k} drifted: expected "${v}", got "${actual[k]}". ` +
        'Settings keys are persisted in app_settings — renaming them is a data migration, not a refactor.'
    );
  }
  const expectedKeys = Object.keys(REQUIRED_SETTING_KEYS).sort();
  const actualKeys = Object.keys(actual).sort();
  assert.deepEqual(
    actualKeys,
    expectedKeys,
    'SETTING_KEYS gained or lost an entry. ' +
      'Adding a key is OK but requires updating this lock-in list AND the inventory doc.'
  );
});

test('integration-orchestrator: every locked-in method exists on the prototype', () => {
  const proto = moduleUnderTest.IntegrationOrchestratorService.prototype;
  const missing = [];
  for (const name of REQUIRED_PROTO_METHODS) {
    if (typeof proto[name] !== 'function') {
      missing.push(`${name} is ${typeof proto[name]}, expected function`);
    }
  }
  assert.equal(
    missing.length,
    0,
    [
      'IntegrationOrchestratorService is missing locked-in methods.',
      'Each entry below is consumed by a known caller (controller, bootstrap, or another service).',
      'Removing it is a breaking change. See docs/architecture/orchestrator-inventory.md §2.',
      '',
      ...missing.map((m) => `  - ${m}`),
    ].join('\n')
  );
});

test('integration-orchestrator: constructor is zero-arg and does not throw', () => {
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new
    new moduleUnderTest.IntegrationOrchestratorService();
  }, 'new IntegrationOrchestratorService() must not throw — bootstrap registers it eagerly.');
});

test('integration-orchestrator: instance owns the four expected collaborators', () => {
  const inst = new moduleUnderTest.IntegrationOrchestratorService();
  for (const k of ['registryService', 'canonicalService', 'settingRepository', 'mappingService']) {
    assert.notEqual(
      inst[k],
      undefined,
      `IntegrationOrchestratorService instance must expose .${k} — the controller (and tests) reach for it directly today.`
    );
  }
});
