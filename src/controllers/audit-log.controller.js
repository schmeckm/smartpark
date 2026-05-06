const { asyncHandler } = require('../utils/async-handler');
const { AuditLogRepository } = require('../repositories/audit-log.repository');

const auditLogRepository = new AuditLogRepository();

const listAuditLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const [rows, total] = await Promise.all([
    auditLogRepository.findAll({ limit, offset }),
    auditLogRepository.count(),
  ]);
  res.json({ success: true, data: rows, meta: { total, limit, offset } });
});

module.exports = { listAuditLogs };
