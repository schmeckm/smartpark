const { Op } = require('sequelize');
const { ZoneCrowdSample } = require('../models');

class ZoneCrowdSampleRepository {
  bulkCreate(records) {
    return ZoneCrowdSample.bulkCreate(records, { validate: true, returning: true });
  }

  findRecentByZoneId(zoneId, { since, limit = 40 }) {
    return ZoneCrowdSample.findAll({
      where: {
        zoneId,
        sampledAt: { [Op.gte]: since },
      },
      order: [['sampledAt', 'ASC']],
      limit,
    });
  }

  /**
   * @param {string[]} zoneIds
   * @param {{ since: Date, limitPerZone?: number }} opts
   * @returns {Promise<Map<string, import('../models').ZoneCrowdSample[]>>}
   */
  async findRecentByZoneIds(zoneIds, { since, limitPerZone = 48 }) {
    const ids = [...new Set(zoneIds.filter(Boolean))];
    const out = new Map(ids.map((id) => [id, []]));
    if (!ids.length) return out;

    const rows = await ZoneCrowdSample.findAll({
      where: { zoneId: { [Op.in]: ids }, sampledAt: { [Op.gte]: since } },
      order: [
        ['zoneId', 'ASC'],
        ['sampledAt', 'DESC'],
      ],
    });

    for (const row of rows) {
      const zid = row.zoneId;
      const list = out.get(zid) || [];
      if (list.length >= limitPerZone) continue;
      list.push(row);
      out.set(zid, list);
    }
    for (const [zid, list] of out) {
      list.sort((a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime());
      out.set(zid, list);
    }
    return out;
  }
}

module.exports = { ZoneCrowdSampleRepository };
