'use strict';

const { TrafficCorridor, TrafficCorridorSnapshot5m } = require('../../models');
const { computeWeightedTrafficPressure, computeExternalDemandPressure } = require('./attendance-risk-math');

class DemandPressureService {
  constructor(deps) {
    this.TrafficCorridor = deps?.TrafficCorridor || TrafficCorridor;
    this.TrafficCorridorSnapshot5m = deps?.TrafficCorridorSnapshot5m || TrafficCorridorSnapshot5m;
  }

  /**
   * Latest snapshot per enabled inbound corridor; weighted traffic pressure 0..100.
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
      rows.push({
        inbound_pressure_score: Number(snap.inboundPressureScore) || 0,
        weight: Number(c.weight) || 1,
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
