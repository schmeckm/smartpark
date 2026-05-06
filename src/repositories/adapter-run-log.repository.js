const { Op } = require('sequelize');
const { AdapterRunLog } = require('../models');

function utcHourKey(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:00:00.000Z`;
}

class AdapterRunLogRepository {
  create(row) {
    return AdapterRunLog.create(row);
  }

  findById(id) {
    return AdapterRunLog.findByPk(id);
  }

  /**
   * @param {{ adapterKey?: string; since?: Date; until?: Date; limit?: number }} opts
   */
  findRecent(opts = {}) {
    const limit = Math.min(2000, Math.max(1, Number(opts.limit) || 100));
    const where = {};
    if (opts.adapterKey) where.adapterKey = String(opts.adapterKey).trim();
    if (opts.since || opts.until) {
      where.createdAt = {};
      if (opts.since) where.createdAt[Op.gte] = opts.since;
      if (opts.until) where.createdAt[Op.lte] = opts.until;
    }
    return AdapterRunLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
    });
  }

  countSince(since, extraWhere = {}) {
    return AdapterRunLog.count({
      where: {
        createdAt: { [Op.gte]: since },
        ...extraWhere,
      },
    });
  }

  /**
   * @param {'runs'|'errors'} mode
   */
  async hourlyBuckets24h(mode = 'runs') {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const where = {
      createdAt: { [Op.gte]: since },
      ...(mode === 'errors' ? { status: { [Op.in]: ['FAILED', 'PARTIAL'] } } : {}),
    };
    const rows = await AdapterRunLog.findAll({
      where,
      attributes: ['createdAt'],
      raw: true,
    });
    const buckets = new Map();
    for (const r of rows) {
      const key = utcHourKey(r.createdAt);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, count]) => ({ hour, count }));
  }

  async avgDurationMsSince(since, adapterKey = null) {
    const where = { createdAt: { [Op.gte]: since } };
    if (adapterKey) where.adapterKey = adapterKey;
    const rows = await AdapterRunLog.findAll({
      where,
      attributes: ['summary'],
      raw: true,
      limit: 5000,
      order: [['createdAt', 'DESC']],
    });
    const vals = [];
    for (const r of rows) {
      const ms = r.summary?.durationMs;
      if (typeof ms === 'number' && Number.isFinite(ms)) vals.push(ms);
    }
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  /**
   * Latest row per adapter key (first occurrence wins while scanning DESC order).
   * @param {string[]} adapterKeys
   */
  async findLatestOnePerAdapter(adapterKeys) {
    const keys = [...new Set((adapterKeys || []).map((k) => String(k || '').trim()).filter(Boolean))];
    if (!keys.length) return {};
    const rows = await AdapterRunLog.findAll({
      where: { adapterKey: { [Op.in]: keys } },
      order: [['createdAt', 'DESC']],
      limit: Math.min(8000, keys.length * 40),
    });
    const map = {};
    for (const row of rows) {
      const k = row.adapterKey;
      if (map[k]) continue;
      map[k] = row;
    }
    return map;
  }
}

module.exports = { AdapterRunLogRepository };
