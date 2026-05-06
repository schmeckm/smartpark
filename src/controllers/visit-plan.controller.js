const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { VisitPlanService } = require('../services/visit-plan.service');

const visitPlanService = new VisitPlanService();

const listVisitPlans = asyncHandler(async (req, res) => {
  const q = req.validated || {};
  const parkId = req.parkContext.id;
  const items = await visitPlanService.listForPark(parkId, q.year);
  res.json({ success: true, data: items });
});

const getVisitPlan = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const row = await visitPlanService.getByIdForPark(req.params.id, parkId);
  if (!row) throw new AppError('Visit plan version not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const createVisitPlan = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  try {
    const data = await visitPlanService.create(parkId, req.user, body);
    res.status(201).json({ success: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('GUEST_COUNT_DATE_OUTSIDE_PLAN_YEAR')) {
      throw new AppError('All guestCounts dates must fall within planYear', 422, {
        code: 'PLAN_YEAR_MISMATCH',
      });
    }
    if (msg.startsWith('INVALID_PAYLOAD_DATE_KEY')) {
      throw new AppError('Invalid guestCounts cell key', 422, { code: 'INVALID_CELL_KEY' });
    }
    throw e;
  }
});

const patchVisitPlan = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const parkId = req.parkContext.id;
  try {
    const data = await visitPlanService.patch(req.params.id, parkId, body);
    if (!data) throw new AppError('Visit plan version not found', 404, { code: 'NOT_FOUND' });
    res.json({ success: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('GUEST_COUNT_DATE_OUTSIDE_PLAN_YEAR')) {
      throw new AppError('All guestCounts dates must fall within planYear', 422, {
        code: 'PLAN_YEAR_MISMATCH',
      });
    }
    if (msg.startsWith('INVALID_PAYLOAD_DATE_KEY')) {
      throw new AppError('Invalid guestCounts cell key', 422, { code: 'INVALID_CELL_KEY' });
    }
    throw e;
  }
});

const deleteVisitPlan = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const ok = await visitPlanService.delete(req.params.id, parkId);
  if (!ok) throw new AppError('Visit plan version not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: { deleted: true, id: req.params.id } });
});

const exportVisitPlanXlsx = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const result = await visitPlanService.exportXlsxBuffer(req.params.id, parkId);
  if (!result) throw new AppError('Visit plan version not found', 404, { code: 'NOT_FOUND' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.buffer);
});

const forecastVisitPlan = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const v = req.validated || {};
  try {
    const out = await visitPlanService.applyForecast(v.id, parkId, {
      method: v.method,
      sourceYear: v.sourceYear,
      scale: v.scale,
      emptyOnly: v.emptyOnly,
    });
    if (!out) throw new AppError('Visit plan version not found', 404, { code: 'NOT_FOUND' });
    res.json({ success: true, data: out.detail, meta: { forecastSummary: out.forecastSummary } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'NO_ACTUALS_FOR_SOURCE_YEAR') {
      throw new AppError('No stored actuals (Ist) for sourceYear — save Ist data first', 422, {
        code: 'NO_ACTUALS',
      });
    }
    if (msg === 'UNSUPPORTED_FORECAST_METHOD') {
      throw new AppError('Unsupported forecast method', 400, { code: 'BAD_METHOD' });
    }
    if (msg.startsWith('GUEST_COUNT_DATE_OUTSIDE_PLAN_YEAR')) {
      throw new AppError('All guestCounts dates must fall within planYear', 422, {
        code: 'PLAN_YEAR_MISMATCH',
      });
    }
    if (msg.startsWith('INVALID_PAYLOAD_DATE_KEY')) {
      throw new AppError('Invalid guestCounts cell key', 422, { code: 'INVALID_CELL_KEY' });
    }
    throw e;
  }
});

const importVisitPlanXlsx = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Upload a single .xlsx file as multipart field "file"', 400, { code: 'FILE_REQUIRED' });
  }
  const parkId = req.parkContext.id;
  try {
    const out = await visitPlanService.importXlsx(req.params.id, parkId, req.file.buffer);
    if (!out) throw new AppError('Visit plan version not found', 404, { code: 'NOT_FOUND' });
    res.json({
      success: true,
      data: out.detail,
      meta: { importSummary: out.summary },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('GUEST_COUNT_DATE_OUTSIDE_PLAN_YEAR')) {
      throw new AppError('All guestCounts dates must fall within planYear', 422, {
        code: 'PLAN_YEAR_MISMATCH',
      });
    }
    if (msg.startsWith('INVALID_PAYLOAD_DATE_KEY')) {
      throw new AppError('Invalid guestCounts cell key', 422, { code: 'INVALID_CELL_KEY' });
    }
    throw e;
  }
});

module.exports = {
  listVisitPlans,
  getVisitPlan,
  createVisitPlan,
  patchVisitPlan,
  deleteVisitPlan,
  exportVisitPlanXlsx,
  importVisitPlanXlsx,
  forecastVisitPlan,
};
