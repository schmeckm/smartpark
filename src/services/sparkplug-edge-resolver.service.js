'use strict';

/**
 * Zone-aware Sparkplug edge node resolution for MQTT topics.
 *
 * Business rule: `park_assets.zone_id` → `park_zones.slug` must match `master_profile.sparkplug.edges[].zoneKey`
 * (compared slug-normalized); the matching row's `edgeNodeId` selects the MQTT topic segment.
 * Zones are never appended as extra topic segments — only `edge_node_id` changes.
 *
 * @see docs/architecture/sparkplug-zone-edge-resolution.md
 */

const { Op } = require('sequelize');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { buildSparkplugTopic } = require('../modules/uns/sparkplug-topic-builder.service');

let Park;
let ParkAsset;
let ParkZone;
try {
  ({ Park, ParkAsset, ParkZone } = require('../models'));
} catch {
  /* integration tests without full model graph */
}

function trimSeg(v) {
  const s = v == null ? '' : String(v).trim();
  return s;
}

/** @typedef {{ zoneKey?: string; edgeNodeId?: string; label?: string; role?: string; note?: string; notes?: string }} SparkplugEdgeFormRow */

/**
 * @param {unknown} masterProfileJson
 * @returns {{ defaultEdgeNodeId: string | null; edges: Array<{ zoneKey: string; edgeNodeId: string; raw: SparkplugEdgeFormRow }> }}
 */
function parseSparkplugEdgesFromParkProfile(masterProfileJson) {
  const mp =
    masterProfileJson && typeof masterProfileJson === 'object'
      ? /** @type {Record<string, unknown>} */ (masterProfileJson)
      : {};
  const sp = mp.sparkplug && typeof mp.sparkplug === 'object' ? /** @type {Record<string, unknown>} */ (mp.sparkplug) : {};
  const defRaw = sp.defaultEdgeNodeId ?? sp.default_edge_node_id ?? '';
  const defaultEdgeNodeId = trimSeg(defRaw) || null;
  const rawEdges = Array.isArray(sp.edges) ? sp.edges : [];
  const edges = [];
  for (const row of rawEdges) {
    const e =
      row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
    const zoneKey =
      trimSeg(e.zoneKey ?? e.zone_key ?? '') ||
      trimSeg(typeof e.zone === 'string' ? e.zone : '');
    const edgeNodeId = trimSeg(e.edgeNodeId ?? e.edge_node_id ?? '');
    if (!edgeNodeId) continue;
    edges.push({
      zoneKey,
      edgeNodeId,
      raw: e,
    });
  }
  return { defaultEdgeNodeId, edges };
}

/**
 * @param {string | null | undefined} zoneSlugDb
 * @param {string | null | undefined} edgeZoneKey
 */
function zonesMatchNormalized(zoneSlugDb, edgeZoneKey) {
  const a = slugifyName(zoneSlugDb || '');
  const b = slugifyName(edgeZoneKey || '');
  if (!a || !b) return false;
  return a === b;
}

/**
 * Fallback chain after zone logic (park default → env → hardcoded).
 * @param {{ defaultFromProfile?: string | null }} p
 */
function resolveFallbackChain(p) {
  const d = trimSeg(p.defaultFromProfile);
  if (d) return { edgeNodeId: d, layer: 'DEFAULT_PROFILE', reason: 'park.sparkplug.defaultEdgeNodeId' };
  const e = trimSeg(env.sparkplugEdgeNode || '');
  if (e) return { edgeNodeId: e, layer: 'ENV', reason: 'SPARKPLUG_EDGE_NODE' };
  return { edgeNodeId: 'park_gateway', layer: 'HARDCODED', reason: 'park_gateway_fallback' };
}

function hardcodedWhenNoModels() {
  const fb = resolveFallbackChain({});
  logger.debug({ edgeNodeId: fb.edgeNodeId, source: fb.layer }, 'sparkplug edge resolver (models unavailable)');
  return fb;
}

/**
 * Sync resolution from already-loaded park profile JSON + optional zone slug (pure; for tests).
 * @param {{
 *   parkMasterProfile?: unknown;
 *   zoneSlug?: string | null;
 *   sparkplugEdgesHint?: Array<{ zoneKey: string; edgeNodeId: string }>;
 * }} opts
 */
function resolveSparkplugEdgeFromParkProfile(opts = {}) {
  const { defaultEdgeNodeId, edges: parsedEdges } = parseSparkplugEdgesFromParkProfile(
    opts.parkMasterProfile
  );
  const edges =
    opts.sparkplugEdgesHint && opts.sparkplugEdgesHint.length ? opts.sparkplugEdgesHint : parsedEdges;

  const zoneSlug = opts.zoneSlug != null && trimSeg(opts.zoneSlug) ? trimSeg(opts.zoneSlug) : null;
  /** @type {SparkplugEdgeFormRow | null} */
  let matchedEdgeEntry = null;
  if (zoneSlug) {
    for (const e of edges) {
      if (!e.zoneKey) continue;
      if (zonesMatchNormalized(zoneSlug, e.zoneKey)) {
        matchedEdgeEntry = /** @type {SparkplugEdgeFormRow} */ ({
          zoneKey: e.zoneKey,
          edgeNodeId: e.edgeNodeId,
        });
        break;
      }
    }
    if (matchedEdgeEntry?.edgeNodeId) {
      return {
        edgeNodeId: matchedEdgeEntry.edgeNodeId,
        source: 'ZONE_MATCH',
        matchedEdge: matchedEdgeEntry,
        fallbackUsed: false,
        reason: `zone.slug matched edges[].zoneKey (${zoneSlug})`,
      };
    }
    const fb = resolveFallbackChain({ defaultFromProfile: defaultEdgeNodeId });
    return {
      edgeNodeId: fb.edgeNodeId,
      source: 'ZONE_MISSING_EDGE_FALLBACK',
      matchedEdge: null,
      fallbackUsed: true,
      reason:
        fb.layer === 'DEFAULT_PROFILE'
          ? `asset zone '${zoneSlug}' has no sparkplug.edges row; park default_edge`
          : `asset zone '${zoneSlug}' has no sparkplug.edges row; ${fb.reason}`,
      _warnZoneNoEdgeRow: true,
    };
  }

  const fb = resolveFallbackChain({ defaultFromProfile: defaultEdgeNodeId });
  return {
    edgeNodeId: fb.edgeNodeId,
    source: fb.layer === 'DEFAULT_PROFILE' ? 'PARK_DEFAULT' : fb.layer === 'ENV' ? 'ENV_FALLBACK' : 'HARDCODED',
    matchedEdge: null,
    fallbackUsed: fb.layer !== 'DEFAULT_PROFILE',
    reason: fb.reason,
  };
}

/**
 * @typedef {{
 *   edgeNodeId: string;
 *   source: string;
 *   parkId: string | null;
 *   parkSlug: string | null;
 *   assetId: string | null;
 *   assetSlug: string | null;
 *   zoneId: string | null;
 *   zoneSlug: string | null;
 *   matchedEdge: SparkplugEdgeFormRow | null;
 *   fallbackUsed: boolean;
 *   reason: string;
 * }} SparkplugEdgeResolution
 */

/**
 * @param {{
 *   parkId?: string | null;
 *   parkSlug?: string | null;
 *   assetId?: string | null;
 *   assetSlug?: string | null;
 *   adapterContext?: Record<string, unknown>;
 *   explicitEdgeNodeId?: string | null;
 * }} args
 * @returns {Promise<SparkplugEdgeResolution>}
 */
async function resolveSparkplugEdgeNodeForAsset(args = {}) {
  const adapterContext = args.adapterContext && typeof args.adapterContext === 'object' ? args.adapterContext : {};

  let explicit = trimSeg(args.explicitEdgeNodeId);
  if (!explicit && adapterContext.sparkplugEdgeNodeOverride != null) {
    explicit = trimSeg(adapterContext.sparkplugEdgeNodeOverride);
  }
  if (!explicit && adapterContext.explicitSparkplugEdge != null) {
    explicit = trimSeg(adapterContext.explicitSparkplugEdge);
  }

  let ctxEdge =
    adapterContext.edgeNodeId != null
      ? trimSeg(adapterContext.edgeNodeId)
      : adapterContext.edge_node_id != null
        ? trimSeg(adapterContext.edge_node_id)
        : '';

  if (explicit) {
    logger.debug(
      { explicitEdgeNodeId: explicit, assetId: args.assetId ?? null },
      'sparkplug edge resolver: explicit override wins'
    );
    return baseResolution({
      explicit,
      explicitSource: 'EXPLICIT_OVERRIDE',
      parkId: args.parkId ?? null,
      parkSlug: args.parkSlug ?? null,
      assetId: args.assetId ?? null,
      assetSlug: args.assetSlug ?? null,
      zoneId: null,
      zoneSlug: null,
      matchedEdge: null,
      fallbackUsed: false,
      reason: 'explicit EdgeNodeId from trusted caller',
    });
  }

  if (ctxEdge) {
    logger.debug({ edgeNodeId: ctxEdge }, 'sparkplug edge resolver: adapter context edgeNodeId');
    return baseResolution({
      explicit: ctxEdge,
      explicitSource: 'ADAPTER_CONTEXT',
      parkId: args.parkId ?? null,
      parkSlug: args.parkSlug ?? null,
      assetId: args.assetId ?? null,
      assetSlug: args.assetSlug ?? null,
      zoneId: null,
      zoneSlug: null,
      matchedEdge: null,
      fallbackUsed: false,
      reason: 'adapter context edgeNodeId',
    });
  }

  if (!Park || !ParkAsset) {
    const fb = hardcodedWhenNoModels();
    return baseResolution({
      explicit: fb.edgeNodeId,
      explicitSource: fb.layer === 'HARDCODED' ? 'HARDCODED_DEFAULT' : 'ENV_FALLBACK',
      parkId: args.parkId ?? null,
      parkSlug: args.parkSlug ?? null,
      assetId: args.assetId ?? null,
      assetSlug: args.assetSlug ?? null,
      zoneId: null,
      zoneSlug: null,
      matchedEdge: null,
      fallbackUsed: true,
      reason: fb.reason + ' (models unavailable)',
    });
  }

  let parkRow = null;
  const pid = args.parkId != null ? trimSeg(args.parkId) : '';
  const pSlug = args.parkSlug != null ? trimSeg(args.parkSlug) : '';

  if (pid) {
    parkRow = await Park.findByPk(pid, { attributes: ['id', 'slug', 'masterProfile'] });
  } else if (pSlug) {
    const norm = slugifyName(pSlug);
    parkRow = await Park.findOne({
      where: { [Op.or]: [{ slug: norm }, { slug: pSlug }] },
      attributes: ['id', 'slug', 'masterProfile'],
    });
  }

  if (!parkRow) {
    logger.warn(
      { parkId: pid || null, parkSlug: pSlug || null },
      'sparkplug edge resolver: park not resolved — using ENV / park_gateway'
    );
    const fb = resolveFallbackChain({});
    return baseResolution({
      explicit: fb.edgeNodeId,
      explicitSource: fb.layer === 'HARDCODED' ? 'HARDCODED_DEFAULT' : fb.layer === 'ENV' ? 'ENV_FALLBACK' : 'UNKNOWN',
      parkId: null,
      parkSlug: null,
      assetId: args.assetId ?? null,
      assetSlug: args.assetSlug ?? null,
      zoneId: null,
      zoneSlug: null,
      matchedEdge: null,
      fallbackUsed: true,
      reason: 'PARK_NOT_RESOLVED:' + fb.reason,
    });
  }

  /** @type {import('sequelize').Model | null} */
  let assetRow = null;
  const aid = args.assetId != null ? trimSeg(args.assetId) : '';
  const aslug = args.assetSlug != null ? trimSeg(args.assetSlug) : '';

  if (aid) {
    assetRow = await ParkAsset.findOne({
      where: { assetId: aid, parkId: parkRow.id },
      attributes: ['assetId', 'parkId', 'slug', 'zoneId'],
    });
  }
  if (!assetRow && aslug) {
    assetRow = await ParkAsset.findOne({
      where: {
        parkId: parkRow.id,
        slug: {
          [Op.or]: [slugifyName(aslug), aslug],
        },
      },
      attributes: ['assetId', 'parkId', 'slug', 'zoneId'],
    });
  }

  const parkSlugOut = parkRow.slug != null ? String(parkRow.slug).trim() : null;
  const masterProfile =
    typeof parkRow.get === 'function' ? parkRow.get('masterProfile') : parkRow.masterProfile;

  if (!assetRow) {
    const inner = resolveSparkplugEdgeFromParkProfile({
      parkMasterProfile: masterProfile,
      zoneSlug: null,
    });
    logger.warn(
      { parkId: parkRow.id, assetIdOrSlug: aid || aslug || null },
      'sparkplug edge resolver: asset not resolved — using park default/env topic segment'
    );
    return finalizeDbResolution({
      parkRowId: parkRow.id,
      parkSlugOut,
      inner,
      assetId: aid || null,
      assetSlug: aslug || null,
      zoneId: null,
      zoneSlug: null,
      forcedAssetMissing: true,
    });
  }

  const plain = assetRow.get ? assetRow.get({ plain: true }) : assetRow;
  const zoneIdRaw = plain.zoneId != null ? String(plain.zoneId).trim() : null;
  const assetSlugOut = plain.slug != null ? String(plain.slug).trim() : null;
  const assetIdOut = plain.assetId != null ? String(plain.assetId).trim() : null;

  /** @type {string | null} */
  let zoneSlug = null;
  if (zoneIdRaw && ParkZone) {
    const zRow = await ParkZone.findByPk(zoneIdRaw, { attributes: ['id', 'slug'] });
    if (zRow) zoneSlug = zRow.slug != null ? String(zRow.slug).trim() : null;
  }

  const inner = resolveSparkplugEdgeFromParkProfile({
    parkMasterProfile: masterProfile,
    zoneSlug,
  });

  if (inner._warnZoneNoEdgeRow) {
    logger.warn(
      {
        parkId: parkRow.id,
        assetId: assetIdOut,
        zoneId: zoneIdRaw,
        zoneSlug,
      },
      'sparkplug edge resolver: asset zone has no matching sparkplug.edges zoneKey row — fallback'
    );
    delete inner._warnZoneNoEdgeRow;
  } else if (inner.source !== 'ZONE_MATCH' && zoneSlug === null && inner.fallbackUsed) {
    logger.debug(
      { parkId: parkRow.id, assetId: assetIdOut, edgeNodeId: inner.edgeNodeId, source: inner.source },
      'sparkplug edge resolver: no asset zone — default/env edge'
    );
  } else if (inner.source === 'ZONE_MATCH') {
    logger.debug(
      {
        parkId: parkRow.id,
        assetId: assetIdOut,
        zoneSlug,
        edgeNodeId: inner.edgeNodeId,
        source: inner.source,
      },
      'sparkplug edge resolver: zone-aware resolution'
    );
  }

  return finalizeDbResolution({
    parkRowId: parkRow.id,
    parkSlugOut,
    inner,
    assetId: assetIdOut,
    assetSlug: assetSlugOut,
    zoneId: zoneIdRaw,
    zoneSlug,
    forcedAssetMissing: false,
  });
}

/**
 * @param {Omit<SparkplugEdgeResolution,'edgeNodeId'|'matchedEdge'> & {
 *   explicit: string;
 *   explicitSource: string;
 *   matchedEdge: SparkplugEdgeFormRow | null;
 * }} x
 */
function baseResolution(x) {
  const edgeNodeId = trimSeg(x.explicit);
  const safeEdge = edgeNodeId || slugifyName('park_gateway') || 'park_gateway';
  return {
    edgeNodeId: safeEdge,
    source: x.explicitSource,
    parkId: x.parkId,
    parkSlug: x.parkSlug,
    assetId: x.assetId,
    assetSlug: x.assetSlug,
    zoneId: x.zoneId,
    zoneSlug: x.zoneSlug,
    matchedEdge: x.matchedEdge,
    fallbackUsed: x.fallbackUsed,
    reason: x.reason,
  };
}

/**
 * @param {{
 *   parkRowId: string;
 *   parkSlugOut: string | null;
 *   inner: ReturnType<resolveSparkplugEdgeFromParkProfile>;
 *   assetId: string | null;
 *   assetSlug: string | null;
 *   zoneId: string | null;
 *   zoneSlug: string | null;
 *   forcedAssetMissing: boolean;
 * }} p
 */
function finalizeDbResolution(p) {
  const { inner, assetId, assetSlug, zoneId, zoneSlug, parkSlugOut, forcedAssetMissing } = p;

  let srcResolved = forcedAssetMissing
    ? 'ASSET_NOT_RESOLVED_FALLBACK'
    : typeof inner.source === 'string'
      ? inner.source
      : 'UNKNOWN';
  const fbUsed =
    forcedAssetMissing === true ||
    Boolean(inner.fallbackUsed) ||
    outSourceIsFallback(srcResolved);

  const out = {
    edgeNodeId: trimSeg(inner.edgeNodeId) || 'park_gateway',
    source: srcResolved,
    parkId: p.parkRowId,
    parkSlug: parkSlugOut,
    assetId,
    assetSlug,
    zoneId,
    zoneSlug,
    matchedEdge: inner.matchedEdge ?? null,
    fallbackUsed: fbUsed,
    reason:
      forcedAssetMissing === true
        ? `${inner.reason}; ASSET_NOT_RESOLVED`
        : inner.reason || '',
  };

  if (
    inner.fallbackUsed &&
    zoneSlug !== null &&
    String(inner.source || '').includes('ZONE') === false &&
    forcedAssetMissing === false
  ) {
    logger.warn(
      { zoneSlug, edgeNodeId: out.edgeNodeId, source: srcResolved, parkId: p.parkRowId, assetId },
      'sparkplug edge resolver: zone set but no matching sparkplug.edges row — fallback edge used'
    );
  } else if (
    !forcedAssetMissing &&
    fbUsed &&
    zoneSlug === null &&
    srcResolved !== 'ZONE_MATCH' &&
    srcResolved !== 'EXPLICIT_OVERRIDE' &&
    srcResolved !== 'ADAPTER_CONTEXT'
  ) {
    logger.warn(
      { edgeNodeId: out.edgeNodeId, source: srcResolved, parkId: p.parkRowId, assetId },
      'sparkplug edge resolver: asset has no zone — fallback edge chain used'
    );
  }

  return out;
}

function outSourceIsFallback(src) {
  return (
    String(src || '').includes('FALLBACK') ||
    String(src || '').includes('ENV') ||
    String(src || '').includes('HARDCODED') ||
    String(src || '').includes('NOT_RESOLVED')
  );
}

/**
 * @param {{
 *   groupId?: string | null;
 *   parkSlugForGroup?: string | null;
 *   edgeResolution: SparkplugEdgeResolution | { edgeNodeId: string };
 *   assetSlug: string | null | undefined;
 *   messageType?: string;
 * }} args
 */
function buildSparkplugDdataPreview(args) {
  const mt = trimSeg(args.messageType) || 'DDATA';
  const groupIdRaw =
    trimSeg(args.groupId) ||
    (args.parkSlugForGroup ? slugifyName(args.parkSlugForGroup || '') : '') ||
    slugifyName('smartpark');
  const gid = slugifyName(groupIdRaw) || slugifyName('smartpark') || 'smartpark';
  const edge = trimSeg(args.edgeResolution?.edgeNodeId) || 'park_gateway';
  const devSlug = slugifyName(args.assetSlug || 'device');
  const topicPreview = buildSparkplugTopic({
    groupId: gid,
    messageType: mt.toUpperCase(),
    edgeNodeId: edge,
    deviceId: devSlug,
  });
  return topicPreview;
}

/**
 * UNS / Signal View: same resolver + topic segment as MQTT publishers (`spBv1.0/{group}/{MT}/{edge}/{assetSlug}` — zone selects edge only).
 *
 * @param {{
 *   parkId?: string | null;
 *   parkSlug?: string | null;
 *   assetId?: string | null;
 *   assetSlug?: string | null;
 *   adapterContext?: Record<string, unknown>;
 *   explicitEdgeNodeId?: string | null;
 *   messageType?: string | null;
 * }} args
 */
async function sparkplugTopicPreviewForAsset(args = {}) {
  const mtRaw = trimSeg(args.messageType || '');
  const upperMt = mtRaw.toUpperCase();
  const messageType =
    mtRaw &&
    ['DDATA', 'DBIRTH', 'DDEATH', 'NBIRTH', 'NDEATH'].includes(
      upperMt
    )
      ? upperMt
      : 'DDATA';
  const resolved = await resolveSparkplugEdgeNodeForAsset(args);

  let groupRaw = trimSeg(env.sparkplugGroupId);
  if (!groupRaw && resolved.parkSlug) groupRaw = slugifyName(resolved.parkSlug);
  else if (!groupRaw && args.parkSlug) groupRaw = slugifyName(String(args.parkSlug));
  const gid = slugifyName(groupRaw || '') || slugifyName('smartpark');

  const assetSlugForTopic = resolved.assetSlug || trimSeg(args.assetSlug) || '';

  /** @type {string | null} */
  let fallbackWarning = null;
  if (resolved.fallbackUsed) {
    if (resolved.zoneSlug && resolved.source !== 'ZONE_MATCH') {
      fallbackWarning = `No sparkplug.edges row matches zone “${resolved.zoneSlug}”; using fallback.`;
    } else if (!resolved.zoneSlug) {
      fallbackWarning = 'Asset has no zone assignment; using default/env edge.';
    } else {
      fallbackWarning = 'Using fallback edge node.';
    }
  }

  const topicPreview = buildSparkplugDdataPreview({
    groupId: gid,
    edgeResolution: resolved,
    assetSlug: assetSlugForTopic || 'device',
    messageType,
  });

  return {
    assetSlug: assetSlugForTopic ? slugifyName(assetSlugForTopic) : null,
    zoneSlug: resolved.zoneSlug,
    edgeNodeId: resolved.edgeNodeId,
    topicPreview,
    source: resolved.source,
    fallbackUsed: resolved.fallbackUsed,
    fallbackWarning,
    groupId: gid,
    parkSlug: resolved.parkSlug,
    parkId: resolved.parkId,
    assetId: resolved.assetId,
    matchedEdge: resolved.matchedEdge,
    reason: resolved.reason,
    messageType,
  };
}

module.exports = {
  parseSparkplugEdgesFromParkProfile,
  zonesMatchNormalized,
  resolveSparkplugEdgeFromParkProfile,
  resolveSparkplugEdgeNodeForAsset,
  resolveFallbackChain,
  buildSparkplugDdataPreview,
  sparkplugTopicPreviewForAsset,
};
