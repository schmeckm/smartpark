'use strict';

const { TrafficCorridor, TrafficCorridorSnapshot5m } = require('../../models');
const { computeSnapshotMetrics } = require('./attendance-risk-math');

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

/**
 * Traffic Signal Adapter — manual snapshots MVP (external providers later).
 */
class TrafficSignalAdapter {
  constructor(models = { TrafficCorridor, TrafficCorridorSnapshot5m }) {
    this.TrafficCorridor = models.TrafficCorridor;
    this.TrafficCorridorSnapshot5m = models.TrafficCorridorSnapshot5m;
  }

  async createManualSnapshot(corridorId, currentTravelTimeMin, snapshotTsOpt) {
    const corridor = await this.TrafficCorridor.findByPk(corridorId);
    if (!corridor) return null;
    const baseline = Number(corridor.baselineTravelTimeMin);
    const direction = corridor.direction || 'inbound';
    const metrics = computeSnapshotMetrics({
      currentTravelTimeMin: Number(currentTravelTimeMin),
      baselineTravelTimeMin: baseline,
      direction,
      weight: Number(corridor.weight) || 1,
      incidentCount: 0,
    });
    const snapshotTs = snapshotTsOpt ? new Date(snapshotTsOpt) : new Date();
    const row = await this.TrafficCorridorSnapshot5m.create({
      corridorId: corridor.id,
      parkId: corridor.parkId,
      snapshotTs,
      source: 'manual',
      currentTravelTimeMin,
      baselineTravelTimeMin: baseline,
      delayMin: metrics.delay_min,
      delayPercent: metrics.delay_percent,
      congestionScore: metrics.congestion_score,
      inboundPressureScore: metrics.inbound_pressure_score,
      rawPayloadJson: { manual: true },
    });
    return plainRow(row);
  }
}

module.exports = { TrafficSignalAdapter };
