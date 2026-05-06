const { QueryTypes } = require('sequelize');
const { sequelize } = require('../db/sequelize');
const { ParkOperatingSnapshot } = require('../models');

class ParkOperatingSnapshotRepository {
  create(data) {
    return ParkOperatingSnapshot.create(data);
  }

  findLatestByPark(provider, externalParkId) {
    return ParkOperatingSnapshot.findOne({
      where: { provider, externalParkId },
      order: [['sampledAt', 'DESC']],
    });
  }

  /**
   * Latest operating-hours payload for a calendar date (opening_times.date ISO date string).
   * @param {string} provider
   * @param {string} externalParkId
   * @param {string} localDate - YYYY-MM-DD
   * @returns {Promise<{ openingTimes: object, sampledAt: Date } | null>}
   */
  async findLatestOpeningRowForLocalDate(provider, externalParkId, localDate) {
    const rows = await sequelize.query(
      `SELECT opening_times AS "openingTimes", sampled_at AS "sampledAt"
       FROM park_operating_snapshots
       WHERE provider = :provider
         AND external_park_id = :externalParkId
         AND opening_times IS NOT NULL
         AND split_part(trim(opening_times->>'date'), 'T', 1) = :localDate
       ORDER BY sampled_at DESC
       LIMIT 1`,
      {
        replacements: { provider, externalParkId, localDate },
        type: QueryTypes.SELECT,
      }
    );
    const row = rows[0];
    if (!row || !row.openingTimes) return null;
    return { openingTimes: row.openingTimes, sampledAt: row.sampledAt };
  }

  /**
   * Same as findLatestOpeningRowForLocalDate but ignores provider (any ingest).
   * @param {string} externalParkId
   * @param {string} localDate
   */
  async findLatestOpeningRowForLocalDateAnyProvider(externalParkId, localDate) {
    const rows = await sequelize.query(
      `SELECT opening_times AS "openingTimes", sampled_at AS "sampledAt", provider AS "provider"
       FROM park_operating_snapshots
       WHERE external_park_id = :externalParkId
         AND opening_times IS NOT NULL
         AND split_part(trim(opening_times->>'date'), 'T', 1) = :localDate
       ORDER BY sampled_at DESC
       LIMIT 1`,
      {
        replacements: { externalParkId, localDate },
        type: QueryTypes.SELECT,
      }
    );
    const row = rows[0];
    if (!row || !row.openingTimes) return null;
    return { openingTimes: row.openingTimes, sampledAt: row.sampledAt, provider: row.provider };
  }

  /**
   * Try several ThemeParks keys (UUID vs slug) — snapshots often use API park id while DB row may only expose slug.
   * @param {string} provider
   * @param {string[]} externalParkIds
   * @param {string} localDate - YYYY-MM-DD
   * @returns {Promise<{ openingTimes: object, sampledAt: Date, scheduleProvider: string } | null>}
   */
  async findLatestOpeningRowForLocalDateFirstMatching(provider, externalParkIds, localDate) {
    const ids = [
      ...new Set(
        (externalParkIds || [])
          .filter((x) => x != null && String(x).trim() !== '')
          .map((x) => String(x).trim())
      ),
    ];
    if (!ids.length || !localDate) return null;

    for (const externalParkId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const row = await this.findLatestOpeningRowForLocalDate(provider, externalParkId, localDate);
      if (row) return { ...row, scheduleProvider: provider };
    }
    for (const externalParkId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const row = await this.findLatestOpeningRowForLocalDateAnyProvider(externalParkId, localDate);
      if (row)
        return {
          openingTimes: row.openingTimes,
          sampledAt: row.sampledAt,
          scheduleProvider: row.provider,
        };
    }
    return null;
  }
}

module.exports = { ParkOperatingSnapshotRepository };
