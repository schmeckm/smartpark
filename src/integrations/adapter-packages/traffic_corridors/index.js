'use strict';

const ADAPTER_KEY = 'traffic_corridors';

async function validateConfig() {
  return { valid: true, errors: [] };
}

async function health() {
  return { ok: true, message: `${ADAPTER_KEY} stub — feature gate; provider polling not implemented yet` };
}

async function discover() {
  return [
    {
      id: 'traffic_corridors_feature',
      name: 'Traffic corridor demand signals',
      entityType: 'TRAFFIC_CORRIDOR',
      domain: 'operations',
      suggestedSlug: 'traffic',
      metrics: [],
    },
  ];
}

/**
 * No upstream provider yet — returns empty observations so scheduler/run-now stay green.
 * Snapshot writes will be added when a traffic API adapter is implemented.
 */
async function poll() {
  return {
    observations: [],
    debug: {
      adapterKey: ADAPTER_KEY,
      mode: 'noop',
      message: 'Provider ingestion not implemented; manual snapshots via API/UI remain available when feature is installed.',
    },
  };
}

module.exports = { validateConfig, discover, poll, health };
