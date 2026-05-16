'use strict';

const { CanonicalInboundMessageService } = require('../../../services/canonical-inbound-message.service');

module.exports = {
  key: 'CANONICAL_APPLY',
  nodeType: 'canonical',
  displayName: 'Canonical Apply',
  category: 'Canonical',
  description: 'Persists and applies canonical messages via CanonicalInboundMessageService.ingest (existing pipeline).',
  configSchema: {
    type: 'object',
    properties: {
      autoApply: { type: 'boolean', default: true },
    },
    required: [],
    additionalProperties: false,
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const cfg = context.nodeConfig && typeof context.nodeConfig === 'object' ? context.nodeConfig : {};
    const autoApply = cfg.autoApply !== false;
    const payload = context.payload;
    const messages = payload?.canonicalMessages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { success: false, error: 'CANONICAL_APPLY requires input.canonicalMessages (non-empty array)' };
    }
    const svc = new CanonicalInboundMessageService();
    const rows = await svc.ingest(messages, { autoApply });
    return {
      success: true,
      payload: {
        canonicalApply: {
          count: rows.length,
          results: rows.map((r) => {
            const j = r.toJSON ? r.toJSON() : r;
            return { id: j.id, status: j.status, messageType: j.messageType, errorMessage: j.errorMessage };
          }),
        },
      },
    };
  },
};
