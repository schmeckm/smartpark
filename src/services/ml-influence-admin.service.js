const { Op } = require('sequelize');
const {
  sequelize,
  MlGlobalFactor,
  MlParkFactor,
  MlProfile,
  AssetMlProfileAssignment,
  AssetMlOverride,
  Park,
  ParkAsset,
  ParkFeatureSnapshot,
  RideFeatureSnapshot,
} = require('../models');
const { resolveEffectiveMlConfig } = require('./ml-effective-config.service');

class MlInfluenceAdminService {
  async listGlobalFactors() {
    return MlGlobalFactor.findAll({ order: [['factorCode', 'ASC']] });
  }

  async createGlobalFactor(payload) {
    return MlGlobalFactor.create(payload);
  }

  async updateGlobalFactor(id, patch) {
    const row = await MlGlobalFactor.findByPk(id);
    if (!row) return null;
    await row.update(patch);
    return row;
  }

  async deleteGlobalFactor(id) {
    const row = await MlGlobalFactor.findByPk(id);
    if (!row) return false;
    await row.destroy();
    return true;
  }

  async listParkFactors(parkId) {
    return MlParkFactor.findAll({ where: { parkId }, order: [['factorCode', 'ASC']] });
  }

  async patchParkFactors(parkId, items) {
    const out = [];
    for (const it of items || []) {
      const code = it.factorCode || it.factor_code;
      if (!code) continue;
      // eslint-disable-next-line no-await-in-loop
      const [row] = await MlParkFactor.findOrCreate({
        where: { parkId, factorCode: code },
        defaults: {
          parkId,
          factorCode: code,
          activeFlag: it.activeFlag !== false,
          sourceType: it.sourceType || 'MANUAL',
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await row.update({
        weightOverride: it.weightOverride ?? it.weight_override ?? row.weightOverride,
        currentValue: it.currentValue ?? it.current_value ?? row.currentValue,
        activeFlag: it.activeFlag ?? it.active_flag ?? row.activeFlag,
        notes: it.notes ?? row.notes,
        sourceType: it.sourceType ?? it.source_type ?? row.sourceType,
      });
      out.push(row);
    }
    return out;
  }

  async listMlProfiles(query = {}) {
    const where = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.activeFlag !== undefined && query.activeFlag !== null && query.activeFlag !== '') {
      where.activeFlag = query.activeFlag === true || query.activeFlag === 'true';
    }
    const rawSearch = typeof query.search === 'string' ? query.search.trim() : '';
    if (rawSearch) {
      const safe = rawSearch.replace(/[%_\\]/g, '');
      if (safe) {
        where[Op.or] = [
          { profileCode: { [Op.iLike]: `%${safe}%` } },
          { profileName: { [Op.iLike]: `%${safe}%` } },
        ];
      }
    }
    return MlProfile.findAll({ where, order: [['profileCode', 'ASC']] });
  }

  async createMlProfile(payload) {
    return MlProfile.create(payload);
  }

  async updateMlProfile(id, patch) {
    const row = await MlProfile.findByPk(id);
    if (!row) return null;
    await row.update(patch);
    return row;
  }

  /** Soft-delete: keep row for assignments/history; forecast resolves active profiles only. */
  async deactivateMlProfile(id) {
    const row = await MlProfile.findByPk(id);
    if (!row) return null;
    await row.update({ activeFlag: false });
    return row;
  }

  async putAssetMlProfile(assetId, { profileId, assignedBy } = {}) {
    await AssetMlProfileAssignment.update(
      { activeFlag: false },
      { where: { assetId, activeFlag: true } }
    );
    return AssetMlProfileAssignment.create({
      assetId,
      profileId,
      activeFlag: true,
      assignedBy: assignedBy || null,
      validFrom: null,
      validTo: null,
    });
  }

  async patchAssetMlOverrides(assetId, ops) {
    const out = [];
    for (const op of ops || []) {
      const key = op.overrideKey || op.override_key;
      if (!key) continue;
      // eslint-disable-next-line no-await-in-loop
      const [row] = await AssetMlOverride.findOrCreate({
        where: { assetId, overrideKey: key },
        defaults: {
          assetId,
          overrideKey: key,
          overrideValueJson: op.overrideValueJson ?? op.override_value_json ?? {},
          overrideReason: op.overrideReason ?? op.override_reason ?? '',
          activeFlag: op.activeFlag !== false,
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await row.update({
        overrideValueJson: op.overrideValueJson ?? op.override_value_json ?? row.overrideValueJson,
        overrideReason: op.overrideReason ?? op.override_reason ?? row.overrideReason,
        activeFlag: op.activeFlag ?? op.active_flag ?? row.activeFlag,
      });
      out.push(row);
    }
    return out;
  }

  async getFeatureStoreMonitor(parkId) {
    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });
    const ext = park?.externalEntityId ? String(park.externalEntityId) : null;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 30 * 60 * 1000);

    const parkSnapWhere = ext
      ? { [Op.or]: [{ internalParkId: parkId }, { externalParkId: ext, provider: 'themeparks_wiki' }] }
      : { internalParkId: parkId };
    const rideSnapWhere = ext
      ? { [Op.or]: [{ internalParkId: parkId }, { externalParkId: ext, provider: 'themeparks_wiki' }] }
      : { internalParkId: parkId };

    const latestPark = await ParkFeatureSnapshot.findOne({
      where: parkSnapWhere,
      order: [['snapshotAt', 'DESC']],
    });
    const latestRide = await RideFeatureSnapshot.findOne({
      where: rideSnapWhere,
      order: [['snapshotAt', 'DESC']],
    });

    const pj = latestPark ? latestPark.get({ plain: true }) : null;
    const missingWeather = !pj || (pj.temperatureC == null && pj.precipitationMm == null);
    const missingHoliday =
      !pj || (pj.isPublicHoliday == null && pj.isSchoolHoliday == null && !pj.holidayName && !pj.holiday_name);
    const missingTraffic = !pj || pj.trafficIndex == null;

    const rideAssets = await ParkAsset.count({ where: { parkId } });
    let withAssignment = 0;
    try {
      const [r] = await sequelize.query(
        `SELECT COUNT(DISTINCT a.asset_id)::int AS c
         FROM asset_ml_profile_assignments a
         INNER JOIN park_assets pa ON pa.asset_id = a.asset_id
         WHERE a.active_flag = true AND pa.park_id = :parkId`,
        { replacements: { parkId } }
      );
      withAssignment = r?.[0]?.c != null ? Number(r[0].c) : 0;
    } catch {
      withAssignment = 0;
    }

    const freshnessOk = latestPark && new Date(latestPark.snapshotAt) >= staleBefore;

    return {
      parkId,
      latestParkSnapshotAt: latestPark?.snapshotAt || null,
      latestRideSnapshotAt: latestRide?.snapshotAt || null,
      snapshotFreshnessOk: Boolean(freshnessOk),
      missingWeather,
      missingHoliday,
      missingTraffic,
      rideAssets,
      assetsWithMlProfileApprox: withAssignment,
      assetsWithoutProfileApprox: Math.max(0, rideAssets - withAssignment),
    };
  }
}

module.exports = { MlInfluenceAdminService, resolveEffectiveMlConfig };
