const { asyncHandler } = require('../../utils/async-handler');
const { AppError } = require('../../utils/app-error');
const { UnsService } = require('./uns.service');
const { UnsStateService } = require('./uns-state.service');
const { validateTopicPath } = require('./uns-validator.service');
const { slugifyName } = require('./uns-topic-generator.service');
const { getMqttClient, getMqttState } = require('../../services/mqtt-connector.service');
const { getSnapshot, getStats } = require('../../services/mqtt-sparkplug-live-buffer.service');
const { getCanonicalToSparkplugPublisher } = require('../../services/canonicalToSparkplugPublisher');
const { getPlatformSettingsService } = require('../../services/platform-settings.service');
const { SPARKPLUG_MESSAGE_TYPES } = require('./sparkplug-topic-builder.service');

const unsService = new UnsService();
const unsStateService = new UnsStateService();

const getTree = asyncHandler(async (req, res) => {
  const data = await unsService.getTreeByPark(req.params.parkId);
  res.json({ success: true, data });
});

const createNode = asyncHandler(async (req, res) => {
  const row = await unsService.createNode(req.params.parkId, req.validated || req.body);
  res.status(201).json({ success: true, data: row });
});

const updateNode = asyncHandler(async (req, res) => {
  const row = await unsService.updateNode(req.params.id, req.validated || req.body);
  res.json({ success: true, data: row });
});

const deleteNode = asyncHandler(async (req, res) => {
  await unsService.deleteNode(req.params.id);
  res.status(204).send();
});

const getLatestState = asyncHandler(async (req, res) => {
  const data = await unsStateService.getLatestStateByPark(req.params.parkId);
  res.json({ success: true, data });
});

const getTopics = asyncHandler(async (req, res) => {
  const rawMt = req.query?.sparkplugMessageType;
  const sparkplugMessageType =
    typeof rawMt === 'string' && SPARKPLUG_MESSAGE_TYPES.includes(String(rawMt).toUpperCase())
      ? String(rawMt).toUpperCase()
      : 'DDATA';
  const data = await unsService.listTopicsByPark(req.params.parkId, { sparkplugMessageType });
  res.json({ success: true, data });
});

const testPublish = asyncHandler(async (req, res) => {
  const { topic, payload } = req.body || {};
  validateTopicPath(topic);
  const mqtt = getMqttClient();
  if (!mqtt) throw new Error('MQTT not connected');
  await new Promise((resolve, reject) => {
    mqtt.publish(topic, JSON.stringify(payload || {}), (err) => (err ? reject(err) : resolve()));
  });
  res.json({ success: true, data: { published: true, topic } });
});

const getHierarchySchema = asyncHandler(async (req, res) => {
  const doc = await unsService.exportHierarchySchema(req.params.parkId);
  const body = JSON.stringify(doc, null, 2);
  const safeSlug = String(req.params.parkId)
    .replace(/[^a-z0-9_-]/gi, '_')
    .slice(0, 80);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="uns-hierarchy-${safeSlug}.json"`);
  res.send(body);
});

const putHierarchySchema = asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
  const doc = req.validated || req.body;
  const summary = await unsService.importHierarchySchema(req.params.parkId, doc, mode);
  res.json({ success: true, data: summary });
});

const postHierarchySchemaPreview = asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'replace' ? 'replace' : 'merge';
  const doc = req.validated || req.body;
  const data = await unsService.importHierarchySchema(req.params.parkId, doc, mode, { dryRun: true });
  res.json({ success: true, data });
});

/** Flattened Sparkplug MQTT rows for UNS Live (in-memory buffer, broker-fed only). */
const getMqttLiveEvents = asyncHandler(async (req, res) => {
  const groupId = slugifyName(req.params.parkId);
  const rawLimit = req.query?.limit;
  const limit = Math.min(2000, Math.max(1, Number(rawLimit) || 500));
  const events = getSnapshot({ groupId, limit });
  res.json({ success: true, data: { events } });
});

const getMqttLiveStatus = asyncHandler(async (_req, res) => {
  const mqtt = getMqttState();
  const buffer = getStats();
  const adapterSimulationActive = await getPlatformSettingsService().getBoolean(
    'EXTERNAL_PARK_DATA_ENABLED',
    true
  );
  res.json({
    success: true,
    data: {
      mqtt,
      buffer,
      adapterSimulationActive,
    },
  });
});

const postMqttLiveTestEvent = asyncHandler(async (req, res) => {
  const parkSlug = slugifyName(req.params.parkId);
  const queue_time = Math.floor(5 + Math.random() * 56);
  const result = await getCanonicalToSparkplugPublisher().publishFromCanonicalEvent({
    parkSlug,
    entitySlug: 'euro_mir',
    entityType: 'ATTRACTION',
    entityName: 'Euro-Mir',
    metrics: { queue_time, status: 'OPERATING' },
    source: 'uns_live_test',
  });
  if (!result.published) {
    throw new AppError('MQTT publish failed or MQTT disabled', 503, {
      code: 'MQTT_UNAVAILABLE',
      details: result,
    });
  }
  res.json({ success: true, data: result });
});

module.exports = {
  getTree,
  createNode,
  updateNode,
  deleteNode,
  getLatestState,
  getTopics,
  testPublish,
  getHierarchySchema,
  putHierarchySchema,
  postHierarchySchemaPreview,
  getMqttLiveEvents,
  getMqttLiveStatus,
  postMqttLiveTestEvent,
};
