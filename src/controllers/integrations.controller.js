const fs = require('node:fs');
const path = require('node:path');
const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { IntegrationOrchestratorService } = require('../services/integration-orchestrator.service');
const { CanonicalInboundMessageService } = require('../services/canonical-inbound-message.service');
const { OutputRouterService } = require('../services/output-router.service');
const { AdapterRuntimeService } = require('../modules/integrations/adapter-framework/adapter-runtime.service');
const { AdapterInventoryService } = require('../modules/integrations/adapter-framework/adapter-inventory.service');
const { enrichPackagesResponsePayload } = require('../utils/adapter-manifest-ui');
const { readRecentAdapterPipelineLog } = require('../modules/integrations/adapter-framework/adapter-pipeline-log.service');

const integrationService = new IntegrationOrchestratorService();
const canonicalMessageService = new CanonicalInboundMessageService();
const outputRouter = new OutputRouterService();
const adapterRuntime = new AdapterRuntimeService();
const adapterInventory = new AdapterInventoryService();
const env = require('../config/env');

function collectAdapterKeys(rows, localScan) {
  const keys = new Set();
  for (const row of rows || []) {
    const r = row?.toJSON ? row.toJSON() : row;
    const k = String(r?.adapterKey || '').trim();
    if (k) keys.add(k);
  }
  for (const item of localScan || []) {
    const m = item?.manifest || {};
    const k = String(m.adapterKey || item.adapterKey || '').trim();
    if (k) keys.add(k);
  }
  return [...keys];
}

const getFeatureFlags = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      adapterDiscoverySpyEnabled: Boolean(env.adapterDiscoverySpyEnabled),
      mqttEnforceCapabilities: Boolean(env.mqttEnforceCapabilities),
      mqttCapabilityGuardMode: env.mqttCapabilityGuardMode || 'off',
    },
  });
});

const listProviders = asyncHandler(async (req, res) => {
  const infos = integrationService.listProviders();
  const configs = await integrationService.registryService.listConfigs();
  const cfgByProvider = new Map(configs.map((c) => [c.provider, c]));
  const data = infos.map((info) => {
    const cfg = cfgByProvider.get(info.provider);
    let config = null;
    if (cfg) {
      config = cfg.toJSON ? cfg.toJSON() : cfg;
    }
    return {
      ...info,
      config,
    };
  });
  res.json({ success: true, data });
});

const getProviderConfig = asyncHandler(async (req, res) => {
  const row = await integrationService.getProviderConfig(req.params.provider);
  if (!row) throw new AppError('Provider config not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const patchProviderConfig = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const row = await integrationService.patchProviderConfig(req.params.provider, body);
  res.json({ success: true, data: row });
});

const listProviderDestinations = asyncHandler(async (req, res) => {
  const data = await integrationService.listAvailableDestinations(req.params.provider);
  res.json({ success: true, data });
});

const listProviderParks = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const data = await integrationService.listAvailableParks(req.params.provider, q.destinationId || null);
  res.json({ success: true, data });
});

const getProviderEntity = asyncHandler(async (req, res) => {
  const data = await integrationService.getProviderEntity(req.params.provider, req.params.entityId);
  if (!data) throw new AppError('Entity not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data });
});

const listProviderEntityChildren = asyncHandler(async (req, res) => {
  const data = await integrationService.listProviderEntityChildren(req.params.provider, req.params.entityId);
  res.json({ success: true, data });
});

const getProviderEntityLive = asyncHandler(async (req, res) => {
  const data = await integrationService.getProviderEntityLive(req.params.provider, req.params.entityId);
  if (!data) throw new AppError('Entity live data not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data });
});

const getProviderEntitySchedule = asyncHandler(async (req, res) => {
  const data = await integrationService.getProviderEntitySchedule(req.params.provider, req.params.entityId, {
    year: req.query.year,
    month: req.query.month,
  });
  if (!data) throw new AppError('Entity schedule not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data });
});

const syncDestinations = asyncHandler(async (req, res) => {
  const out = await integrationService.syncDestinations(req.params.provider);
  res.json({ success: true, data: out });
});

const syncParks = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const out = await integrationService.syncParks(req.params.provider, body.destinationId || null);
  res.json({ success: true, data: out });
});

const syncEntities = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const out = await integrationService.syncEntities(req.params.provider, body.parkId || null);
  res.json({ success: true, data: out });
});

const syncLive = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const out = await integrationService.syncLive(req.params.provider, body.parkId || null);
  res.json({ success: true, data: out });
});

const syncCalendar = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const out = await integrationService.syncCalendar(req.params.provider, body.parkId || null, {
    year: body.year,
    month: body.month,
  });
  res.json({ success: true, data: out });
});

const syncAllParksInDestination = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const out = await integrationService.syncAllParksInDestination(req.params.provider, body.destinationId || null);
  res.json({ success: true, data: out });
});

/* C3.5: canonical-message endpoints now hit the
 * `CanonicalInboundMessageService` directly. The orchestrator wrappers
 * (`listCanonicalMessages` / `getCanonicalMessage` /
 * `reprocessCanonicalMessage`) were thin pass-throughs and have been
 * removed; the controller is the only call site outside the
 * orchestrator's own ingestion pipeline. */
const listCanonicalMessages = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const rows = await canonicalMessageService.list({
    provider: q.provider,
    externalParkId: q.externalParkId,
    status: q.status,
    messageType: q.messageType,
    limit: q.limit,
    offset: q.offset,
  });
  res.json({ success: true, data: rows });
});

const getCanonicalMessage = asyncHandler(async (req, res) => {
  const row = await canonicalMessageService.findById(req.params.id);
  if (!row) throw new AppError('Canonical message not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const reprocessCanonicalMessage = asyncHandler(async (req, res) => {
  const row = await canonicalMessageService.reprocess(req.params.id);
  res.json({ success: true, data: row });
});

const listMappings = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const rows = await integrationService.listMappings({
    provider: q.provider,
    parkId: q.externalParkId,
    status: q.mappingStatus,
  });
  res.json({ success: true, data: rows });
});

const patchMapping = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const patch = {
    internalEntityType: body.internalEntityType || null,
    internalEntityId: body.internalEntityId || null,
    mappingStatus: body.mappingStatus,
    confidence: body.confidence,
    metadata: body.metadata,
  };
  const row = await integrationService.patchMapping(req.params.id, patch);
  if (!row) throw new AppError('Mapping not found', 404, { code: 'NOT_FOUND' });
  res.json({ success: true, data: row });
});

const getSettings = asyncHandler(async (req, res) => {
  const s = await integrationService.getSettings();
  res.json({ success: true, data: s });
});

const patchSettings = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const s = await integrationService.patchSettings(body);
  res.json({ success: true, data: s });
});

const listAdapterPackages = asyncHandler(async (req, res) => {
  const rows = await integrationService.registryService.listInstalledAdapterPackages();
  const localScan = adapterRuntime.loader.scanPackages();
  const inventoryByKey = await adapterInventory.getInventoryMap(collectAdapterKeys(rows, localScan));
  const { data, meta } = enrichPackagesResponsePayload({
    rows,
    localScan,
    inventoryByKey,
  });
  res.json({
    success: true,
    data,
    meta,
  });
});

const getAdapterPackageAsset = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const rel = typeof q.path === 'string' ? q.path.trim().replace(/\\/g, '/') : '';
  if (!rel || rel.includes('..')) {
    throw new AppError('Invalid or missing path', 400, { code: 'INVALID_PATH' });
  }
  const loaded = adapterRuntime.loader.loadByAdapterKey(req.params.adapterKey);
  if (!loaded?.packageDir) {
    throw new AppError('Adapter package not found', 404, { code: 'NOT_FOUND' });
  }
  const root = path.resolve(loaded.packageDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root)) {
    throw new AppError('Path escapes package directory', 403, { code: 'FORBIDDEN' });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
  }
  if (!/\.(svg|png|jpe?g|webp|gif|md|txt)$/i.test(abs)) {
    throw new AppError('Unsupported asset type', 400, { code: 'UNSUPPORTED_ASSET' });
  }
  const lower = abs.toLowerCase();
  if (lower.endsWith('.svg')) res.type('image/svg+xml');
  else if (lower.endsWith('.png')) res.type('image/png');
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) res.type('image/jpeg');
  else if (lower.endsWith('.webp')) res.type('image/webp');
  else if (lower.endsWith('.gif')) res.type('image/gif');
  else if (lower.endsWith('.md')) res.type('text/markdown; charset=utf-8');
  else if (lower.endsWith('.txt')) res.type('text/plain; charset=utf-8');
  res.sendFile(abs, { maxAge: 86400000 });
});

const listInstalledAdapters = asyncHandler(async (req, res) => {
  const rows = await integrationService.registryService.listInstalledAdapterPackages();
  const localScan = adapterRuntime.loader.scanPackages();
  const inventoryByKey = await adapterInventory.getInventoryMap(collectAdapterKeys(rows, localScan));
  const { data, meta } = enrichPackagesResponsePayload({
    rows,
    localScan,
    inventoryByKey,
  });
  res.json({ success: true, data, meta });
});

const getInstalledAdapter = asyncHandler(async (req, res) => {
  const row = await integrationService.registryService.getInstalledAdapterRecord(req.params.id);
  if (!row) throw new AppError('Installed adapter not found', 404, { code: 'NOT_FOUND' });
  const localScan = adapterRuntime.loader.scanPackages();
  const inventoryByKey = await adapterInventory.getInventoryMap(collectAdapterKeys([row], localScan));
  const { data } = enrichPackagesResponsePayload({
    rows: [row],
    localScan,
    inventoryByKey,
  });
  res.json({ success: true, data: data[0] });
});

const installLocalAdapter = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const row = await integrationService.registryService.installLocalAdapterPackage(body);
  const localScan = adapterRuntime.loader.scanPackages();
  const inventoryByKey = await adapterInventory.getInventoryMap(collectAdapterKeys([row], localScan));
  const { data } = enrichPackagesResponsePayload({
    rows: [row],
    localScan,
    inventoryByKey,
  });
  res.status(201).json({ success: true, data: data[0] });
});

const patchInstalledAdapter = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const row = await integrationService.registryService.patchInstalledAdapterPackage(req.params.id, body);
  const localScan = adapterRuntime.loader.scanPackages();
  const inventoryByKey = await adapterInventory.getInventoryMap(collectAdapterKeys([row], localScan));
  const { data } = enrichPackagesResponsePayload({
    rows: [row],
    localScan,
    inventoryByKey,
  });
  res.json({ success: true, data: data[0] });
});

const getAdapterInventory = asyncHandler(async (req, res) => {
  const data = await adapterInventory.getInventory(req.params.adapterKey);
  res.json({ success: true, data });
});

const deleteInstalledAdapter = asyncHandler(async (req, res) => {
  const out = await integrationService.registryService.uninstallInstalledAdapterPackage(req.params.id);
  res.json({ success: true, data: out });
});

const reloadAdapterPackages = asyncHandler(async (_req, res) => {
  const rows = await integrationService.registryService.reloadLocalAdapterPackages();
  res.json({ success: true, data: rows });
});

const healthAdapterPackage = asyncHandler(async (req, res) => {
  const out = await integrationService.registryService.healthAdapterPackage(req.params.adapterKey, req.body || {}, {
    now: new Date().toISOString(),
  });
  res.json({ success: true, data: out });
});

const encodeAdapterOutput = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = outputRouter.encodeAll(body.observation, body.context, body.profiles);
  res.json({ success: true, data });
});

const emitAdapterOutput = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await outputRouter.emit(body.observation, body.context, {
    profiles: body.profiles,
    emitMqtt: body.emitMqtt === true,
    ingestCanonical: body.ingestCanonical === true,
    autoApply: body.autoApply !== false,
  });
  res.json({ success: true, data });
});

const runDemoAdapter = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await adapterRuntime.runDemoAdapter(body);
  res.json({ success: true, data });
});

const runLocalAdapter = asyncHandler(async (req, res) => {
  const data = await adapterRuntime.runLocal(req.validated);
  res.json({ success: true, data });
});

const discoverLocalAdapter = asyncHandler(async (req, res) => {
  const data = await adapterRuntime.discoverLocal(req.validated);
  res.json({ success: true, data });
});

const healthLocalAdapter = asyncHandler(async (req, res) => {
  const data = await adapterRuntime.healthLocal(req.validated);
  res.json({ success: true, data });
});

const getUnsSuggestions = asyncHandler(async (_req, res) => {
  const data = await integrationService.getUnsTopicSuggestions();
  res.json({ success: true, data });
});

const listManualUnsNodes = asyncHandler(async (_req, res) => {
  const data = await integrationService.listManualUnsNodes();
  res.json({ success: true, data });
});

const createManualUnsNode = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await integrationService.addManualUnsNode(body);
  res.status(201).json({ success: true, data });
});

const deleteManualUnsNode = asyncHandler(async (req, res) => {
  const ok = await integrationService.removeManualUnsNode(req.params.id);
  if (!ok) throw new AppError('UNS manual node not found', 404, { code: 'NOT_FOUND' });
  res.status(204).send();
});

const getUnsSparkplugSchema = asyncHandler(async (req, res) => {
  const { source } = req.validated || { source: 'baseline' };
  const data = await integrationService.getSparkplugTopicSchemaDocument({ source });
  const body = JSON.stringify(data, null, 2);
  const safeSlug = String(data.parkSlug || 'park').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="uns-sparkplug-schema-${safeSlug}.json"`);
  res.send(body);
});

const putUnsSparkplugSchema = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const data = await integrationService.putSparkplugTopicSchemaDocument(body);
  res.json({ success: true, data });
});

const deleteUnsSparkplugSchema = asyncHandler(async (_req, res) => {
  await integrationService.deleteSparkplugTopicSchemaDocument();
  res.status(204).send();
});

const materializeUnsNodes = asyncHandler(async (_req, res) => {
  const data = await integrationService.materializeUnsNodesFromSuggestions();
  res.json({ success: true, data });
});

const getAdapterPipelineLog = asyncHandler(async (req, res) => {
  const q = req.validated || req.query;
  const adapterKey = q.adapterKey && String(q.adapterKey).trim() ? String(q.adapterKey).trim() : null;
  const limit = q.limit != null ? Number(q.limit) : 200;
  const data = readRecentAdapterPipelineLog({ adapterKey, limit });
  res.json({ success: true, data });
});

module.exports = {
  getFeatureFlags,
  listProviders,
  getProviderConfig,
  patchProviderConfig,
  listProviderDestinations,
  listProviderParks,
  getProviderEntity,
  listProviderEntityChildren,
  getProviderEntityLive,
  getProviderEntitySchedule,
  syncDestinations,
  syncParks,
  syncEntities,
  syncLive,
  syncCalendar,
  syncAllParksInDestination,
  listCanonicalMessages,
  getCanonicalMessage,
  reprocessCanonicalMessage,
  listMappings,
  patchMapping,
  getSettings,
  patchSettings,
  getUnsSuggestions,
  listManualUnsNodes,
  createManualUnsNode,
  deleteManualUnsNode,
  getUnsSparkplugSchema,
  putUnsSparkplugSchema,
  deleteUnsSparkplugSchema,
  materializeUnsNodes,
  listAdapterPackages,
  reloadAdapterPackages,
  healthAdapterPackage,
  encodeAdapterOutput,
  emitAdapterOutput,
  runDemoAdapter,
  runLocalAdapter,
  discoverLocalAdapter,
  healthLocalAdapter,
  getAdapterPackageAsset,
  listInstalledAdapters,
  getInstalledAdapter,
  installLocalAdapter,
  patchInstalledAdapter,
  deleteInstalledAdapter,
  getAdapterInventory,
  getAdapterPipelineLog,
};
