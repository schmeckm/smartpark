'use strict';

const { AppError } = require('../../../utils/app-error');
const { validateFlowJson, collectForbiddenKeys } = require('./integration-flow-validation.service');

function cloneJson(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @typedef {object} IntegrationFlowTemplateDef
 * @property {string} templateKey
 * @property {string} displayName
 * @property {string} description
 * @property {string} category
 * @property {string} defaultConfigNotes
 * @property {{ nodes: object[], edges: object[] }} flowJson
 * @property {Record<string, Set<string>>} allowedOverridesByNode
 */

/** @type {IntegrationFlowTemplateDef[]} */
const TEMPLATE_DEFS = [
  {
    templateKey: 'manual_themeparks_live_import',
    displayName: 'Manual ThemeParks Live Import',
    description:
      'Poll ThemeParks.wiki live data, map rows to canonical messages, ingest them, then publish earlier observations to UNS/MQTT (reuses hints from the adapter step).',
    category: 'Import',
    defaultConfigNotes: [
      'destinationId defaults to "europa-park" as a placeholder ThemeParks entity id — replace with your park’s id from the adapter.',
      'CANONICAL_MAPPING.mappings uses $.path templates against each liveData row (see ThemeParks poll shape). This is an example only; adjust paths if the API shape differs.',
      'externalParkId on the mapping node is a fallback when a row does not carry a park id.',
      'UNS_PUBLISH reads observations from runner execution hints set by THEMEPARKS_LIVE_ADAPTER when upstream payload has no observations array.',
    ].join('\n'),
    allowedOverridesByNode: {
      trigger_1: new Set(),
      adapter_1: new Set(['destinationId', 'parkId']),
      map_1: new Set(['eventType', 'provider', 'externalParkId', 'mappings']),
      apply_1: new Set(['autoApply']),
      publish_1: new Set(['parkSlug', 'maxObservations', 'profiles']),
    },
    flowJson: {
      nodes: [
        { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
        {
          id: 'adapter_1',
          type: 'THEMEPARKS_LIVE_ADAPTER',
          config: { destinationId: 'europa-park' },
        },
        {
          id: 'map_1',
          type: 'CANONICAL_MAPPING',
          config: {
            eventType: 'QUEUE_TIME_OBSERVED',
            provider: 'themeparks_wiki',
            externalParkId: 'europa-park',
            mappings: {
              externalEntityId: '$.id',
              name: '$.name',
              value: '$.queue.STANDBY.waitTime',
              status: '$.status',
              sampledAt: '$.lastUpdated',
              entityType: 'ATTRACTION',
            },
          },
        },
        { id: 'apply_1', type: 'CANONICAL_APPLY', config: { autoApply: true } },
        { id: 'publish_1', type: 'UNS_PUBLISH', config: { maxObservations: 10 } },
      ],
      edges: [
        { source: 'trigger_1', target: 'adapter_1' },
        { source: 'adapter_1', target: 'map_1' },
        { source: 'map_1', target: 'apply_1' },
        { source: 'apply_1', target: 'publish_1' },
      ],
    },
  },
  {
    templateKey: 'manual_canonical_test_flow',
    displayName: 'Manual Canonical Test Flow',
    description:
      'Minimal MANUAL trigger → canonical mapping → apply. Use run input JSON as a single synthetic row (e.g. { "id": "…", "name": "…", "value": 5 }).',
    category: 'Test',
    defaultConfigNotes: [
      'Intended for dry-runs: mapping templates use $.id / $.name / $.value against the manual payload object.',
      'Tune eventType / externalParkId for your environment before relying on ingest.',
    ].join('\n'),
    allowedOverridesByNode: {
      trigger_1: new Set(),
      map_1: new Set(['eventType', 'provider', 'externalParkId', 'mappings']),
      apply_1: new Set(['autoApply']),
    },
    flowJson: {
      nodes: [
        { id: 'trigger_1', type: 'MANUAL_TRIGGER', config: {} },
        {
          id: 'map_1',
          type: 'CANONICAL_MAPPING',
          config: {
            eventType: 'QUEUE_TIME_OBSERVED',
            provider: 'integration_flow_test',
            externalParkId: 'test-park',
            mappings: {
              externalEntityId: '$.id',
              name: '$.name',
              value: '$.value',
              status: '$.status',
              sampledAt: '$.sampledAt',
              entityType: 'ATTRACTION',
            },
          },
        },
        { id: 'apply_1', type: 'CANONICAL_APPLY', config: { autoApply: true } },
      ],
      edges: [
        { source: 'trigger_1', target: 'map_1' },
        { source: 'map_1', target: 'apply_1' },
      ],
    },
  },
];

/** @type {Map<string, IntegrationFlowTemplateDef>} */
const BY_KEY = new Map(TEMPLATE_DEFS.map((d) => [d.templateKey, d]));

function listTemplates() {
  return TEMPLATE_DEFS.map((t) => ({
    templateKey: t.templateKey,
    displayName: t.displayName,
    description: t.description,
    category: t.category,
    flowJson: cloneJson(t.flowJson),
    defaultConfigNotes: t.defaultConfigNotes,
  }));
}

function getTemplateOrThrow(templateKey) {
  const t = BY_KEY.get(String(templateKey || '').trim());
  if (!t) {
    throw new AppError('Unknown integration flow template', 404, { code: 'TEMPLATE_NOT_FOUND' });
  }
  return t;
}

/**
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {object} flowJson
 * @param {string} templateKey
 * @param {unknown} configOverrides
 */
function applySafeConfigOverrides(flowJson, templateKey, configOverrides) {
  const def = getTemplateOrThrow(templateKey);
  if (configOverrides == null) return;
  if (!isPlainObject(configOverrides)) {
    throw new AppError('configOverrides must be an object', 422, { code: 'INVALID_OVERRIDES' });
  }
  const nodesPatch = /** @type {Record<string, unknown>} */ (configOverrides).nodes;
  if (nodesPatch === undefined) return;
  if (!isPlainObject(nodesPatch)) {
    throw new AppError('configOverrides.nodes must be an object', 422, { code: 'INVALID_OVERRIDES' });
  }

  for (const nodeId of Object.keys(nodesPatch)) {
    const allowed = def.allowedOverridesByNode[nodeId];
    if (allowed === undefined) {
      throw new AppError(`Unknown override node "${nodeId}" for this template`, 422, {
        code: 'UNKNOWN_OVERRIDE_NODE',
      });
    }
    const patch = nodesPatch[nodeId];
    if (patch == null) continue;
    if (!isPlainObject(patch)) {
      throw new AppError(`Override for node "${nodeId}" must be an object`, 422, {
        code: 'INVALID_OVERRIDES',
      });
    }

    const node = flowJson.nodes.find((n) => n && n.id === nodeId);
    if (!node) {
      throw new AppError(`Flow template missing node "${nodeId}"`, 500, { code: 'TEMPLATE_CORRUPT' });
    }

    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        throw new AppError(`Disallowed config override key "${key}" on node "${nodeId}"`, 422, {
          code: 'UNSAFE_CONFIG_OVERRIDE',
        });
      }
    }

    for (const [k, v] of Object.entries(patch)) {
      if (k === 'mappings') {
        if (!isPlainObject(v)) {
          throw new AppError(`Override "mappings" must be an object`, 422, { code: 'INVALID_OVERRIDES' });
        }
        const fe = [];
        collectForbiddenKeys(v, `overrides.${nodeId}.mappings`, fe);
        if (fe.length) {
          throw new AppError('Mappings override contains forbidden keys', 422, {
            code: 'UNSAFE_CONFIG_OVERRIDE',
            details: fe,
          });
        }
        node.config = {
          ...node.config,
          mappings: { ...(node.config.mappings || {}), ...v },
        };
        continue;
      }
      if (k === 'profiles') {
        if (!Array.isArray(v)) {
          throw new AppError(`Override "profiles" must be an array`, 422, { code: 'INVALID_OVERRIDES' });
        }
        node.config = { ...node.config, profiles: v.map((x) => String(x)) };
        continue;
      }
      if (k === 'maxObservations') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 50) {
          throw new AppError('maxObservations must be between 1 and 50', 422, { code: 'INVALID_OVERRIDES' });
        }
        node.config = { ...node.config, maxObservations: Math.floor(n) };
        continue;
      }
      if (k === 'autoApply') {
        node.config = { ...node.config, autoApply: Boolean(v) };
        continue;
      }
      node.config = { ...node.config, [k]: v };
    }
  }
}

/**
 * Build flow_json for create(), validate graph.
 *
 * @param {string} templateKey
 * @param {unknown} configOverrides
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
async function buildFlowJsonForCreate(templateKey, configOverrides) {
  const def = getTemplateOrThrow(templateKey);
  const flowJson = cloneJson(def.flowJson);
  applySafeConfigOverrides(flowJson, templateKey, configOverrides);
  const validation = await validateFlowJson(flowJson);
  if (!validation.valid) {
    throw new AppError('Generated flow_json failed validation', 422, {
      code: 'FLOW_INVALID',
      details: validation.errors,
    });
  }
  return flowJson;
}

module.exports = {
  listTemplates,
  getTemplateOrThrow,
  buildFlowJsonForCreate,
  /** @internal tests */
  applySafeConfigOverrides,
  cloneJson,
};
