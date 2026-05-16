'use strict';

/**
 * Predictive maintenance — ordered Sparkplug edge node candidates for live buffer lookups.
 * Reuses park master_profile.sparkplug edges (same UI as Sparkplug Edge Nodes) + env fallback chain.
 *
 * Probe order: zone-matched edge → park default → SPARKPLUG_EDGE_NODE → park_gateway
 */

const env = require('../config/env');
const { Park, ParkAsset, ParkZone } = require('../models');
const {
  parseSparkplugEdgesFromParkProfile,
  zonesMatchNormalized,
  resolveSparkplugEdgeNodeForAsset,
} = require('./sparkplug-edge-resolver.service');

function trimSeg(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * Pure candidate ordering (unit-testable).
 *
 * @param {{
 *   zoneSlug: string | null;
 *   defaultEdgeNodeId: string | null;
 *   edges: Array<{ zoneKey: string; edgeNodeId: string }>;
 *   envEdgeNode: string | null;
 * }} p
 * @returns {Array<{ edgeNodeId: string; edgeResolutionSource: string }>}
 */
function buildPdmEdgeCandidateOrder(p) {
  const out = [];
  const seen = new Set();
  const push = (id, source) => {
    const e = trimSeg(id);
    if (!e || seen.has(e)) return;
    seen.add(e);
    out.push({ edgeNodeId: e, edgeResolutionSource: source });
  };

  const zoneSlug = p.zoneSlug != null && trimSeg(p.zoneSlug) ? trimSeg(p.zoneSlug) : null;
  if (zoneSlug && Array.isArray(p.edges)) {
    for (const row of p.edges) {
      if (!row || !trimSeg(row.zoneKey)) continue;
      if (zonesMatchNormalized(zoneSlug, row.zoneKey)) {
        push(row.edgeNodeId, 'ZONE_MATCH');
        break;
      }
    }
  }

  push(p.defaultEdgeNodeId, 'PARK_DEFAULT');

  const envE = trimSeg(p.envEdgeNode || '');
  if (envE) push(envE, 'ENV_FALLBACK');

  push('predictive_gateway', 'PDM_ADAPTER_GATEWAY');

  push('park_gateway', 'HARDCODED');

  return out;
}

/**
 * @param {string} assetId
 * @param {string} parkId
 * @returns {Promise<{
 *   resolvedEdgeNodeId: string;
 *   edgeResolutionSource: string;
 *   attemptedEdgeNodeIds: string[];
 *   edgeCandidates: Array<{ edgeNodeId: string; edgeResolutionSource: string }>;
 *   resolverReason: string;
 *   zoneSlug: string | null;
 * }>}
 */
async function resolvePdmSparkplugEdgeCandidatesForAsset(assetId, parkId) {
  const aid = trimSeg(assetId);
  const pid = trimSeg(parkId);

  const parkRow = await Park.findByPk(pid, { attributes: ['id', 'slug', 'masterProfile'] });
  const masterProfile =
    parkRow && typeof parkRow.get === 'function' ? parkRow.get('masterProfile') : parkRow?.masterProfile;

  const { defaultEdgeNodeId, edges } = parseSparkplugEdgesFromParkProfile(masterProfile);

  /** @type {string | null} */
  let zoneSlug = null;
  if (aid && parkRow) {
    const assetRow = await ParkAsset.findOne({
      where: { assetId: aid, parkId: pid },
      attributes: ['assetId', 'zoneId'],
    });
    if (assetRow) {
      const plain = assetRow.get ? assetRow.get({ plain: true }) : assetRow;
      const zid = plain.zoneId != null ? String(plain.zoneId).trim() : null;
      if (zid) {
        const zRow = await ParkZone.findByPk(zid, { attributes: ['slug'] });
        if (zRow && zRow.slug != null) zoneSlug = String(zRow.slug).trim();
      }
    }
  }

  const edgeCandidates = buildPdmEdgeCandidateOrder({
    zoneSlug,
    defaultEdgeNodeId,
    edges,
    envEdgeNode: env.sparkplugEdgeNode || '',
  });

  const resolution = await resolveSparkplugEdgeNodeForAsset({
    assetId: aid || null,
    parkId: pid || null,
  });

  return {
    resolvedEdgeNodeId: resolution.edgeNodeId,
    edgeResolutionSource: resolution.source,
    attemptedEdgeNodeIds: edgeCandidates.map((c) => c.edgeNodeId),
    edgeCandidates,
    resolverReason: resolution.reason,
    zoneSlug,
  };
}

/**
 * Prefer rows discovered on earlier (higher-priority) edges when the same device+metric appears twice.
 * @param {Array<{ edgeNodeId: string; rows: Array<Record<string, unknown>> }>} perEdge
 * @returns {Array<Record<string, unknown>>}
 */
function mergeSparkplugMetricRowsByEdgePriority(perEdge) {
  /** @type {Map<string, { row: Record<string, unknown>; edgeIdx: number }>} */
  const map = new Map();
  for (let ei = 0; ei < perEdge.length; ei += 1) {
    const pack = perEdge[ei];
    const edgeId = trimSeg(pack?.edgeNodeId);
    const rows = Array.isArray(pack?.rows) ? pack.rows : [];
    for (const r of rows) {
      if (r == null || typeof r !== 'object') continue;
      const k = `${String(r.sparkplugDeviceId || '')}\0${String(r.metricName || '')}`;
      const prev = map.get(k);
      if (!prev || ei < prev.edgeIdx) {
        const row = { ...r, ...(edgeId ? { sourceEdgeNodeId: edgeId } : {}) };
        map.set(k, { row, edgeIdx: ei });
      }
    }
  }
  return [...map.values()]
    .map((x) => x.row)
    .sort((a, b) => {
      const c = String(a.metricName || '').localeCompare(String(b.metricName || ''));
      if (c !== 0) return c;
      return String(a.sparkplugDeviceId || '').localeCompare(String(b.sparkplugDeviceId || ''));
    });
}

module.exports = {
  buildPdmEdgeCandidateOrder,
  resolvePdmSparkplugEdgeCandidatesForAsset,
  mergeSparkplugMetricRowsByEdgePriority,
};
