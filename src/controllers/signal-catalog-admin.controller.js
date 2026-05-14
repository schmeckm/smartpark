'use strict';

const { asyncHandler } = require('../utils/async-handler');
const {
  listSignalCatalog,
  createOperatorSignal,
  updateOperatorSignal,
  deleteOperatorSignal,
} = require('../services/signal-catalog-admin.service');

const getSignalCatalog = asyncHandler(async (req, res) => {
  const data = await listSignalCatalog();
  res.json({ success: true, data });
});

const postSignalCatalog = asyncHandler(async (req, res) => {
  const row = await createOperatorSignal(req.body || {});
  res.status(201).json({ success: true, data: row });
});

const patchSignalCatalog = asyncHandler(async (req, res) => {
  const row = await updateOperatorSignal(req.params.catalogId, req.body || {});
  res.json({ success: true, data: row });
});

const deleteSignalCatalog = asyncHandler(async (req, res) => {
  const data = await deleteOperatorSignal(req.params.catalogId);
  res.json({ success: true, data });
});

module.exports = {
  getSignalCatalog,
  postSignalCatalog,
  patchSignalCatalog,
  deleteSignalCatalog,
};
