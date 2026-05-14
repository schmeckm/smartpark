'use strict';

const { operationsFactsService } = require('../../../operations/operations-facts.service');

/** Read-only park-scoped operations dashboard envelope (Operations Facts HTTP helper). */
const dashboardSummaryTool = {
  name: 'read.dashboard_summary',
  description: 'Returns park-level operations facts envelope (timestamp, ride cards stub, meta).',
  schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_context, args) {
    const parkId = args.parkId;
    return operationsFactsService.getParkFacts({ parkId });
  },
};

module.exports = { dashboardSummaryTool };
