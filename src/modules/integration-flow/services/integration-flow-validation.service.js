'use strict';

const env = require('../../../config/env');
const integrationNodeRegistry = require('./integration-node-registry.service');

const FORBIDDEN_KEYS = new Set([
  'script',
  'code',
  'eval',
  'functionbody',
  'expression',
  'vm',
  'wasm',
  'child_process',
]);

/**
 * @param {unknown} value
 * @param {string} pathPrefix
 * @param {string[]} errors
 */
function collectForbiddenKeys(value, pathPrefix, errors) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectForbiddenKeys(v, `${pathPrefix}[${i}]`, errors));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const lk = k.toLowerCase();
      if (FORBIDDEN_KEYS.has(lk)) {
        const allowPayloadTransformScriptField =
          lk === 'script' && /^flow_json\.nodes\.[^.]+\.config$/.test(String(pathPrefix || ''));
        if (!allowPayloadTransformScriptField) {
          errors.push(`Forbidden field "${k}" at ${pathPrefix || '$'}`);
        }
      }
      collectForbiddenKeys(v, pathPrefix ? `${pathPrefix}.${k}` : k, errors);
    }
  }
}

/**
 * @param {unknown} flowJson
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[] }>}
 */
async function validateFlowJson(flowJson) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!flowJson || typeof flowJson !== 'object' || Array.isArray(flowJson)) {
    errors.push('flow_json must be a non-array object');
    return { valid: false, errors, warnings };
  }

  const keys = Object.keys(flowJson);
  const allowed = new Set(['nodes', 'edges']);
  for (const k of keys) {
    if (!allowed.has(k)) errors.push(`Unknown top-level key: ${k}`);
  }

  if (!Array.isArray(flowJson.nodes)) errors.push('flow_json.nodes must be an array');
  if (!Array.isArray(flowJson.edges)) errors.push('flow_json.edges must be an array');

  collectForbiddenKeys(flowJson, 'flow_json', errors);

  if (errors.length) return { valid: false, errors, warnings };

  const nodes = flowJson.nodes;
  const edges = flowJson.edges;

  const byId = new Map();
  for (const n of nodes) {
    if (!n || typeof n !== 'object') {
      errors.push('each node must be an object');
      continue;
    }
    if (!n.id || typeof n.id !== 'string') errors.push('each node must have string id');
    if (!n.type || typeof n.type !== 'string') errors.push(`node ${n.id || '?'} must have string type`);
    if (!n.config || typeof n.config !== 'object' || Array.isArray(n.config)) {
      errors.push(`node ${n.id || '?'} must have object config`);
    }
    if (n.position != null) {
      const p = n.position;
      if (typeof p !== 'object' || Array.isArray(p)) {
        errors.push(`node ${n.id || '?'} position must be an object with numeric x and y`);
      } else {
        const x = p.x;
        const y = p.y;
        if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
          errors.push(`node ${n.id || '?'} position.x and position.y must be finite numbers`);
        }
      }
    }
    collectForbiddenKeys(n, `flow_json.nodes.${n.id || 'unknown'}`, errors);
    if (n.id && byId.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    if (n.id) byId.set(n.id, n);
  }

  await integrationNodeRegistry.ensureSynced();

  for (const n of nodes) {
    if (!n?.type) continue;
    const check = await integrationNodeRegistry.assertNodeTypeEnabled(n.type);
    if (!check.ok) errors.push(check.reason);
    if (n.type === 'PAYLOAD_TRANSFORM' && n.config && typeof n.config === 'object') {
      const mode = n.config.mode != null ? String(n.config.mode) : 'mapping';
      if (mode === 'script') {
        if (!env.integrationFlowScriptNodeEnabled) {
          errors.push(`node ${n.id}: PAYLOAD_TRANSFORM script mode is disabled by governance`);
        }
      } else if (mode === 'mapping') {
        const mappings = n.config.mappings;
        if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) || !Object.keys(mappings).length) {
          errors.push(`node ${n.id}: PAYLOAD_TRANSFORM mapping mode requires non-empty config.mappings`);
        }
      } else {
        errors.push(`node ${n.id}: PAYLOAD_TRANSFORM unsupported mode "${mode}"`);
      }
    }
  }

  for (const e of edges) {
    if (!e || typeof e !== 'object') {
      errors.push('each edge must be an object');
      continue;
    }
    if (!e.source || typeof e.source !== 'string' || !e.target || typeof e.target !== 'string') {
      errors.push('each edge must have string source and target');
      continue;
    }
    if (!byId.has(e.source)) errors.push(`edge source not found: ${e.source}`);
    if (!byId.has(e.target)) errors.push(`edge target not found: ${e.target}`);
    collectForbiddenKeys(e, `flow_json.edge[${e.source}->${e.target}]`, errors);
  }

  if (errors.length) return { valid: false, errors, warnings };

  /** @type {Map<string, number>} */
  const incoming = new Map();
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const id of byId.keys()) {
    incoming.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    incoming.set(e.target, incoming.get(e.target) + 1);
  }

  const starts = [...byId.keys()].filter((id) => incoming.get(id) === 0);
  if (starts.length === 0) errors.push('graph has no start node (in-degree zero)');
  if (starts.length > 1) errors.push(`MVP requires exactly one start node; found ${starts.length}`);

  if (errors.length) return { valid: false, errors, warnings };

  const start = starts[0];
  /** @type {string[]} */
  const topo = [];
  const inCopy = new Map(incoming);
  /** @type {string[]} */
  const q = [start];
  while (q.length) {
    const u = q.shift();
    topo.push(u);
    for (const v of adj.get(u)) {
      inCopy.set(v, inCopy.get(v) - 1);
      if (inCopy.get(v) === 0) q.push(v);
    }
  }

  if (topo.length !== byId.size) {
    errors.push('graph has a cycle or unreachable nodes (topological sort incomplete)');
  }

  const reachable = new Set();
  (function dfs(u) {
    reachable.add(u);
    for (const v of adj.get(u)) if (!reachable.has(v)) dfs(v);
  })(start);
  if (reachable.size !== byId.size) {
    errors.push('graph has disconnected nodes');
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateFlowJson, collectForbiddenKeys };
