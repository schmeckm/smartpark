const multer = require('multer');
const { asyncHandler } = require('../utils/async-handler');
const { ImportService } = require('../services/import.service');
const { AppError } = require('../utils/app-error');

const importService = new ImportService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const staff = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('file is required (multipart field: file)', 400, { code: 'FILE_REQUIRED' });
  const s = await importService.importStaff(req.file.buffer, req.file.originalname);
  res.json({ success: true, data: s });
});

const rides = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('file is required (multipart field: file)', 400, { code: 'FILE_REQUIRED' });
  const s = await importService.importRides(req.file.buffer, req.file.originalname);
  res.json({ success: true, data: s });
});

const zones = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('file is required (multipart field: file)', 400, { code: 'FILE_REQUIRED' });
  const s = await importService.importZones(req.file.buffer, req.file.originalname);
  res.json({ success: true, data: s });
});

const uploadFile = [upload.single('file')];

module.exports = { staff, rides, zones, uploadFile };
