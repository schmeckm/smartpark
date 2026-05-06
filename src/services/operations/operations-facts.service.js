'use strict';

/**
 * Operations Facts Layer — **read-only stub / contract** for a future shared operational truth.
 *
 * This module intentionally does **not** consolidate Add-on Board, SQDC, timeseries, or ML logic yet.
 * Each method documents the **intended source of truth** and returns a safe empty or delegated shape.
 *
 * Future delegation targets (TODO — move KPI resolution here, then thin the callers):
 * - {@link ../addon-board.service.js} — park/zone/ride board aggregates, SWDEC-style ride cards
 * - {@link ../sqdc-board.service.js} — hierarchical SQDC/SWDEC scores and daily snapshots (facts only, not ring scores)
 * - {@link ../timeseries.service.js} — persisted live ride wait samples, queue history
 * - {@link ../ml/addon-board-ml-bridge.service.js} — ML / baseline wait forecasts and top factors
 * - MQTT / Sparkplug live buffer (when wired) — real-time queue_time and status metrics
 * - `ride_feature_snapshots_5m` / park feature snapshots — batch feature store
 * - Canonical inbound messages — WAIT_TIME_UPDATED, ENTITY_STATUS_UPDATED
 * - {@link ../incident.service.js} / Incident model — open safety-related incidents
 */
const { AppError } = require('../../utils/app-error');
const { TimeseriesService } = require('../timeseries.service');
const { ParkAsset } = require('../../models');

/** @enum {string} */
const FALLBACK_REASON = {
  MISSING_PARK_ID: 'MISSING_PARK_ID',
  PARK_NOT_FOUND: 'PARK_NOT_FOUND',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  NONE: null,
};

const STUB_META = {
  phase: 'architecture-stub',
  message: 'Operations Facts layer not implemented; contract-only.',
};

class OperationsFactsService {
  /**
   * @param {{ timeseriesService?: import('../timeseries.service').TimeseriesService }} [deps]
   */
  constructor(deps = {}) {
    this._timeseries = deps.timeseriesService || new TimeseriesService();
  }

  /**
   * Intended sources: platform `park_assets` + zones, feature snapshots, timeseries waits, incidents roll-up.
   * @param {{ parkId: string, at?: string|Date }} _params
   * @returns {Promise<{ parkId: string, at: string|null, facts: Record<string, never>, meta: object }>}
   */
  async getParkOperationalFacts(_params) {
    const parkId = _params?.parkId != null ? String(_params.parkId) : null;
    const at = _params?.at != null ? new Date(_params.at).toISOString() : null;
    return { parkId, at, facts: {}, meta: { ...STUB_META, intendedSources: ['addon-board', 'snapshots', 'timeseries'] } };
  }

  /**
   * Intended sources: single `park_assets` row, ride master, live MQTT, snapshots, canonical events, ML bridge.
   * @param {{ parkId: string, assetId: string, at?: string|Date }} _params
   */
  async getAssetOperationalFacts(_params) {
    const parkId = _params?.parkId != null ? String(_params.parkId) : null;
    const assetId = _params?.assetId != null ? String(_params.assetId) : null;
    const at = _params?.at != null ? new Date(_params.at).toISOString() : null;
    return { parkId, assetId, at, facts: {}, meta: { ...STUB_META, intendedSources: ['addon-board', 'sqdc-board', 'snapshots'] } };
  }

  /**
   * Intended sources: MQTT live queue_time → timeseries sample → `ride_feature_snapshots_5m` → canonical WAIT_TIME_UPDATED.
   * @param {{ parkId: string, assetId: string }} _params
   */
  async getLatestWaitTimeFacts(_params) {
    const r = await this.getCurrentRideWaitsForPark({ parkId: _params?.parkId, hours: 6 });
    return {
      ok: r.ok,
      wait: null,
      items: r.items,
      meta: {
        ...r.meta,
        ...STUB_META,
        intendedSources: ['mqtt-live-buffer', 'timeseries.service', 'ride_feature_snapshots', 'canonical-inbound'],
      },
    };
  }

  /**
   * Intended sources: live throughput topics → snapshot capacity / guest counts → OEE simulators.
   * @param {{ parkId: string, assetId: string, windowMinutes?: number }} _params
   */
  async getThroughputFacts(_params) {
    return {
      parkId: _params?.parkId != null ? String(_params.parkId) : null,
      assetId: _params?.assetId != null ? String(_params.assetId) : null,
      windowMinutes: _params?.windowMinutes ?? null,
      facts: {},
      meta: { ...STUB_META, intendedSources: ['addon-board', 'ride_feature_snapshots', 'mqtt'] },
    };
  }

  /**
   * Intended sources: geo-pressure engine, wait deltas, congestion proxies (may share wait facts).
   * @param {{ parkId: string, assetId: string, windowMinutes?: number }} _params
   */
  async getQueuePressureFacts(_params) {
    return {
      parkId: _params?.parkId != null ? String(_params.parkId) : null,
      assetId: _params?.assetId != null ? String(_params.assetId) : null,
      windowMinutes: _params?.windowMinutes ?? null,
      facts: {},
      meta: { ...STUB_META, intendedSources: ['geo-pressure-engine.service', 'timeseries'] },
    };
  }

  /**
   * Intended sources: Incident service, safety_status topics, fault severity mapping.
   * @param {{ parkId: string, windowMinutes?: number }} _params
   */
  async getSafetyFacts(_params) {
    return {
      parkId: _params?.parkId != null ? String(_params.parkId) : null,
      windowMinutes: _params?.windowMinutes ?? null,
      facts: {},
      meta: { ...STUB_META, intendedSources: ['incident.service', 'snapshots', 'mqtt'] },
    };
  }

  /**
   * Intended sources: `sqdc-board.service` daily snapshots + events (this stub does not call SQDC yet).
   * @param {{ parkId: string, businessDate: string }} _params
   */
  async getSqdcFacts(_params) {
    return {
      parkId: _params?.parkId != null ? String(_params.parkId) : null,
      businessDate: _params?.businessDate != null ? String(_params.businessDate) : null,
      facts: {},
      meta: { ...STUB_META, intendedSources: ['sqdc-board.service', 'SqdcDailySnapshot', 'SqdcEvent'] },
    };
  }

  /**
   * HTTP helper: park-wide ride fact envelopes (future). Returns empty `rides` until implemented.
   * @param {{ parkId: string }} params
   */
  async getParkFacts(params) {
    const parkId = params?.parkId != null ? String(params.parkId) : '';
    return {
      parkId,
      timestamp: new Date().toISOString(),
      rides: [],
      meta: STUB_META,
    };
  }

  /**
   * HTTP helper: one zone (future).
   * @param {{ parkId: string, zoneId: string }} params
   */
  async getZoneFacts(params) {
    const parkId = params?.parkId != null ? String(params.parkId) : '';
    const zoneId = params?.zoneId != null ? String(params.zoneId) : '';
    return {
      parkId,
      zoneId,
      timestamp: new Date().toISOString(),
      rides: [],
      meta: STUB_META,
    };
  }

  /**
   * HTTP helper: single ride asset (future). Uses `ParkAsset` lookup only for 404 semantics.
   * @param {{ parkId: string, rideId: string }} params
   */
  async getRideFacts(params) {
    const parkId = params?.parkId != null ? String(params.parkId) : '';
    const rideId = params?.rideId != null ? String(params.rideId) : '';
    if (!parkId || !rideId) return null;
    const row = await ParkAsset.findOne({ where: { parkId, assetId: rideId }, attributes: ['assetId'] });
    if (!row) return null;
    return {
      parkId,
      rideId,
      timestamp: new Date().toISOString(),
      facts: {},
      meta: STUB_META,
    };
  }

  /**
   * Safe delegation: current ride waits per RIDE asset ({@link TimeseriesService#getCurrentRideWaitsForPark}).
   *
   * @param {{ parkId: string | null | undefined; hours?: number }} params
   * @returns {Promise<{ ok: boolean; items: unknown[]; meta: { source: string; fallbackReason: string | null; code?: string; message?: string } }>}
   */
  async getCurrentRideWaitsForPark(params) {
    const { parkId, hours = 24 } = params || {};
    if (parkId == null || String(parkId).trim() === '') {
      return {
        ok: false,
        items: [],
        meta: { source: 'operations-facts', fallbackReason: FALLBACK_REASON.MISSING_PARK_ID },
      };
    }
    try {
      const rows = await this._timeseries.getCurrentRideWaitsForPark({
        parkId: String(parkId),
        hours: Number(hours) || 24,
      });
      return {
        ok: true,
        items: rows,
        meta: { source: 'timeseries', fallbackReason: FALLBACK_REASON.NONE },
      };
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 404) {
        return {
          ok: false,
          items: [],
          meta: {
            source: 'operations-facts',
            fallbackReason: FALLBACK_REASON.PARK_NOT_FOUND,
            code: e.code || 'NOT_FOUND',
          },
        };
      }
      return {
        ok: false,
        items: [],
        meta: {
          source: 'operations-facts',
          fallbackReason: FALLBACK_REASON.UPSTREAM_ERROR,
          code: e instanceof AppError ? e.code : undefined,
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }
}

const operationsFactsService = new OperationsFactsService();

/** @type {(keyof OperationsFactsService)[]} */
const EXPORTED_SERVICE_METHODS = [
  'getParkOperationalFacts',
  'getAssetOperationalFacts',
  'getLatestWaitTimeFacts',
  'getThroughputFacts',
  'getQueuePressureFacts',
  'getSafetyFacts',
  'getSqdcFacts',
  'getParkFacts',
  'getZoneFacts',
  'getRideFacts',
  'getCurrentRideWaitsForPark',
];

module.exports = {
  OperationsFactsService,
  operationsFactsService,
  FALLBACK_REASON,
  EXPORTED_SERVICE_METHODS,
};
