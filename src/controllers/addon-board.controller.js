const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { resolveUserRoleCodes } = require('../constants/role-codes');
const { AddonBoardService } = require('../services/addon-board.service');
const {
  listAddonBoardTemplateIds,
  getAddonBoardTemplate,
  getAddonBoardEffectiveLayout,
} = require('../services/addon-board-config.service');
const {
  getWidgetSourceDraftPreview,
  saveWidgetSourceDraft,
} = require('../services/addon-board-widget-source.service');
const {
  getCustomWidgetsForRide,
  promoteWidgetFromSourceDraft,
  patchCustomWidgetForRide,
  deleteCustomWidgetForRide,
} = require('../services/addon-board-ride-custom-widgets.service');
const { validateWidgetSourceDraftBody } = require('../validators/addon-board-widget-source.validator');
const { validatePatchCustomWidgetBody } = require('../validators/addon-board-custom-widget-lifecycle.validator');

const svc = new AddonBoardService();

const getSummary = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await svc.getParkSummary(parkId);
  res.json({ success: true, data });
});

const getRides = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await svc.getParkRides(parkId);
  res.json({ success: true, data });
});

const getCriticalRides = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const limit = req.query?.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 25;
  const data = await svc.getCriticalRides(parkId, { limit });
  res.json({ success: true, data });
});

const getZoneSummary = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { zoneId } = req.params;
  const data = await svc.getZoneSummary(parkId, zoneId);
  if (data.error === 'ZONE_NOT_FOUND') {
    throw new AppError('Zone not found', 404, { code: 'ZONE_NOT_FOUND' });
  }
  res.json({ success: true, data });
});

const getRideDetail = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  const data = await svc.getRideDetail(parkId, rideId);
  if (!data) {
    throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
  res.json({ success: true, data });
});

const listZones = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const zones = await svc.listZonesWithRideCounts(parkId);
  res.json({ success: true, data: { parkId, timestamp: new Date().toISOString(), zones } });
});

const getHeatmap = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const data = await svc.getHeatmapLive(parkId);
  res.json({ success: true, data });
});

const listTemplates = asyncHandler(async (_req, res) => {
  const ids = listAddonBoardTemplateIds();
  res.json({
    success: true,
    data: { templates: ids.map((boardId) => ({ boardId })) },
  });
});

const getTemplate = asyncHandler(async (req, res) => {
  const { boardId } = req.params;
  const doc = getAddonBoardTemplate(boardId);
  if (!doc) {
    throw new AppError('Add-on board template not found', 404, { code: 'ADDON_BOARD_TEMPLATE_NOT_FOUND' });
  }
  res.json({ success: true, data: doc });
});

const getLayout = asyncHandler(async (req, res) => {
  const q = req.validated || req.query || {};
  const boardId = q.boardId != null ? String(q.boardId) : 'park-management-default';
  const roles = resolveUserRoleCodes(req.user);
  const full = getAddonBoardEffectiveLayout(boardId, roles);
  if (!full) {
    throw new AppError('Add-on board template not found', 404, { code: 'ADDON_BOARD_TEMPLATE_NOT_FOUND' });
  }
  const { boardId: bid, label, widgets } = full;
  res.json({ success: true, data: { boardId: bid, label, widgets } });
});

const getWidgetSourceDraftHandler = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  try {
    const preview = await getWidgetSourceDraftPreview(parkId, rideId);
    res.json({ success: true, data: preview });
  } catch (e) {
    if (/** @type {any} */ (e).code === 'ASSET_NOT_FOUND') {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }
    throw e;
  }
});

const getCustomWidgetsHandler = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  try {
    const widgets = await getCustomWidgetsForRide(parkId, rideId);
    res.json({ success: true, data: { widgets } });
  } catch (e) {
    if (/** @type {any} */ (e).code === 'ASSET_NOT_FOUND') {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }
    throw e;
  }
});

const patchCustomWidgetHandler = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId, widgetId } = req.params;
  const parsed = validatePatchCustomWidgetBody(req.body);
  if (!parsed.ok) {
    throw new AppError(parsed.message, 400, { code: 'INVALID_CUSTOM_WIDGET_PATCH' });
  }
  try {
    const widget = await patchCustomWidgetForRide(parkId, rideId, widgetId, parsed.value);
    res.json({ success: true, data: { widget } });
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    if (code === 'ASSET_NOT_FOUND') {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }
    if (code === 'CUSTOM_WIDGET_NOT_FOUND') {
      throw new AppError('Custom widget not found for this ride', 404, { code: 'CUSTOM_WIDGET_NOT_FOUND' });
    }
    throw e;
  }
});

const deleteCustomWidgetHandler = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId, widgetId } = req.params;
  try {
    await deleteCustomWidgetForRide(parkId, rideId, widgetId);
    res.status(204).send();
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    if (code === 'ASSET_NOT_FOUND') {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }
    if (code === 'CUSTOM_WIDGET_NOT_FOUND') {
      throw new AppError('Custom widget not found for this ride', 404, { code: 'CUSTOM_WIDGET_NOT_FOUND' });
    }
    throw e;
  }
});

const postPromoteWidgetFromDraft = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  try {
    const widget = await promoteWidgetFromSourceDraft(parkId, rideId);
    res.status(201).json({ success: true, data: { widget } });
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    if (code === 'ASSET_NOT_FOUND') {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }
    if (code === 'DRAFT_MISSING') {
      throw new AppError('No widget source draft to promote', 400, { code: 'DRAFT_MISSING' });
    }
    if (code === 'DRAFT_NOT_VALID') {
      throw new AppError('Draft is not valid for current extensions', 400, { code: 'DRAFT_NOT_VALID' });
    }
    if (code === 'DRAFT_ENTITY_MISMATCH') {
      throw new AppError('Draft entity does not match this ride asset', 400, { code: 'DRAFT_ENTITY_MISMATCH' });
    }
    throw e;
  }
});

const putWidgetSourceDraft = asyncHandler(async (req, res) => {
  const parkId = req.parkContext.id;
  const { rideId } = req.params;
  const parsed = validateWidgetSourceDraftBody(req.body, rideId);
  if (!parsed.ok) {
    throw new AppError(parsed.message, 400, { code: 'INVALID_WIDGET_SOURCE' });
  }
  try {
    const data = await saveWidgetSourceDraft(parkId, rideId, parsed.value);
    res.json({ success: true, data });
  } catch (e) {
    const code = /** @type {any} */ (e).code;
    if (code === 'ASSET_NOT_FOUND') {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }
    if (code === 'INVALID_SIGNAL') {
      throw new AppError('Signal must be enabled and board eligible for this asset', 400, {
        code: 'INVALID_WIDGET_SOURCE',
      });
    }
    throw e;
  }
});

module.exports = {
  getSummary,
  getRides,
  getCriticalRides,
  getZoneSummary,
  getRideDetail,
  listZones,
  getHeatmap,
  listTemplates,
  getTemplate,
  getLayout,
  getWidgetSourceDraftHandler,
  putWidgetSourceDraft,
  getCustomWidgetsHandler,
  patchCustomWidgetHandler,
  deleteCustomWidgetHandler,
  postPromoteWidgetFromDraft,
};
