const { Op } = require('sequelize');
const { AppError } = require('../utils/app-error');
const {
  Park,
  ParkAsset,
  AssetType,
  RideWaitTimeSample,
  WeatherObservation,
  ParkCalendarContext,
} = require('../models');

class TimeseriesService {
  async getCurrentRideWaitsForPark({ parkId, hours = 24 }) {
    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
    if (!park) {
      throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
    }
    const assets = await ParkAsset.findAll({
      where: { parkId },
      include: [{ model: AssetType, as: 'assetType', required: true, where: { code: 'RIDE' } }],
      attributes: ['assetId', 'name', 'externalEntityId'],
      order: [['name', 'ASC']],
      limit: 2000,
    });
    const assetById = new Map(assets.map((a) => [String(a.assetId), a]));
    const assetIdList = assets.map((a) => a.assetId);
    const extToAssetId = new Map(
      assets
        .filter((a) => a.externalEntityId != null)
        .map((a) => [String(a.externalEntityId), String(a.assetId)])
    );
    const since = new Date(Date.now() - Math.max(1, Number(hours) || 24) * 60 * 60 * 1000);
    const extParkId = park.externalEntityId ? String(park.externalEntityId) : null;

    const where = {
      sampledAt: { [Op.gte]: since },
      [Op.or]: [{ parkAssetId: { [Op.in]: assetIdList } }],
    };
    if (extParkId && extToAssetId.size) {
      where[Op.or].push({
        externalParkId: extParkId,
        externalEntityId: { [Op.in]: [...extToAssetId.keys()] },
      });
    }

    const samples = await RideWaitTimeSample.findAll({
      where,
      order: [['sampledAt', 'DESC']],
      attributes: ['parkAssetId', 'externalEntityId', 'waitTime', 'sampledAt', 'status', 'isOpen'],
      limit: 30000,
    });
    const latestByAsset = new Map();
    for (const row of samples) {
      const j = row.get({ plain: true });
      let aid = j.parkAssetId ? String(j.parkAssetId) : null;
      if (!aid && j.externalEntityId != null) aid = extToAssetId.get(String(j.externalEntityId)) || null;
      if (!aid || latestByAsset.has(aid)) continue;
      latestByAsset.set(aid, {
        assetId: aid,
        waitTime: j.waitTime == null ? null : Number(j.waitTime),
        sampledAt: j.sampledAt,
        status: j.status || null,
        isOpen: j.isOpen == null ? null : Boolean(j.isOpen),
      });
    }

    return assets.map((a) => ({
      assetId: String(a.assetId),
      name: a.name,
      externalEntityId: a.externalEntityId ? String(a.externalEntityId) : null,
      current: latestByAsset.get(String(a.assetId)) || null,
    }));
  }

  /**
   * @param {object} opts
   * @param {string} opts.parkId - platform park UUID (X-Park-Id)
   * @param {string} opts.assetId - park_assets.asset_id
   * @param {Date} opts.from
   * @param {Date} opts.to
   * @param {boolean} [opts.includeContext]
   */
  async getRideWaitTimeseries({ parkId, assetId, from, to, includeContext = true }) {
    const asset = await ParkAsset.findOne({
      where: { assetId, parkId },
      include: [{ model: Park, as: 'park', required: true }],
    });
    if (!asset) {
      throw new AppError('Ride asset not found for this park', 404, { code: 'ASSET_NOT_FOUND' });
    }

    const park = asset.park;
    const extParkId = park.externalEntityId;
    const extAssetId = asset.externalEntityId;

    const orConds = [{ parkAssetId: assetId }];
    if (extParkId && extAssetId) {
      orConds.push({
        externalParkId: String(extParkId),
        externalEntityId: String(extAssetId),
      });
    }

    const waitSamples = await RideWaitTimeSample.findAll({
      where: {
        sampledAt: { [Op.between]: [from, to] },
        [Op.or]: orConds,
      },
      order: [['sampledAt', 'ASC']],
      limit: 8000,
      attributes: [
        'id',
        'waitTime',
        'sampledAt',
        'provider',
        'status',
        'isOpen',
        'parkAssetId',
        'externalEntityId',
        'externalParkId',
      ],
    });

    let weather = [];
    let calendar = [];
    if (includeContext) {
      weather = await WeatherObservation.findAll({
        where: {
          observedAt: { [Op.between]: [from, to] },
          [Op.or]: [{ internalParkId: parkId }, { parkId: String(parkId) }],
        },
        order: [['observedAt', 'ASC']],
        limit: 3000,
        attributes: [
          'id',
          'condition',
          'temperatureC',
          'rainMm',
          'windKmh',
          'source',
          'parkId',
          'internalParkId',
          'observedAt',
        ],
      });

      calendar = await ParkCalendarContext.findAll({
        where: {
          parkId,
          contextDate: { [Op.between]: [this._dateOnly(from), this._dateOnly(to)] },
        },
        order: [['contextDate', 'ASC']],
        limit: 400,
      });
    }

    return {
      parkId,
      assetId,
      assetName: asset.name,
      range: { from: from.toISOString(), to: to.toISOString() },
      waitSamples: waitSamples.map((r) => {
        const j = r.get({ plain: true });
        return {
          id: j.id,
          waitTime: j.waitTime,
          sampledAt: j.sampledAt,
          provider: j.provider,
          status: j.status,
          isOpen: j.isOpen,
          parkAssetId: j.parkAssetId,
          externalEntityId: j.externalEntityId,
          externalParkId: j.externalParkId,
        };
      }),
      weather: weather.map((r) => {
        const j = r.get({ plain: true });
        return {
          id: j.id,
          condition: j.condition,
          temperatureC: j.temperatureC,
          rainMm: j.rainMm,
          windKmh: j.windKmh,
          source: j.source,
          parkId: j.parkId,
          internalParkId: j.internalParkId,
          observedAt: j.observedAt,
        };
      }),
      calendar: calendar.map((r) => {
        const j = r.get({ plain: true });
        return {
          id: j.id,
          contextDate: j.contextDate,
          isPublicHoliday: j.isPublicHoliday,
          isSchoolBreak: j.isSchoolBreak,
          holidayName: j.holidayName,
          regionCode: j.regionCode,
          source: j.source,
          extra: j.extra,
        };
      }),
    };
  }

  _dateOnly(d) {
    const x = new Date(d);
    return x.toISOString().slice(0, 10);
  }

  async upsertParkCalendarRow({ parkId, contextDate, patch }) {
    const [row, created] = await ParkCalendarContext.findOrCreate({
      where: { parkId, contextDate },
      defaults: {
        parkId,
        contextDate,
        isPublicHoliday: patch.isPublicHoliday ?? false,
        isSchoolBreak: patch.isSchoolBreak ?? false,
        holidayName: patch.holidayName || null,
        regionCode: patch.regionCode || null,
        source: patch.source || 'manual',
        extra: patch.extra && typeof patch.extra === 'object' ? patch.extra : {},
      },
    });
    if (!created) {
      await row.update({
        isPublicHoliday: patch.isPublicHoliday ?? row.isPublicHoliday,
        isSchoolBreak: patch.isSchoolBreak ?? row.isSchoolBreak,
        holidayName: patch.holidayName != null ? patch.holidayName || null : row.holidayName,
        regionCode: patch.regionCode != null ? patch.regionCode || null : row.regionCode,
        source: patch.source || row.source,
        extra:
          patch.extra && typeof patch.extra === 'object' ? { ...(row.extra || {}), ...patch.extra } : row.extra,
      });
    }
    return row;
  }
}

module.exports = { TimeseriesService };
