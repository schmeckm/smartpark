'use strict';

const { IncidentService } = require('../../../incident.service');

const incidentService = new IncidentService();

const incidentsListTool = {
  name: 'read.incidents_list',
  description: 'Lists recent incidents for the scoped park (read-only).',
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 },
      status: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(_context, args) {
    const parkId = args.parkId;
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 25));
    const offset = Math.max(0, Number(args.offset) || 0);
    const status = args.status || undefined;
    return incidentService.listForPark(parkId, { status, limit, offset });
  },
};

module.exports = { incidentsListTool };
