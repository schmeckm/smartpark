const { asyncHandler } = require('../utils/async-handler');
const { DashboardService } = require('../services/dashboard.service');

const dashboardService = new DashboardService();

const getSummary = asyncHandler(async (req, res) => {
  const summary = await dashboardService.getSummary();
  res.json({ success: true, data: summary });
});

module.exports = { getSummary };
