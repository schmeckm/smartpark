const { asyncHandler } = require('../utils/async-handler');
const { DataQualityService } = require('../services/data-quality.service');

const svc = new DataQualityService();

const list = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  let resolved;
  if (req.query.resolved === 'true') resolved = true;
  else if (req.query.resolved === 'false') resolved = false;
  const [rows, total] = await Promise.all([
    svc.list({ limit, offset, resolved }),
    svc.count({ resolved }),
  ]);
  res.json({ success: true, data: rows, meta: { total, limit, offset } });
});

const resolve = asyncHandler(async (req, res) => {
  const row = await svc.resolve(req.params.id);
  if (!row) {
    const { AppError } = require('../utils/app-error');
    throw new AppError('Issue not found', 404, { code: 'NOT_FOUND' });
  }
  res.json({ success: true, data: row });
});

module.exports = { list, resolve };
