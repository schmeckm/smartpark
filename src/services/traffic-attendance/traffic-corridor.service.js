'use strict';

const { TrafficCorridor, TrafficCorridorSnapshot5m } = require('../../models');

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
}

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

class TrafficCorridorService {
  async listByPark(parkId) {
    const rows = await TrafficCorridor.findAll({
      where: { parkId },
      order: [['name', 'ASC']],
    });
    const out = [];
    for (const r of rows) {
      const p = plainRow(r);
      const snap = await TrafficCorridorSnapshot5m.findOne({
        where: { corridorId: r.id },
        order: [['snapshotTs', 'DESC']],
      });
      out.push({ ...p, latestSnapshot: snap ? plainRow(snap) : null });
    }
    return out;
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
}

module.exports = { TrafficCorridorService, validateCoordinatesIfPresent };
