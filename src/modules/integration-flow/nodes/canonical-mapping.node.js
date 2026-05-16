'use strict';

const { getByDollarPath } = require('../utils/json-path.util');

function extractRows(input) {
  if (!input || typeof input !== 'object') return [];
  if (Array.isArray(input)) return input;
  if (Array.isArray(input.canonicalMessages)) return [];
  const live = input.debug?.rawInput?.live;
  if (live && Array.isArray(live.liveData)) return live.liveData;
  if (Array.isArray(input.observations)) {
    return input.observations.map((o) => o.rawPayload || o).filter(Boolean);
  }
  return [input];
}

function resolveMappingValue(template, row) {
  if (template == null) return null;
  if (typeof template === 'string' && template.trim().startsWith('$')) {
    return getByDollarPath(row, template.trim());
  }
  return template;
}

module.exports = {
  key: 'CANONICAL_MAPPING',
  nodeType: 'transform',
  displayName: 'Canonical Mapping',
  category: 'Transform',
  description: 'Maps external rows into canonical inbound message objects (simple $.path templates).',
  configSchema: {
    type: 'object',
    required: ['eventType', 'mappings'],
    additionalProperties: false,
    properties: {
      eventType: { type: 'string' },
      mappings: { type: 'object', additionalProperties: true },
      provider: { type: 'string', default: 'themeparks_wiki' },
      externalParkId: { type: 'string', description: 'Fallback when not mapped from row' },
    },
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const cfg = context.nodeConfig && typeof context.nodeConfig === 'object' ? context.nodeConfig : {};
    const eventType = cfg.eventType;
    const mappings = cfg.mappings && typeof cfg.mappings === 'object' ? cfg.mappings : {};
    const provider = cfg.provider != null ? String(cfg.provider) : 'themeparks_wiki';
    const fallbackPark = cfg.externalParkId != null ? String(cfg.externalParkId) : null;

    if (!eventType || typeof eventType !== 'string') {
      return { success: false, error: 'CANONICAL_MAPPING requires config.eventType' };
    }

    const upstream =
      context.payload !== undefined
        ? context.payload
        : context.input !== undefined
          ? context.input
          : null;
    const rows = extractRows(upstream);
    const now = new Date();
    /** @type {object[]} */
    const canonicalMessages = [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      /** @type {Record<string, unknown>} */
      const flat = {};
      for (const [outKey, tpl] of Object.entries(mappings)) {
        flat[outKey] = resolveMappingValue(tpl, row);
      }

      const externalEntityId = flat.externalEntityId != null ? String(flat.externalEntityId) : String(row.id || '');
      const externalParkId =
        flat.externalParkId != null && String(flat.externalParkId).trim() !== ''
          ? String(flat.externalParkId)
          : fallbackPark ||
            (context.context?.externalParkId
              ? String(context.context.externalParkId)
              : null);

      const sampledAt = flat.sampledAt || flat.timestamp || row.lastUpdated || now.toISOString();
      const payload = {
        waitTime: flat.value != null ? flat.value : flat.waitTime,
        status: flat.status != null ? flat.status : row.status,
        externalEntityName: flat.name != null ? flat.name : row.name,
        sampledAt: typeof sampledAt === 'string' || sampledAt instanceof Date ? sampledAt : now.toISOString(),
        isOpen: flat.isOpen != null ? flat.isOpen : row.status !== 'CLOSED',
      };

      canonicalMessages.push({
        messageType: eventType,
        provider,
        externalParkId: externalParkId || 'unknown',
        externalEntityId: externalEntityId || 'unknown',
        entityType: flat.entityType != null ? String(flat.entityType) : 'ATTRACTION',
        occurredAt: new Date(sampledAt instanceof Date ? sampledAt : sampledAt),
        receivedAt: now,
        payload,
        rawPayload: row,
      });
    }

    return { success: true, payload: { canonicalMessages } };
  },
};
