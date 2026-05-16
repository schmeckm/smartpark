'use strict';

const themeparksWiki = require('../../../integrations/adapter-packages/themeparks_wiki/index');

module.exports = {
  key: 'THEMEPARKS_LIVE_ADAPTER',
  nodeType: 'adapter',
  displayName: 'ThemeParks.wiki Live',
  category: 'Adapter',
  description: 'Fetches live entity data via the installed ThemeParks.wiki adapter poll (no duplicated HTTP logic).',
  configSchema: {
    type: 'object',
    properties: {
      destinationId: { type: 'string', description: 'ThemeParks park / entity id (same as adapter parkId)' },
      parkId: {
        type: ['string', 'null'],
        description: 'Optional platform park UUID / external id (null clears override)',
      },
    },
    required: [],
    additionalProperties: false,
  },
  inputSchema: {},
  outputSchema: {},
  async execute(context) {
    const cfg = context.nodeConfig && typeof context.nodeConfig === 'object' ? context.nodeConfig : {};
    const parkId = cfg.parkId || cfg.destinationId || null;
    const result = await themeparksWiki.poll({ parkId: parkId || undefined });
    return { success: true, payload: result };
  },
};
