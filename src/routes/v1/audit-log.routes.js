const { Router } = require('express');
const auditLogController = require('../../controllers/audit-log.controller');
const { requirePermission } = require('../../middleware/rbac.middleware');

const router = Router();

router.get('/', requirePermission('audit', 'read'), auditLogController.listAuditLogs);

module.exports = { auditLogRouter: router };
