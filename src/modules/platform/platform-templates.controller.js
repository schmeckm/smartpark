const { asyncHandler } = require('../../utils/async-handler');

const listRideTemplates = asyncHandler(async (_req, res) => {
  const { RideTemplate } = require('../../models');
  const data = await RideTemplate.findAll({ order: [['code', 'ASC']] });
  res.json({ success: true, data });
});

const listStaffingTemplates = asyncHandler(async (_req, res) => {
  const { StaffingTemplate } = require('../../models');
  const data = await StaffingTemplate.findAll({ order: [['code', 'ASC']] });
  res.json({ success: true, data });
});

const listMaintenanceTemplates = asyncHandler(async (_req, res) => {
  const { MaintenanceTemplate } = require('../../models');
  const data = await MaintenanceTemplate.findAll({ order: [['code', 'ASC']] });
  res.json({ success: true, data });
});

module.exports = { listRideTemplates, listStaffingTemplates, listMaintenanceTemplates };
