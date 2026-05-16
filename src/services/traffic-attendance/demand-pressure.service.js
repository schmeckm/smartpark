'use strict';

const { TrafficCorridor, TrafficCorridorSnapshot5m } = require('../../models');
const {
  computeWeightedTrafficPressure,
  computeExternalDemandPressure,
  computeInboundPressureMvp,
  normalizeStoredDelayPercentAs100,
} = require('./attendance-risk-math');

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

function incidentCountFromSnapshot(plainSnap) {
  const n = plainSnap?.rawPayloadJson?.normalized;
  if (!n || typeof n !== 'object') return 0;
  const v = Number(n.incidentCount);
  return Number.isFinite(v) && v > 0 ? Math.min(50, Math.round(v)) : 0;
}

class DemandPressureService {
  constructor(deps) {
    this.TrafficCorridor = deps?.TrafficCorridor || TrafficCorridor;
    this.TrafficCorridorSnapshot5m = deps?.TrafficCorridorSnapshot5m || TrafficCorridorSnapshot5m;
  }

  /**
   * Latest snapshot per enabled inbound corridor; weighted traffic pressure 0..100.
   * Uses persisted snapshots only (manual, TomTom, …); never calls external routing APIs.
   * @param {string} parkId
   */
  async computeTrafficPressureForPark(parkId) {
    const corridors = await this.TrafficCorridor.findAll({
      where: { parkId, enabled: true, direction: 'inbound' },
    });
    const rows = [];
    for (const c of corridors) {
      const snap = await this.TrafficCorridorSnapshot5m.findOne({
        where: { corridorId: c.id, parkId },
        order: [['snapshotTs', 'DESC']],
      });
      if (!snap) continue;
      const plainSnap = plainRow(snap);
      const plainC = plainRow(c);
      const delayPct = normalizeStoredDelayPercentAs100(plainSnap.delayPercent);
      const cong = Number(plainSnap.congestionScore) || 0;
      const inbound = computeInboundPressureMvp({
        delayPercent: delayPct,
        congestionScore: cong,
        incidentCount: incidentCountFromSnapshot(plainSnap),
        weight: Number(plainC.weight) || 1,
      });
      rows.push({
        inbound_pressure_score: inbound,
        weight: Number(plainC.weight) || 1,
      });
    }
    const traffic_pressure_score = computeWeightedTrafficPressure(rows);
    return { traffic_pressure_score, corridorSnapshotCount: rows.length };
  }

  computeExternalDemandPressureFromComponents(p) {
    return computeExternalDemandPressure(p);
  }
}

module.exports = { DemandPressureService };
