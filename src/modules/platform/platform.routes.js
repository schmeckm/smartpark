const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const parksCtrl = require('./platform-parks.controller');
const assetsCtrl = require('./platform-assets.controller');
const assetDowntimeCtrl = require('./asset-downtime.controller');
const assetPdmCtrl = require('./asset-pdm.controller');
const shiftHandoverCtrl = require('./shift-handover.controller');
const templatesCtrl = require('./platform-templates.controller');
const geoPressureCtrl = require('../../controllers/geo-pressure.controller');
const geoFlowCtrl = require('../../controllers/geo-flow.controller');
const rideMasterExtensionsCtrl = require('../../controllers/ride-master-extensions.controller');
const trafficAttendanceCtrl = require('../../controllers/traffic-attendance.controller');
const { validateExtensionsPatchBody } = require('../../validators/ride-master-extensions-patch.validator');
const {
  trafficCorridorCreateBody,
  attendanceRiskForecastRunBody,
  forecastHistoryQuery,
} = require('../../validators/traffic-attendance.schemas');
const {
  listAssetsQuery,
  assetIdParam,
  assetOverrideParams,
  rideMasterBody,
  enrichTemplateBody,
  runtimeOverrideCreateBody,
  runtimeOverridePatchBody,
  parkIdParam,
  operationalContextQuery,
  parkLevel0Body,
  downtimeRangeQuery,
  downtimeParetoQuery,
  downtimeEventCreateBody,
  downtimeEventPatchBody,
  assetEventParams,
  pdmRuleParams,
  pdmRuleCreateBody,
  pdmRulePatchBody,
  pdmEvaluationLogsQuery,
  shiftHandoverListQuery,
  shiftHandoverCreateBody,
  shiftHandoverAcknowledgeBody,
  shiftHandoverTasksPatchBody,
  shiftHandoverReminderQuery,
  handoverEntryParams,
  parkSlugParam,
  geoPressureQuery,
  geoHotspotsQuery,
  geoPressureSimulateBody,
  geoFlowSimulationQuery,
  geoFlowEventsBatchBody,
  zoneNormalizationPreviewQuery,
  zoneNormalizationApplyBody,
} = require('./platform.validators');

const platformParksRouter = Router();
platformParksRouter.get('/', requirePermission('rides', 'read'), parksCtrl.listParks);
platformParksRouter.get(
  '/:parkSlug/geo/pressure/live',
  requirePermission('rides', 'read'),
  validate(parkSlugParam, 'params'),
  validate(geoPressureQuery, 'query'),
  geoPressureCtrl.pressureLive
);
platformParksRouter.get(
  '/:parkSlug/geo/pressure/forecast',
  requirePermission('rides', 'read'),
  validate(parkSlugParam, 'params'),
  validate(geoPressureQuery, 'query'),
  geoPressureCtrl.pressureForecast
);
platformParksRouter.get(
  '/:parkSlug/geo/entities',
  requirePermission('rides', 'read'),
  validate(parkSlugParam, 'params'),
  validate(geoPressureQuery, 'query'),
  geoPressureCtrl.geoEntities
);
platformParksRouter.get(
  '/:parkSlug/geo/hotspots',
  requirePermission('rides', 'read'),
  validate(parkSlugParam, 'params'),
  validate(geoHotspotsQuery, 'query'),
  geoPressureCtrl.hotspots
);
platformParksRouter.post(
  '/:parkSlug/geo/pressure/simulate',
  requirePermission('rides', 'read'),
  validate(parkSlugParam, 'params'),
  validate(geoPressureSimulateBody),
  geoPressureCtrl.pressureSimulate
);
platformParksRouter.get(
  '/:parkSlug/geo/flow/simulation',
  requirePermission('rides', 'read'),
  validate(parkSlugParam, 'params'),
  validate(geoFlowSimulationQuery, 'query'),
  geoFlowCtrl.flowSimulation
);
platformParksRouter.post(
  '/:parkSlug/geo/flow/events/batch',
  requirePermission('rides', 'update'),
  validate(parkSlugParam, 'params'),
  validate(geoFlowEventsBatchBody),
  geoFlowCtrl.flowEventsBatch
);
platformParksRouter.get(
  '/:parkId/operational-context',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  validate(operationalContextQuery, 'query'),
  parksCtrl.getOperationalContext
);
platformParksRouter.get(
  '/:parkId/zones',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  parksCtrl.listParkZones
);
platformParksRouter.patch(
  '/:parkId/level0',
  requirePermission('rides', 'update'),
  validate(parkIdParam, 'params'),
  validate(parkLevel0Body),
  parksCtrl.patchParkLevel0
);
platformParksRouter.get(
  '/:parkId/shift-handovers',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  validate(shiftHandoverListQuery, 'query'),
  shiftHandoverCtrl.list
);
platformParksRouter.post(
  '/:parkId/shift-handovers',
  requirePermission('rides', 'update'),
  validate(parkIdParam, 'params'),
  validate(shiftHandoverCreateBody),
  shiftHandoverCtrl.create
);
platformParksRouter.post(
  '/:parkId/shift-handovers/:entryId/acknowledge',
  requirePermission('rides', 'update'),
  validate(handoverEntryParams, 'params'),
  validate(shiftHandoverAcknowledgeBody),
  shiftHandoverCtrl.acknowledge
);
platformParksRouter.patch(
  '/:parkId/shift-handovers/:entryId/tasks',
  requirePermission('rides', 'update'),
  validate(handoverEntryParams, 'params'),
  validate(shiftHandoverTasksPatchBody),
  shiftHandoverCtrl.patchTasks
);
platformParksRouter.get(
  '/:parkId/shift-handovers/reminders/due',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  validate(shiftHandoverReminderQuery, 'query'),
  shiftHandoverCtrl.listDueReminders
);
platformParksRouter.post(
  '/:parkId/shift-handovers/:entryId/reminders/mark-sent',
  requirePermission('rides', 'update'),
  validate(handoverEntryParams, 'params'),
  shiftHandoverCtrl.markReminderSent
);
platformParksRouter.get(
  '/:parkId/shift-handovers/:entryId/pdf',
  requirePermission('rides', 'read'),
  validate(handoverEntryParams, 'params'),
  shiftHandoverCtrl.downloadPdf
);

platformParksRouter.get(
  '/:parkId/traffic-corridors',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  trafficAttendanceCtrl.listTrafficCorridors
);
platformParksRouter.post(
  '/:parkId/traffic-corridors',
  requirePermission('rides', 'update'),
  validate(parkIdParam, 'params'),
  validate(trafficCorridorCreateBody),
  trafficAttendanceCtrl.createTrafficCorridor
);
platformParksRouter.post(
  '/:parkId/attendance-risk-forecast/run',
  requirePermission('rides', 'update'),
  validate(parkIdParam, 'params'),
  validate(attendanceRiskForecastRunBody),
  trafficAttendanceCtrl.runAttendanceRiskForecast
);
platformParksRouter.get(
  '/:parkId/attendance-risk-forecast/latest',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  trafficAttendanceCtrl.getLatestAttendanceRiskForecast
);
platformParksRouter.get(
  '/:parkId/attendance-risk-forecast/history',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  validate(forecastHistoryQuery, 'query'),
  trafficAttendanceCtrl.getAttendanceRiskForecastHistory
);

platformParksRouter.get(
  '/:parkId/traffic-corridors',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  trafficAttendanceCtrl.listTrafficCorridors
);
platformParksRouter.post(
  '/:parkId/traffic-corridors',
  requirePermission('rides', 'update'),
  validate(parkIdParam, 'params'),
  validate(trafficCorridorCreateBody),
  trafficAttendanceCtrl.createTrafficCorridor
);
platformParksRouter.post(
  '/:parkId/attendance-risk-forecast/run',
  requirePermission('rides', 'update'),
  validate(parkIdParam, 'params'),
  validate(attendanceRiskForecastRunBody),
  trafficAttendanceCtrl.runAttendanceRiskForecast
);
platformParksRouter.get(
  '/:parkId/attendance-risk-forecast/latest',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  trafficAttendanceCtrl.getLatestAttendanceRiskForecast
);
platformParksRouter.get(
  '/:parkId/attendance-risk-forecast/history',
  requirePermission('rides', 'read'),
  validate(parkIdParam, 'params'),
  validate(forecastHistoryQuery, 'query'),
  trafficAttendanceCtrl.getAttendanceRiskForecastHistory
);

const platformAssetsRouter = Router();
platformAssetsRouter.get('/', requirePermission('rides', 'read'), validate(listAssetsQuery, 'query'), assetsCtrl.listAssets);
platformAssetsRouter.get(
  '/zone-normalization/preview',
  requirePermission('rides', 'read'),
  validate(zoneNormalizationPreviewQuery, 'query'),
  assetsCtrl.previewZoneNormalization
);
platformAssetsRouter.post(
  '/zone-normalization/apply',
  requirePermission('rides', 'update'),
  validate(zoneNormalizationApplyBody),
  assetsCtrl.applyZoneNormalization
);
platformAssetsRouter.get('/oee/reason-codes', requirePermission('rides', 'read'), assetDowntimeCtrl.listReasonCodes);
platformAssetsRouter.get(
  '/:assetId/runtime-overrides',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  assetsCtrl.listRuntimeOverrides
);
platformAssetsRouter.post(
  '/:assetId/runtime-overrides',
  requirePermission('rides', 'update'),
  validate(assetIdParam, 'params'),
  validate(runtimeOverrideCreateBody),
  assetsCtrl.postRuntimeOverride
);
platformAssetsRouter.patch(
  '/:assetId/runtime-overrides/:overrideId',
  requirePermission('rides', 'update'),
  validate(assetOverrideParams, 'params'),
  validate(runtimeOverridePatchBody),
  assetsCtrl.patchRuntimeOverride
);
platformAssetsRouter.get(
  '/:assetId/downtime-events',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  validate(downtimeRangeQuery, 'query'),
  assetDowntimeCtrl.listDowntimeEvents
);
platformAssetsRouter.post(
  '/:assetId/downtime-events',
  requirePermission('rides', 'update'),
  validate(assetIdParam, 'params'),
  validate(downtimeEventCreateBody),
  assetDowntimeCtrl.createDowntimeEvent
);
platformAssetsRouter.patch(
  '/:assetId/downtime-events/:eventId',
  requirePermission('rides', 'update'),
  validate(assetEventParams, 'params'),
  validate(downtimeEventPatchBody),
  assetDowntimeCtrl.patchDowntimeEvent
);
platformAssetsRouter.delete(
  '/:assetId/downtime-events/:eventId',
  requirePermission('rides', 'update'),
  validate(assetEventParams, 'params'),
  assetDowntimeCtrl.deleteDowntimeEvent
);
platformAssetsRouter.get(
  '/:assetId/oee/availability-summary',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  validate(downtimeRangeQuery, 'query'),
  assetDowntimeCtrl.availabilitySummary
);
platformAssetsRouter.get(
  '/:assetId/oee/downtime-reason-pareto',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  validate(downtimeParetoQuery, 'query'),
  assetDowntimeCtrl.downtimeReasonPareto
);
platformAssetsRouter.get(
  '/:assetId/pdm-sparkplug-metrics',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  assetPdmCtrl.getPdmSparkplugMetrics
);
platformAssetsRouter.get(
  '/:assetId/predictive-maintenance',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  assetPdmCtrl.getPdmEvaluation
);
platformAssetsRouter.get(
  '/:assetId/pdm-evaluation-logs',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  validate(pdmEvaluationLogsQuery, 'query'),
  assetPdmCtrl.listPdmEvaluationLogsHandler
);
platformAssetsRouter.get(
  '/:assetId/pdm-rules',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  assetPdmCtrl.listPdmRules
);
platformAssetsRouter.post(
  '/:assetId/pdm-rules',
  requirePermission('rides', 'update'),
  validate(assetIdParam, 'params'),
  validate(pdmRuleCreateBody),
  assetPdmCtrl.postPdmRule
);
platformAssetsRouter.patch(
  '/:assetId/pdm-rules/:ruleId',
  requirePermission('rides', 'update'),
  validate(pdmRuleParams, 'params'),
  validate(pdmRulePatchBody),
  assetPdmCtrl.patchPdmRule
);
platformAssetsRouter.delete(
  '/:assetId/pdm-rules/:ruleId',
  requirePermission('rides', 'update'),
  validate(pdmRuleParams, 'params'),
  assetPdmCtrl.deletePdmRule
);
platformAssetsRouter.get(
  '/:assetId/extensions',
  requirePermission('rides', 'read'),
  validate(assetIdParam, 'params'),
  rideMasterExtensionsCtrl.getParkAssetExtensions
);
platformAssetsRouter.patch(
  '/:assetId/extensions',
  requirePermission('rides', 'update'),
  validate(assetIdParam, 'params'),
  validateExtensionsPatchBody,
  rideMasterExtensionsCtrl.patchParkAssetExtensions
);
platformAssetsRouter.get('/:assetId', requirePermission('rides', 'read'), validate(assetIdParam, 'params'), assetsCtrl.getAsset);
platformAssetsRouter.put(
  '/:assetId/ride-master',
  requirePermission('rides', 'update'),
  validate(assetIdParam, 'params'),
  validate(rideMasterBody),
  assetsCtrl.updateRideMaster
);
platformAssetsRouter.post(
  '/:assetId/ride-master/enrich-template',
  requirePermission('rides', 'update'),
  validate(assetIdParam, 'params'),
  validate(enrichTemplateBody),
  assetsCtrl.postEnrichRideTemplate
);

const platformTemplatesRouter = Router();
platformTemplatesRouter.get('/ride', requirePermission('rides', 'read'), templatesCtrl.listRideTemplates);
platformTemplatesRouter.get('/staffing', requirePermission('rides', 'read'), templatesCtrl.listStaffingTemplates);
platformTemplatesRouter.get('/maintenance', requirePermission('rides', 'read'), templatesCtrl.listMaintenanceTemplates);

module.exports = {
  platformParksRouter,
  platformAssetsRouter,
  platformTemplatesRouter,
};
