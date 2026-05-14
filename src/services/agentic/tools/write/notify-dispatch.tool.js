'use strict';

const { AuditLogService } = require('../../../audit-log.service');
const AUDIT = require('../../../../constants/audit-actions');

const auditLogService = new AuditLogService();

/** Phase B stub: records an operator-visible audit entry (no external push provider yet). */
const writeNotifyDispatchTool = {
  name: 'write.notify_dispatch',
  description: 'Log a notify/dispatch intent to the audit trail (Phase B stub; replace with real channels later).',
  schema: {
    type: 'object',
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 4000 },
      severity: { type: 'string', maxLength: 32 },
    },
    additionalProperties: false,
  },
  requiresApproval: true,
  async execute(context, args) {
    await auditLogService.log({
      action: AUDIT.AGENT_NOTIFY_DISPATCH,
      entityType: 'agent_run',
      entityId: context.runId || null,
      newValue: {
        parkId: context.parkId,
        message: args.message,
        severity: args.severity ?? null,
      },
      userId: context.actingUser?.id ?? null,
    });
    return { dispatched: 'audit_stub', message: args.message };
  },
};

module.exports = { writeNotifyDispatchTool };
