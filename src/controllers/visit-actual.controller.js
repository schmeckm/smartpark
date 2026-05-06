const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { VisitActualYearlyService } = require('../services/visit-actual.service');

const visitActualService = new VisitActualYearlyService();

const getVisitActualYear = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const year = (req.validated || {}).actualYear;
  const data = await visitActualService.getForParkYear(parkId, year);
  res.json({ success: true, data });
});

const putVisitActualYear = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const v = req.validated || {};
  const year = v.actualYear;
  try {
    const data = await visitActualService.upsertForParkYear(parkId, year, v.guestCounts);
    res.json({ success: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('ACTUAL_DATE_OUTSIDE_YEAR')) {
      throw new AppError('All guestCounts dates must fall within actualYear', 422, {
        code: 'ACTUAL_YEAR_MISMATCH',
      });
    }
    if (msg.startsWith('INVALID_ACTUAL_DATE_KEY')) {
      throw new AppError('Invalid guestCounts cell key', 422, { code: 'INVALID_CELL_KEY' });
    }
    throw e;
  }
});

module.exports = {
  getVisitActualYear,
  putVisitActualYear,
};
