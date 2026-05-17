'use strict';

const env = require('../../config/env');
const { AppError } = require('../../utils/app-error');
const { logger } = require('../../utils/logger');
const { TrafficCorridor, TrafficCorridorSnapshot5m } = require('../../models');
const { computeSnapshotMetrics } = require('./attendance-risk-math');
const { TomTomTrafficProvider, TomTomTrafficProviderError } = require('./tomtom-traffic.provider');
const { TrafficProviderConfigService } = require('../traffic-provider-config.service');
const { sanitizeTomTomRawForPersistence } = require('../../utils/tomtom-raw-sanitize');
const { mapWithConcurrency } = require('../../utils/async-pool');
const { findLatestSnapshotsByCorridorIds } = require('./traffic-corridor-snapshot.repository');
const {
  validateWgs84CorridorCoordinates,
  evaluateRouteRealismWarnings,
} = require('../../utils/traffic-corridor-coords');

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

/**
 * Polls TomTom for enabled corridors and persists `TrafficCorridorSnapshot5m` rows (source `tomtom`).
 * Credentials come from {@link TrafficProviderConfigService} (encrypted at rest). External routing is isolated in {@link TomTomTrafficProvider}.
 */
class TrafficSnapshotService {
  constructor(deps = {}) {
    this.TrafficCorridor = deps.TrafficCorridor || TrafficCorridor;
    this.TrafficCorridorSnapshot5m = deps.TrafficCorridorSnapshot5m || TrafficCorridorSnapshot5m;
    this.provider = deps.provider || null;
    this.trafficProviderConfigService =
      deps.trafficProviderConfigService || new TrafficProviderConfigService();
  }

  _providerFromRuntime(rt) {
    if (this.provider) return this.provider;
    return new TomTomTrafficProvider({
      apiKey: rt.apiKey,
      baseUrl: rt.baseUrl,
      timeoutMs: rt.timeoutMs,
    });
  }

  /**
   * Persists last TomTom poll attempt on the corridor row (for UI: red ampel on routing/coord errors).
   * @param {import('sequelize').Model} corridorModel
   * @param {{ polledAt: string, ok: boolean, code?: string, message?: string, snapshotId?: string, httpStatus?: number }} payload
   */
  async _persistCorridorLastPoll(corridorModel, payload) {
    try {
      await corridorModel.update({ lastPollResult: payload });
    } catch (e) {
      let corridorId;
      try {
        corridorId = plainRow(corridorModel)?.id;
      } catch (_) {
        corridorId = undefined;
      }
      logger.warn({ err: e.message, corridorId }, 'traffic-snapshot: persist last_poll_result failed');
    }
  }

  /**
   * @param {{ parkId?: string, requireParkId?: boolean }} [opts]
   */
  async pollEnabledCorridors(opts = {}) {
    if (opts.requireParkId && !opts.parkId) {
      throw new AppError('parkId is required for traffic snapshot poll', 400, { code: 'PARK_ID_REQUIRED' });
    }

    const rt = await this.trafficProviderConfigService.getTomTomRuntimeOrThrow();
    const provider = this._providerFromRuntime(rt);

    const where = { enabled: true };
    if (opts.parkId) where.parkId = opts.parkId;

    const corridors = await this.TrafficCorridor.findAll({ where, order: [['name', 'ASC']] });
    const concurrency = env.trafficPollConcurrency;

    const results = await mapWithConcurrency(corridors, concurrency, async (c) =>
      this._pollOneCorridor(c, provider, rt)
    );

    return { polledAt: new Date().toISOString(), results };
  }

  /**
   * @param {import('sequelize').Model} c
   * @param {TomTomTrafficProvider} provider
   * @param {{ apiKey: string }} rt
   */
  async _pollOneCorridor(c, provider, rt) {
    const rowPlain = plainRow(c);
    const oLatRaw = rowPlain.originLat;
    const oLngRaw = rowPlain.originLng;
    const dLatRaw = rowPlain.destinationLat;
    const dLngRaw = rowPlain.destinationLng;
    if (oLatRaw == null || oLngRaw == null || dLatRaw == null || dLngRaw == null) {
      const polledAt = new Date().toISOString();
      await this._persistCorridorLastPoll(c, {
        polledAt,
        ok: false,
        code: 'INVALID_COORDS',
        message: 'Missing or invalid origin/destination coordinates',
      });
      return {
        corridorId: rowPlain.id,
        ok: false,
        error: { code: 'INVALID_COORDS', message: 'Missing or invalid origin/destination coordinates' },
      };
    }
    const oLat = Number(oLatRaw);
    const oLng = Number(oLngRaw);
    const dLat = Number(dLatRaw);
    const dLng = Number(dLngRaw);
    if (![oLat, oLng, dLat, dLng].every(Number.isFinite)) {
      const polledAt = new Date().toISOString();
      await this._persistCorridorLastPoll(c, {
        polledAt,
        ok: false,
        code: 'INVALID_COORDS',
        message: 'Missing or invalid origin/destination coordinates',
      });
      return {
        corridorId: rowPlain.id,
        ok: false,
        error: { code: 'INVALID_COORDS', message: 'Missing or invalid origin/destination coordinates' },
      };
    }

    const wgs = validateWgs84CorridorCoordinates({
      originLat: oLat,
      originLng: oLng,
      destinationLat: dLat,
      destinationLng: dLng,
    });
    if (!wgs.ok) {
      const polledAt = new Date().toISOString();
      await this._persistCorridorLastPoll(c, {
        polledAt,
        ok: false,
        code: wgs.code,
        message: wgs.message,
      });
      return {
        corridorId: rowPlain.id,
        ok: false,
        error: { code: wgs.code, message: wgs.message },
      };
    }

    try {
        const { normalized, providerRawResponse } = await provider.fetchRouteForCorridor(
          {
            corridorId: rowPlain.id,
            id: rowPlain.id,
            originLat: oLat,
            originLng: oLng,
            destinationLat: dLat,
            destinationLng: dLng,
          },
          { enabled: true }
        );

        const safeRaw = sanitizeTomTomRawForPersistence(providerRawResponse, rt.apiKey);

        const currentMin = normalized.travelTimeSeconds / 60;
        const operatorBaselineMin = Number(rowPlain.baselineTravelTimeMin);
        const operatorBaseline = Number.isFinite(operatorBaselineMin) ? operatorBaselineMin : 0;

        const ttDelaySecRaw = normalized.trafficDelaySeconds;
        const ttDelayOk = Number(ttDelaySecRaw) > 0 && Number.isFinite(Number(ttDelaySecRaw));
        const fallbackDelaySec = Math.max(0, currentMin - operatorBaseline) * 60;
        const trafficDelaySecondsForStore = ttDelayOk ? Number(ttDelaySecRaw) : fallbackDelaySec;

        const realism = evaluateRouteRealismWarnings({
          travelTimeSeconds: normalized.travelTimeSeconds,
          routeDistanceMeters: normalized.routeDistanceMeters,
          currentTravelTimeMin: currentMin,
          operatorBaselineTravelTimeMin: operatorBaseline,
        });
        let providerStatus = normalized.providerStatus || 'ok';
        let providerErrorCode = null;
        let providerErrorMessage = null;
        if (realism.length) {
          providerStatus = 'warning';
          providerErrorCode = realism.map((w) => w.code).join(',');
          providerErrorMessage = realism.map((w) => w.message).join('; ');
        }

        const metrics = computeSnapshotMetrics({
          currentTravelTimeMin: currentMin,
          baselineTravelTimeMin: operatorBaseline,
          direction: rowPlain.direction || 'inbound',
          weight: Number(rowPlain.weight) || 1,
          incidentCount: 0,
        });

        const normalizedCore = {
          ...normalized,
          trafficDelaySeconds: trafficDelaySecondsForStore,
          delayPercent: metrics.delay_percent,
          providerStatus,
          providerErrorCode,
          providerErrorMessage,
        };

        const normalizedFull = {
          ...normalizedCore,
          providerRawResponse: safeRaw,
        };

        const snapRow = await this.TrafficCorridorSnapshot5m.create({
          corridorId: rowPlain.id,
          parkId: rowPlain.parkId,
          snapshotTs: new Date(normalized.sampledAt),
          source: 'tomtom',
          currentTravelTimeMin: currentMin,
          baselineTravelTimeMin: operatorBaseline,
          delayMin: metrics.delay_min,
          delayPercent: metrics.delay_percent,
          congestionScore: metrics.congestion_score,
          inboundPressureScore: metrics.inbound_pressure_score,
          rawPayloadJson: { normalized: normalizedFull },
        });

        const snapPlain = plainRow(snapRow);
        const polledAt = new Date().toISOString();
        await this._persistCorridorLastPoll(c, {
          polledAt,
          ok: true,
          snapshotId: snapPlain.id,
        });

      return {
        corridorId: rowPlain.id,
        ok: true,
        snapshot: snapPlain,
        normalized: normalizedFull,
      };
    } catch (e) {
      if (e instanceof TomTomTrafficProviderError) {
        const polledAt = new Date().toISOString();
        await this._persistCorridorLastPoll(c, {
          polledAt,
          ok: false,
          code: e.code,
          message: e.message,
          ...(e.status != null ? { httpStatus: e.status } : {}),
        });
        return {
          corridorId: rowPlain.id,
          ok: false,
          error: {
            code: e.code,
            message: e.message,
            ...(e.status != null ? { status: e.status } : {}),
          },
        };
      }
      throw e;
    }
  }

  /**
   * Latest snapshot per corridor for a park, with normalized envelope when present.
   * @param {string} parkId
   */
  async getLatestNormalizedSnapshots(parkId) {
    const corridors = await this.TrafficCorridor.findAll({
      where: { parkId },
      order: [['name', 'ASC']],
    });
    const snapByCorridor = await findLatestSnapshotsByCorridorIds(
      corridors.map((c) => c.id),
      parkId
    );
    const out = [];
    for (const c of corridors) {
      const rowPlain = plainRow(c);
      const plainSnap = snapByCorridor.get(String(c.id)) || null;
      let normalized = null;
      if (plainSnap?.rawPayloadJson?.normalized && typeof plainSnap.rawPayloadJson.normalized === 'object') {
        normalized = { ...plainSnap.rawPayloadJson.normalized };
      } else if (plainSnap) {
        const curMin = Number(plainSnap.currentTravelTimeMin) || 0;
        const baseMin = Number(plainSnap.baselineTravelTimeMin) || 0;
        const delayMin = Math.max(0, curMin - baseMin);
        const delayPercent = baseMin > 0 ? (delayMin / baseMin) * 100 : 0;
        normalized = {
          corridorId: rowPlain.id,
          provider: String(plainSnap.source || 'unknown'),
          originLat: rowPlain.originLat != null ? Number(rowPlain.originLat) : null,
          originLng: rowPlain.originLng != null ? Number(rowPlain.originLng) : null,
          destinationLat: rowPlain.destinationLat != null ? Number(rowPlain.destinationLat) : null,
          destinationLng: rowPlain.destinationLng != null ? Number(rowPlain.destinationLng) : null,
          routeDistanceMeters: null,
          travelTimeSeconds: curMin * 60,
          trafficDelaySeconds: delayMin * 60,
          noTrafficTravelTimeSeconds: baseMin > 0 ? baseMin * 60 : null,
          delayPercent,
          sampledAt: plainSnap.snapshotTs,
          providerStatus: plainSnap.source === 'tomtom' ? 'ok' : 'manual',
          providerRawResponse: null,
        };
      }
      if (normalized && typeof normalized === 'object' && normalized.providerRawResponse != null) {
        normalized = { ...normalized };
        delete normalized.providerRawResponse;
      }
      out.push({
        corridorId: rowPlain.id,
        corridorName: rowPlain.name,
        snapshotId: plainSnap?.id ?? null,
        snapshotTs: plainSnap?.snapshotTs ?? null,
        source: plainSnap?.source ?? null,
        normalized,
      });
    }
    return out;
  }
}

module.exports = { TrafficSnapshotService };
