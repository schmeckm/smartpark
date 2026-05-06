const { asyncHandler } = require('../utils/async-handler');
const { IntegrationEventLogRepository } = require('../repositories/integration-event-log.repository');

const repo = new IntegrationEventLogRepository();

const listLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const [rows, total] = await Promise.all([repo.findAll({ limit, offset }), repo.count()]);
  res.json({ success: true, data: rows, meta: { total, limit, offset } });
});

module.exports = { listLogs };
