'use strict';

const { TrafficCorridor } = require('../../models');
const { validateWgs84CorridorCoordinates } = require('../../utils/traffic-corridor-coords');
const { normalizeStoredDelayPercentAs100 } = require('./attendance-risk-math');
const { findLatestSnapshotsByCorridorIds, listSnapshotsForCorridor } = require('./traffic-corridor-snapshot.repository');

const COORD_FIELDS = [
  ['originLat', 'originLng'],
  ['destinationLat', 'destinationLng'],
];

function validateCoordinatesIfPresent(payload) {
  for (const [latK, lngK] of COORD_FIELDS) {
    const la = payload[latK];
    const lo = payload[lngK];
    if (la == null && lo == null) continue;
    if (la == null || lo == null) {
      const err = new Error(`COORD_PAIR_INCOMPLETE:${latK}:${lngK}`);
      err.code = 'COORD_PAIR_INCOMPLETE';
      throw err;
    }
  }
  const wgs = validateWgs84CorridorCoordinates(payload);
  if (!wgs.ok) {
    const err = new Error(wgs.message);
    err.code = wgs.code;
    throw err;
  }
}

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

/**
 * @param {Record<string, unknown>} corridorPlain
 * @param {Record<string, unknown>|null} snapPlain
 */
function buildLatestSnapshotDetail(corridorPlain, snapPlain) {
  if (!snapPlain) return null;
  const n =
    snapPlain.rawPayloadJson?.normalized && typeof snapPlain.rawPayloadJson.normalized === 'object'
      ? { ...snapPlain.rawPayloadJson.normalized }
      : null;
  if (n && Object.prototype.hasOwnProperty.call(n, 'providerRawResponse')) delete n.providerRawResponse;

  const cur = Number(snapPlain.currentTravelTimeMin);
  const baseSnap = Number(snapPlain.baselineTravelTimeMin);
  const delayMinutes =
    Number.isFinite(cur) && Number.isFinite(baseSnap) ? Math.max(0, cur - baseSnap) : 0;

  const routeDistanceMeters =
    n?.routeDistanceMeters != null && Number.isFinite(Number(n.routeDistanceMeters))
      ? Number(n.routeDistanceMeters)
      : null;
  const travelTimeSeconds =
    n?.travelTimeSeconds != null && Number.isFinite(Number(n.travelTimeSeconds))
      ? Number(n.travelTimeSeconds)
      : Number.isFinite(cur)
        ? cur * 60
        : null;

  const ttDelay = n?.trafficDelaySeconds != null ? Number(n.trafficDelaySeconds) : NaN;
  let trafficDelaySeconds = null;
  if (Number.isFinite(ttDelay) && ttDelay > 0) trafficDelaySeconds = ttDelay;
  else if (Number.isFinite(delayMinutes)) trafficDelaySeconds = delayMinutes * 60;

  const delayPercent = normalizeStoredDelayPercentAs100(
    n?.delayPercent != null ? n.delayPercent : snapPlain.delayPercent
  );

  const providerStatus =
    n?.providerStatus != null
      ? String(n.providerStatus)
      : String(snapPlain.source || 'unknown') === 'tomtom'
        ? 'ok'
        : 'manual';
  const providerErrorCode = n?.providerErrorCode != null ? n.providerErrorCode : null;
  const providerErrorMessage = n?.providerErrorMessage != null ? n.providerErrorMessage : null;
  const sampledAt = n?.sampledAt != null ? n.sampledAt : snapPlain.snapshotTs;

  return {
    routeDistanceMeters,
    travelTimeSeconds,
    trafficDelaySeconds,
    delayPercent,
    delayMinutes,
    currentTravelTimeMinutes: Number.isFinite(cur) ? cur : null,
    baselineTravelTimeMinutes: Number.isFinite(baseSnap) ? baseSnap : null,
    providerStatus,
    providerErrorCode,
    providerErrorMessage,
    sampledAt,
    routeLooksUnrealistic: providerStatus === 'warning',
  };
}

class TrafficCorridorService {
  async listByPark(parkId) {
    const rows = await TrafficCorridor.findAll({
      where: { parkId },
      order: [['name', 'ASC']],
    });
    const snapByCorridor = await findLatestSnapshotsByCorridorIds(
      rows.map((r) => r.id),
      parkId
    );
    return rows.map((r) => {
      const p = plainRow(r);
      const snapPlain = snapByCorridor.get(String(r.id)) || null;
      return {
        ...p,
        latestSnapshot: snapPlain,
        latestSnapshotDetail: buildLatestSnapshotDetail(p, snapPlain),
      };
    });
  }

  async create(parkId, payload) {
    validateCoordinatesIfPresent(payload);
    const row = await TrafficCorridor.create({
      parkId,
      name: payload.name,
      description: payload.description ?? null,
      originLabel: payload.originLabel ?? null,
      originLat: payload.originLat ?? null,
      originLng: payload.originLng ?? null,
      destinationLabel: payload.destinationLabel ?? null,
      destinationLat: payload.destinationLat ?? null,
      destinationLng: payload.destinationLng ?? null,
      direction: payload.direction ?? 'inbound',
      baselineTravelTimeMin: payload.baselineTravelTimeMin,
      weight: payload.weight != null ? payload.weight : 1.0,
      enabled: payload.enabled !== false,
    });
    return plainRow(row);
  }

  async update(corridorId, payload) {
    const row = await TrafficCorridor.findByPk(corridorId);
    if (!row) return null;
    const merged = { ...plainRow(row), ...payload };
    validateCoordinatesIfPresent(merged);
    const patch = {};
    const keys = [
      'name',
      'description',
      'originLabel',
      'originLat',
      'originLng',
      'destinationLabel',
      'destinationLat',
      'destinationLng',
      'direction',
      'baselineTravelTimeMin',
      'weight',
      'enabled',
    ];
    for (const k of keys) {
      if (payload[k] !== undefined) patch[k] = payload[k];
    }
    await row.update(patch);
    return plainRow(await TrafficCorridor.findByPk(corridorId));
  }

  async remove(corridorId) {
    const row = await TrafficCorridor.findByPk(corridorId);
    if (!row) return false;
    await row.destroy();
    return true;
  }

  async getById(corridorId) {
    const row = await TrafficCorridor.findByPk(corridorId);
    return plainRow(row);
  }

  /**
   * Latest snapshot + sanitized provider raw (debug only).
   * @param {string} corridorId
   */
  async getLatestSnapshotDebug(corridorId) {
    const row = await TrafficCorridor.findByPk(corridorId);
    if (!row) return null;
    const corridor = plainRow(row);
    const snapMap = await findLatestSnapshotsByCorridorIds([corridorId], corridor.parkId);
    const snapPlain = snapMap.get(String(corridorId)) || null;
    let providerRawResponse = null;
    if (snapPlain?.rawPayloadJson?.normalized?.providerRawResponse != null) {
      providerRawResponse = snapPlain.rawPayloadJson.normalized.providerRawResponse;
    }
    return {
      corridor,
      latestSnapshot: snapPlain,
      latestSnapshotDetail: buildLatestSnapshotDetail(corridor, snapPlain),
      providerRawResponse,
    };
  }

  /**
   * @param {string} corridorId
   * @param {{ from?: Date, to?: Date, limit?: number }} opts
   */
  async listSnapshotHistory(corridorId, opts = {}) {
    const row = await TrafficCorridor.findByPk(corridorId);
    if (!row) return null;
    const corridor = plainRow(row);
    const snapshots = await listSnapshotsForCorridor(corridorId, {
      ...opts,
      parkId: corridor.parkId,
    });
    return { corridor, snapshots };
  }
}

module.exports = { TrafficCorridorService, validateCoordinatesIfPresent, buildLatestSnapshotDetail };
