const { asyncHandler } = require('../utils/async-handler');
const { StaffService } = require('../services/staff.service');

const staffService = new StaffService();

const listStaff = asyncHandler(async (req, res) => {
  const staff = await staffService.listStaff();
  res.json({ success: true, data: staff });
});

const getStaff = asyncHandler(async (req, res) => {
  const member = await staffService.getStaffById(req.params.id);
  res.json({ success: true, data: member });
});

const createStaff = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const member = await staffService.createStaff(payload);
  res.status(201).json({ success: true, data: member });
});

const updateStaff = asyncHandler(async (req, res) => {
  const payload = req.validated || req.body;
  const member = await staffService.updateStaff(req.params.id, payload);
  res.json({ success: true, data: member });
});

const deleteStaff = asyncHandler(async (req, res) => {
  await staffService.deleteStaff(req.params.id);
  res.status(204).send();
});

const exportStaffJson = asyncHandler(async (req, res) => {
  const data = await staffService.exportJsonBundle();
  res.json({ success: true, data });
});

const importStaffJson = asyncHandler(async (req, res) => {
  const data = await staffService.importBundle(req.validated || req.body, req.user);
  res.json({ success: true, data });
});

const exportStaffXlsx = asyncHandler(async (req, res) => {
  const buf = await staffService.exportXlsxBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="staff-roster.xlsx"');
  res.send(buf);
});

const importStaffXlsx = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    const { AppError } = require('../utils/app-error');
    throw new AppError('Upload a single .xlsx file as multipart field "file"', 400, { code: 'FILE_REQUIRED' });
  }
  const data = await staffService.importXlsxBuffer(req.file.buffer, req.user);
  res.json({ success: true, data });
});

module.exports = {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  exportStaffJson,
  importStaffJson,
  exportStaffXlsx,
  importStaffXlsx,
};
