'use strict';

const { AppError } = require('../utils/app-error');
const { ParkAsset, Park } = require('../models');
const { sparkplugDeviceTopicSegment } = require('../modules/uns/sparkplug-topic-builder.service');
const { listSparkplugMetricsForDevices, listRecentSparkplugNumericSamples } = require('./mqtt-sparkplug-live-buffer.service');
const {
  buildSimulatedSparkplugMetricRows,
  buildSimulatedSparkplugSeries,
  isPdSimMetricName,
} = require('./pdm-sparkplug-simulator.service');
const { sparkplugGroupIdForParkSlug } = require('./pdm-sparkplug-group-id.service');
const {
  resolvePdmSparkplugEdgeCandidatesForAsset,
  mergeSparkplugMetricRowsByEdgePriority,
} = require('./pdm-sparkplug-edge-resolve.service');

function trimE(v) {
  return v == null ? '' : String(v).trim();
}

async function listKnownLiveSparkplugMetricsForAsset(assetId, parkId) {
  const asset = await ParkAsset.findOne({
    where: { assetId, parkId },
    attributes: ['assetId', 'parkId', 'name', 'slug'],
  });
  if (!asset) {
    throw new AppError('Asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
  const park = await Park.findByPk(parkId, { attributes: ['slug', 'name', 'id'] });
  const parkSlug = park?.slug || park?.name || String(parkId);
  const plain = asset.get({ plain: true });
  const groupId = sparkplugGroupIdForParkSlug(parkSlug);
  const slug = plain.slug != null ? String(plain.slug) : '';
  const name = plain.name != null ? String(plain.name) : '';
  const aid = plain.assetId != null ? String(plain.assetId) : '';
  const deviceCandidates = [
    sparkplugDeviceTopicSegment(slug),
    sparkplugDeviceTopicSegment(name),
    sparkplugDeviceTopicSegment(aid),
  ].filter((x, i, a) => x && a.indexOf(x) === i);

  const edgePack = await resolvePdmSparkplugEdgeCandidatesForAsset(assetId, parkId);
  const attemptedEdgeNodeIds = edgePack.attemptedEdgeNodeIds;

  /** @type {Array<{ edgeNodeId: string; rows: Array<Record<string, unknown>> }>} */
  const perEdge = [];
  for (const eid of attemptedEdgeNodeIds) {
    const e = trimE(eid);
    if (!e) continue;
    const rows = listSparkplugMetricsForDevices({ groupId, edgeNodeId: e, deviceIds: deviceCandidates });
    perEdge.push({ edgeNodeId: e, rows });
  }

  let metrics = mergeSparkplugMetricRowsByEdgePriority(perEdge);
  let simulatedFallback = false;
  if (!metrics.length && deviceCandidates.length) {
    metrics = buildSimulatedSparkplugMetricRows(assetId, deviceCandidates[0]);
    simulatedFallback = true;
  }

  const resolvedEdgeNodeId = edgePack.resolvedEdgeNodeId;
  const edgeResolutionSource = edgePack.edgeResolutionSource;

  return {
    groupId,
    edgeNodeId: resolvedEdgeNodeId,
    resolvedEdgeNodeId,
    edgeResolutionSource,
    attemptedEdgeNodeIds,
    edgeCandidates: edgePack.edgeCandidates,
    resolverReason: edgePack.resolverReason,
    zoneSlug: edgePack.zoneSlug,
    deviceCandidates,
    metrics,
    simulatedFallback,
    bufferHint: simulatedFallback
      ? 'No live Sparkplug samples matched this ride on any configured edge — showing deterministic demo metrics (motor RPM, power, vibration) so you can try thresholds and charts without MQTT.'
      : 'Metrics come from this server process Sparkplug live buffer (recent MQTT only), scanned across park/zone edge candidates. If empty, no traffic matched group/edge/device mapping yet.',
  };
}

async function listPdSparkplugMetricSeriesForAsset(assetId, parkId, query = {}) {
  const metricName = String(query.metricName || '').trim();
  if (!metricName) {
    throw new AppError('metricName is required', 400, { code: 'PDM_SERIES_METRIC_REQUIRED' });
  }
  const deviceWant = String(query.sparkplugDeviceId || '').trim();
  if (!deviceWant) {
    throw new AppError('sparkplugDeviceId is required', 400, { code: 'PDM_SERIES_DEVICE_REQUIRED' });
  }
  const points = Math.min(240, Math.max(12, Number(query.points) || 72));
  const stepSeconds = Math.min(3600, Math.max(30, Number(query.stepSeconds) || 300));

  const asset = await ParkAsset.findOne({
    where: { assetId, parkId },
    attributes: ['assetId', 'parkId', 'name', 'slug'],
  });
  if (!asset) {
    throw new AppError('Asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
  }
  const park = await Park.findByPk(parkId, { attributes: ['slug', 'name', 'id'] });
  const parkSlug = park?.slug || park?.name || String(parkId);
  const plain = asset.get({ plain: true });
  const groupId = sparkplugGroupIdForParkSlug(parkSlug);
  const slug = plain.slug != null ? String(plain.slug) : '';
  const name = plain.name != null ? String(plain.name) : '';
  const aid = plain.assetId != null ? String(plain.assetId) : '';
  const deviceCandidates = [
    sparkplugDeviceTopicSegment(slug),
    sparkplugDeviceTopicSegment(name),
    sparkplugDeviceTopicSegment(aid),
  ].filter((x, i, a) => x && a.indexOf(x) === i);

  if (!deviceCandidates.includes(deviceWant)) {
    throw new AppError('sparkplugDeviceId is not valid for this asset', 400, { code: 'PDM_SERIES_DEVICE_MISMATCH' });
  }

  const edgePack = await resolvePdmSparkplugEdgeCandidatesForAsset(assetId, parkId);
  const attemptedEdgeNodeIds = edgePack.attemptedEdgeNodeIds;

  /** @type {string | null} */
  let seriesResolvedEdgeNodeId = null;
  for (const eid of attemptedEdgeNodeIds) {
    const e = trimE(eid);
    if (!e) continue;
    const live = listRecentSparkplugNumericSamples(
      { groupId, edgeNodeId: e, deviceId: deviceWant, metricName },
      { limit: Math.max(points, 24) }
    );
    if (live.length >= 2) {
      const tail = live.length > points ? live.slice(-points) : live;
      seriesResolvedEdgeNodeId = e;
      return {
        groupId,
        edgeNodeId: edgePack.resolvedEdgeNodeId,
        resolvedEdgeNodeId: edgePack.resolvedEdgeNodeId,
        edgeResolutionSource: edgePack.edgeResolutionSource,
        attemptedEdgeNodeIds,
        seriesResolvedEdgeNodeId,
        metricName,
        sparkplugDeviceId: deviceWant,
        seriesSource: /** @type {const} */ ('live'),
        simulatedFallback: false,
        points: tail,
      };
    }
  }

  if (isPdSimMetricName(metricName)) {
    const sim = buildSimulatedSparkplugSeries(assetId, metricName, { points, stepSeconds });
    return {
      groupId,
      edgeNodeId: edgePack.resolvedEdgeNodeId,
      resolvedEdgeNodeId: edgePack.resolvedEdgeNodeId,
      edgeResolutionSource: edgePack.edgeResolutionSource,
      attemptedEdgeNodeIds,
      seriesResolvedEdgeNodeId: null,
      metricName,
      sparkplugDeviceId: deviceWant,
      seriesSource: /** @type {const} */ ('simulated'),
      simulatedFallback: true,
      points: sim,
    };
  }
  return {
    groupId,
    edgeNodeId: edgePack.resolvedEdgeNodeId,
    resolvedEdgeNodeId: edgePack.resolvedEdgeNodeId,
    edgeResolutionSource: edgePack.edgeResolutionSource,
    attemptedEdgeNodeIds,
    seriesResolvedEdgeNodeId: null,
    metricName,
    sparkplugDeviceId: deviceWant,
    seriesSource: /** @type {const} */ ('none'),
    simulatedFallback: false,
    points: [],
  };
}

module.exports = {
  listKnownLiveSparkplugMetricsForAsset,
  listPdSparkplugMetricSeriesForAsset,
};
