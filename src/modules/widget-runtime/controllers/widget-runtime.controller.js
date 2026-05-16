'use strict';

const { asyncHandler } = require('../../../utils/async-handler');
const { AuditLogService } = require('../../../services/audit-log.service');
const widgetRegistry = require('../services/widget-registry.service');
const dataSourceRegistry = require('../services/widget-data-source-registry.service');
const { WidgetInstanceService } = require('../services/widget-instance.service');

const auditLogService = new AuditLogService();
const instanceService = new WidgetInstanceService({ auditLogService });

const listWidgets = asyncHandler(async (_req, res) => {
  const data = await widgetRegistry.listEnabled();
  res.json({ success: true, data });
});

const listDataSources = asyncHandler(async (_req, res) => {
  const data = await dataSourceRegistry.listEnabled();
  res.json({ success: true, data });
});

const listInstances = asyncHandler(async (req, res) => {
  const data = await instanceService.list(req.validated || {});
  res.json({ success: true, data });
});

const getInstance = asyncHandler(async (req, res) => {
  const data = await instanceService.getById(req.validated.id);
  res.json({ success: true, data });
});

const createInstance = asyncHandler(async (req, res) => {
  const data = await instanceService.create(req.validated, {
    userId: req.user?.id,
    email: req.user?.email,
  });
  res.status(201).json({ success: true, data });
});

const patchInstance = asyncHandler(async (req, res) => {
  const { id, ...body } = req.validated;
  const data = await instanceService.update(id, body, {
    userId: req.user?.id,
    email: req.user?.email,
  });
  res.json({ success: true, data });
});

const deleteInstance = asyncHandler(async (req, res) => {
  await instanceService.deleteById(req.validated.id, { userId: req.user?.id });
  res.json({ success: true, data: { deleted: true } });
});

const validateInstance = asyncHandler(async (req, res) => {
  const data = await instanceService.validateInstance(req.validated.id);
  res.json({ success: true, data });
});

const getInstanceData = asyncHandler(async (req, res) => {
  const data = await instanceService.resolveInstanceData(req.validated.id);
  res.json({ success: true, data });
});

module.exports = {
  listWidgets,
  listDataSources,
  listInstances,
  getInstance,
  createInstance,
  patchInstance,
  deleteInstance,
  validateInstance,
  getInstanceData,
};
