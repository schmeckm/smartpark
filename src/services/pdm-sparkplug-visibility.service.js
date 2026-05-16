'use strict';

const { sparkplugGroupIdForParkSlug } = require('./pdm-sparkplug-group-id.service');
const pdmSparkplugEdgeResolve = require('./pdm-sparkplug-edge-resolve.service');

/**
 * @param {object} p
 * @param {string} p.parkSlug
 * @param {string} p.assetId
 * @param {string} p.parkId
 * @param {Record<string, unknown>} p.assetPlain
 * @param {Array<Record<string, unknown>>} p.signals
 */
async function buildPdmSparkplugVisibility({ parkSlug, assetId, parkId, assetPlain, signals }) {
  const groupId = sparkplugGroupIdForParkSlug(parkSlug);
  const edgePack =
    assetId && parkId ? await pdmSparkplugEdgeResolve.resolvePdmSparkplugEdgeCandidatesForAsset(assetId, parkId) : null;

  const deviceIds = [
    ...new Set(
      (Array.isArray(signals) ? signals : [])
        .map((s) => s.sparkplugDeviceId)
        .filter((x) => x != null && String(x).trim())
        .map((x) => String(x).trim())
    ),
  ];
  const metricNames = (Array.isArray(signals) ? signals : []).map((s) => String(s.metricName || ''));

  const resolvedEdgeNodeId = edgePack?.resolvedEdgeNodeId != null ? String(edgePack.resolvedEdgeNodeId) : null;
  const attemptedEdgeNodeIds = Array.isArray(edgePack?.attemptedEdgeNodeIds) ? edgePack.attemptedEdgeNodeIds.map(String) : [];

  const topicPreview = [];
  const edgeForTopic = resolvedEdgeNodeId || attemptedEdgeNodeIds[0] || 'park_gateway';
  for (const d of deviceIds) {
    topicPreview.push({
      messageType: 'DDATA',
      exampleTopic: `spBv1.0/${groupId}/DDATA/${edgeForTopic}/${d}`,
      groupId,
      edgeNodeId: edgeForTopic,
      deviceId: d,
    });
  }

  return {
    groupId,
    resolvedEdgeNodeId,
    edgeResolutionSource: edgePack?.edgeResolutionSource != null ? String(edgePack.edgeResolutionSource) : null,
    attemptedEdgeNodeIds,
    edgeCandidates: edgePack?.edgeCandidates || [],
    deviceIds,
    metricNames,
    topicPreview,
    assetHint: {
      slug: assetPlain?.slug != null ? String(assetPlain.slug) : null,
      name: assetPlain?.name != null ? String(assetPlain.name) : null,
    },
  };
}

module.exports = {
  buildPdmSparkplugVisibility,
};
