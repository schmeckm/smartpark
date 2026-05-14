'use strict';

const { IncidentService } = require('../../../incident.service');

const incidentService = new IncidentService();

/** Opens an incident via existing {@link IncidentService} (RBAC on approve path). */
const writeIncidentOpenTool = {
  name: 'write.incident_open',
  description: 'Create an incident in the scoped park (requires approved agent action).',
  schema: {
    type: 'object',
    required: ['title', 'severity', 'status'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string' },
      severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] },
    },
    additionalProperties: false,
  },
  requiresApproval: true,
  async execute(context, args) {
    const user = context.actingUser;
    return incidentService.create(context.parkId, user, {
      title: args.title,
      description: args.description ?? null,
      severity: args.severity,
      status: args.status,
    });
  },
};

module.exports = { writeIncidentOpenTool };
