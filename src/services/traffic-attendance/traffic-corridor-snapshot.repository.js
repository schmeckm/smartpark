'use strict';

const { Op } = require('sequelize');
const { sequelize, TrafficCorridorSnapshot5m } = require('../../models');

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

/**
 * Latest snapshot per corridor (one query). PostgreSQL DISTINCT ON.
 * @param {string[]} corridorIds
 * @param {string} [parkId]
 * @returns {Promise<Map<string, object>>} corridorId → plain snapshot
 */
async function findLatestSnapshotsByCorridorIds(corridorIds, parkId = null) {
  const ids = [...new Set((corridorIds || []).map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const parkClause = parkId ? 'AND park_id = :parkId' : '';
  const rows = await sequelize.query(
    `SELECT DISTINCT ON (corridor_id) *
     FROM traffic_corridor_snapshots_5m
     WHERE corridor_id IN (:corridorIds) ${parkClause}
     ORDER BY corridor_id, snapshot_ts DESC`,
    {
      replacements: { corridorIds: ids, parkId: parkId || null },
      type: sequelize.QueryTypes.SELECT,
      model: TrafficCorridorSnapshot5m,
      mapToModel: true,
    }
  );

  for (const row of rows) {
    const p = plainRow(row);
    if (p?.corridorId) map.set(String(p.corridorId), p);
  }
  return map;
}

/**
 * @param {string} corridorId
 * @param {{ from?: Date, to?: Date, limit?: number, parkId?: string }} opts
 */
async function listSnapshotsForCorridor(corridorId, opts = {}) {
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 50));
  const where = { corridorId };
  if (opts.parkId) where.parkId = opts.parkId;
  if (opts.from || opts.to) {
    where.snapshotTs = {};
    if (opts.from) where.snapshotTs[Op.gte] = opts.from;
    if (opts.to) where.snapshotTs[Op.lte] = opts.to;
  }

  const rows = await TrafficCorridorSnapshot5m.findAll({
    where,
    order: [['snapshotTs', 'DESC']],
    limit,
  });
  return rows.map(plainRow);
}

/**
 * @param {Date} olderThan
 * @returns {Promise<number>} deleted row count
 */
async function deleteSnapshotsOlderThan(olderThan) {
  return TrafficCorridorSnapshot5m.destroy({
    where: { snapshotTs: { [Op.lt]: olderThan } },
  });
}

module.exports = {
  findLatestSnapshotsByCorridorIds,
  listSnapshotsForCorridor,
  deleteSnapshotsOlderThan,
  plainRow,
};
