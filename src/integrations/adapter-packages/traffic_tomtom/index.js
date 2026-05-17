'use strict';

const ADAPTER_KEY = 'traffic_tomtom';

const { mergeAdapterInstallConfig, ensureContextParkSlug } = require('../../../utils/adapter-install-config-merge');
const { TrafficSnapshotService } = require('../../../services/traffic-attendance/traffic-snapshot.service');
const { Park } = require('../../../models');

function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
}

function corridorAssetSlug(corridorId) {
  const hex = String(corridorId || '').replace(/-/g, '');
  return hex ? `tc_${hex}` : 'tc_unknown';
}

function snapshotEventTime(snap) {
  const ts = snap && snap.snapshotTs != null ? snap.snapshotTs : new Date();
  const d = ts instanceof Date ? ts : new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * @param {object} [config]
 * @param {object} [context]
 * @returns {Promise<{ parkId: string | null, resolvedBy: string, slug?: string }>}
 */
async function resolveParkPollScope(config, context) {
  const ctx = ensureContextParkSlug(context || {}, config || {});
  const merged = mergeAdapterInstallConfig(config || {}, ctx);
  for (const key of ['parkId', 'externalParkId']) {
    const raw = merged[key];
    if (raw == null || String(raw).trim() === '') continue;
    const id = String(raw).trim();
    if (isUuid(id)) return { parkId: id, resolvedBy: key };
  }
  const slug = String(merged.parkSlug || '').trim();
  if (!slug) return { parkId: null, resolvedBy: 'none' };
  const park = await Park.findOne({ where: { slug } });
  if (!park) return { parkId: null, resolvedBy: 'slug_not_found', slug };
  return { parkId: park.id, resolvedBy: 'slug' };
}

async function validateConfig() {
  return { valid: true, errors: [] };
}

/**
 * Uses encrypted DB credentials (same row as Integrations traffic API).
 * @param {object} [_config]
 * @param {object} [_context]
 */
async function health(_config, _context) {
  try {
    const { TrafficProviderConfigService } = require('../../../services/traffic-provider-config.service');
    const svc = new TrafficProviderConfigService();
    await svc.getTomTomRuntimeOrThrow();
    return { ok: true, message: `${ADAPTER_KEY}: TomTom enabled with valid stored API key` };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return { ok: false, message: `${ADAPTER_KEY}: ${msg}` };
  }
}

async function discover() {
  return [
    {
      id: 'traffic_tomtom_routing',
      name: 'TomTom live traffic (corridor routing)',
      entityType: 'TRAFFIC_CORRIDOR',
      domain: 'operations',
      suggestedSlug: 'traffic_tomtom',
      metrics: [],
    },
  ];
}

/**
 * Runs the same corridor poll as `POST /api/v1/traffic/snapshots/poll`: enabled corridors, TomTom route per row,
 * metrics via `computeSnapshotMetrics`, persist `TrafficCorridorSnapshot5m`.
 *
 * Park scope: `parkId` / `externalParkId` (UUID) or `parkSlug` in merged install context; if none of these match,
 * all enabled corridors are polled (same as an empty HTTP body).
 *
 * @param {object} [config]
 * @param {object} [context]
 */
async function poll(config, context) {
  const scope = await resolveParkPollScope(config, context);
  if (scope.resolvedBy === 'slug_not_found') {
    return {
      observations: [],
      debug: {
        adapterKey: ADAPTER_KEY,
        ok: false,
        error: `Unknown park slug: ${scope.slug}`,
        parkResolution: scope,
      },
    };
  }

  if (!scope.parkId) {
    return {
      observations: [],
      debug: {
        adapterKey: ADAPTER_KEY,
        ok: false,
        error: 'Park scope required — set parkId, externalParkId, or parkSlug in adapter install config',
        parkResolution: scope,
      },
    };
  }

  const pollOpts = { parkId: scope.parkId };
  let summary;
  try {
    const svc = new TrafficSnapshotService();
    summary = await svc.pollEnabledCorridors(pollOpts);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    return {
      observations: [],
      debug: {
        adapterKey: ADAPTER_KEY,
        ok: false,
        error: msg,
        parkResolution: scope,
        pollOpts,
      },
    };
  }

  const observations = [];
  const polledAt = summary.polledAt || new Date().toISOString();

  for (const r of summary.results || []) {
    if (!r.ok || !r.snapshot) continue;
    const snap = r.snapshot;
    const assetSlug = corridorAssetSlug(r.corridorId);
    const eventTime = snapshotEventTime(snap);
    const meta = {
      corridorId: r.corridorId,
      snapshotId: snap.id,
      polledAt,
      parkResolution: scope,
    };
    const rawPayload = {
      corridorId: r.corridorId,
      snapshotId: snap.id,
      parkId: snap.parkId,
    };

    observations.push(
      {
        eventType: 'TRAFFIC_CORRIDOR_SNAPSHOT',
        domain: 'traffic',
        assetSlug,
        metric: 'congestion_score',
        value: snap.congestionScore != null ? Number(snap.congestionScore) : null,
        unit: null,
        eventTime,
        quality: 'GOOD',
        confidence: 0.9,
        source: ADAPTER_KEY,
        provider: 'tomtom',
        metadata: meta,
        rawPayload,
      },
      {
        eventType: 'TRAFFIC_CORRIDOR_SNAPSHOT',
        domain: 'traffic',
        assetSlug,
        metric: 'delay_min',
        value: snap.delayMin != null ? Number(snap.delayMin) : null,
        unit: 'min',
        eventTime,
        quality: 'GOOD',
        confidence: 0.9,
        source: ADAPTER_KEY,
        provider: 'tomtom',
        metadata: meta,
        rawPayload,
      },
      {
        eventType: 'TRAFFIC_CORRIDOR_SNAPSHOT',
        domain: 'traffic',
        assetSlug,
        metric: 'current_travel_time_min',
        value: snap.currentTravelTimeMin != null ? Number(snap.currentTravelTimeMin) : null,
        unit: 'min',
        eventTime,
        quality: 'GOOD',
        confidence: 0.9,
        source: ADAPTER_KEY,
        provider: 'tomtom',
        metadata: meta,
        rawPayload,
      }
    );
  }

  const okCount = (summary.results || []).filter((x) => x.ok).length;
  const errCount = (summary.results || []).length - okCount;

  return {
    observations,
    debug: {
      adapterKey: ADAPTER_KEY,
      ok: true,
      polledAt: summary.polledAt,
      parkResolution: scope,
      pollOpts,
      corridorCount: (summary.results || []).length,
      okCount,
      errCount,
      results: summary.results,
    },
  };
}

module.exports = { validateConfig, discover, poll, health };
