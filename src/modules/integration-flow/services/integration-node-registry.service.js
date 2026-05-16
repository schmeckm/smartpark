'use strict';

const { IntegrationNodeRegistry } = require('../../../models');

const NODE_MODULES = [
  require('../nodes/manual-trigger.node.js'),
  require('../nodes/themeparks-live-adapter.node.js'),
  require('../nodes/canonical-mapping.node.js'),
  require('../nodes/canonical-apply.node.js'),
  require('../nodes/uns-publish.node.js'),
  require('../nodes/payload-transform.node.js'),
  require('../nodes/generate-output-file.node.js'),
];

/** @returns {Map<string, object>} */
function getDiskNodeMap() {
  const m = new Map();
  for (const mod of NODE_MODULES) {
    if (!mod || !mod.key) continue;
    m.set(String(mod.key), mod);
  }
  return m;
}

let syncPromise = null;

async function syncRegistryRows() {
  const disk = getDiskNodeMap();
  for (const [nodeKey, mod] of disk) {
    const existing = await IntegrationNodeRegistry.findOne({ where: { nodeKey } });
    const base = {
      nodeKey,
      nodeType: String(mod.nodeType || 'unknown'),
      displayName: String(mod.displayName || nodeKey),
      category: mod.category != null ? String(mod.category) : null,
      description: mod.description != null ? String(mod.description) : null,
      configSchema: mod.configSchema ?? null,
      inputSchema: mod.inputSchema ?? null,
      outputSchema: mod.outputSchema ?? null,
    };
    if (existing) {
      await existing.update({
        ...base,
      });
    } else {
      await IntegrationNodeRegistry.create({
        ...base,
        enabled: true,
      });
    }
  }
}

/**
 * Ensure DB registry rows exist for built-in nodes (idempotent).
 */
async function ensureSynced() {
  if (!syncPromise) {
    syncPromise = syncRegistryRows().catch((e) => {
      syncPromise = null;
      throw e;
    });
  }
  return syncPromise;
}

async function listEnabledMetadata() {
  await ensureSynced();
  const rows = await IntegrationNodeRegistry.findAll({
    where: { enabled: true },
    order: [['category', 'ASC'], ['nodeKey', 'ASC']],
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function getRegistryEntryMap() {
  await ensureSynced();
  const rows = await IntegrationNodeRegistry.findAll();
  /** @type {Map<string, { disk: object, row: object }>} */
  const out = new Map();
  const disk = getDiskNodeMap();
  for (const row of rows) {
    const j = row.toJSON ? row.toJSON() : row;
    const mod = disk.get(j.nodeKey);
    if (mod) out.set(j.nodeKey, { disk: mod, row: j });
  }
  return out;
}

/**
 * @param {string} typeKey
 */
async function assertNodeTypeEnabled(typeKey) {
  const k = String(typeKey || '').trim();
  const registry = await getRegistryEntryMap();
  const entry = registry.get(k);
  if (!entry) return { ok: false, reason: `unknown node type: ${k}` };
  if (!entry.row.enabled) return { ok: false, reason: `node type disabled: ${k}` };
  return { ok: true, entry };
}

function getExecutable(typeKey) {
  const mod = getDiskNodeMap().get(String(typeKey || '').trim());
  return mod || null;
}

module.exports = {
  NODE_MODULES,
  getDiskNodeMap,
  ensureSynced,
  listEnabledMetadata,
  getRegistryEntryMap,
  assertNodeTypeEnabled,
  getExecutable,
};
