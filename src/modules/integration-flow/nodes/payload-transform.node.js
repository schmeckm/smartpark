'use strict';

const env = require('../../../config/env');
const { getByDollarPath } = require('../utils/json-path.util');

function resolveMappingValue(template, root) {
  if (template == null) return null;
  if (typeof template === 'string' && template.trim().startsWith('$')) {
    return getByDollarPath(root, template.trim());
  }
  return template;
}

/**
 * @param {Record<string, unknown>} mappings
 * @param {unknown} root
 * @returns {Record<string, unknown>}
 */
function applyMappings(mappings, root) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [outKey, tpl] of Object.entries(mappings)) {
    out[outKey] = resolveMappingValue(tpl, root);
  }
  return out;
}

module.exports = {
  key: 'PAYLOAD_TRANSFORM',
  nodeType: 'transform',
  displayName: 'Payload Transform',
  category: 'Transform',
  description:
    'Maps fields from the incoming payload into a new output shape using declarative JSON paths (no arbitrary code in mapping mode).',
  configSchema: {
    type: 'object',
    required: ['mode'],
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: ['mapping', 'script'], default: 'mapping' },
      mappings: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Output field → $.json.path template',
      },
      outputRoot: {
        type: 'string',
        default: 'payload',
        description: 'When not "payload", wrap mapped fields under this key',
      },
      script: {
        type: 'string',
        description: 'Advanced script body (governance-gated; disabled by default)',
      },
    },
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const cfg = context.nodeConfig && typeof context.nodeConfig === 'object' ? context.nodeConfig : {};
    const mode = cfg.mode != null ? String(cfg.mode) : 'mapping';
    const upstream =
      context.payload !== undefined
        ? context.payload
        : context.input !== undefined
          ? context.input
          : null;

    if (mode === 'script') {
      if (!env.integrationFlowScriptNodeEnabled) {
        return { success: false, error: 'Script mode is disabled by governance.' };
      }
      return {
        success: false,
        error: 'Script mode requires a secure sandbox; it is not enabled in this environment.',
      };
    }

    if (mode !== 'mapping') {
      return { success: false, error: `PAYLOAD_TRANSFORM: unsupported mode "${mode}"` };
    }

    const mappings = cfg.mappings && typeof cfg.mappings === 'object' && !Array.isArray(cfg.mappings) ? cfg.mappings : {};
    if (!Object.keys(mappings).length) {
      return { success: false, error: 'PAYLOAD_TRANSFORM mapping mode requires config.mappings' };
    }

    const mapped = applyMappings(mappings, upstream);
    const outputRoot = cfg.outputRoot != null ? String(cfg.outputRoot).trim() : 'payload';
    if (!outputRoot || outputRoot === 'payload') {
      return { success: true, payload: mapped };
    }
    return { success: true, payload: { [outputRoot]: mapped } };
  },
};
