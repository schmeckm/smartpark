const { Op } = require('sequelize');

class AssetsRepository {
  /**
   * @param {Record<string, import('sequelize').Model>} m
   */
  constructor(m) {
    this.m = m;
  }

  assetIncludes() {
    const {
      AssetType,
      EntityTypeTemplate,
      Park,
      ParkZone,
      RideMasterData,
      ShowMasterData,
      RestaurantMasterData,
      ShopMasterData,
      AssetTarget,
      AssetRuntimeOverride,
    } = this.m;
    return [
      { model: AssetType, as: 'assetType', required: true },
      { model: EntityTypeTemplate, as: 'entityTemplate', required: false },
      { model: Park, as: 'park', required: true },
      { model: ParkZone, as: 'zone', required: false },
      { model: RideMasterData, as: 'rideMaster', required: false },
      { model: ShowMasterData, as: 'showMaster', required: false },
      { model: RestaurantMasterData, as: 'restaurantMaster', required: false },
      { model: ShopMasterData, as: 'shopMaster', required: false },
      { model: AssetTarget, as: 'assetTarget', required: false },
      { model: AssetRuntimeOverride, as: 'runtimeOverrides', required: false },
    ];
  }

  findAssetTypeByCode(code) {
    return this.m.AssetType.findOne({ where: { code: String(code).toUpperCase() } });
  }

  listParks() {
    return this.m.Park.findAll({ order: [['name', 'ASC']] });
  }

  findParkByExternal(externalEntityId, externalSource = 'THEMEPARKS_WIKI') {
    return this.m.Park.findOne({
      where: { externalEntityId: String(externalEntityId), externalSource: String(externalSource) },
    });
  }

  mergeProviderSnapshot(prev, raw) {
    if (!raw || typeof raw !== 'object') return prev && typeof prev === 'object' ? prev : {};
    const base = prev && typeof prev === 'object' ? { ...prev } : {};
    base.lastEntity = raw;
    return base;
  }

  /**
   * Keep slugs unique inside one park to satisfy park_assets_park_slug_uq.
   */
  buildUniqueSlug(baseSlug, extId) {
    const base = String(baseSlug || 'asset')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 140) || 'asset';
    const suffix =
      String(extId || '')
        .trim()
        .replace(/[^a-z0-9]+/gi, '')
        .toLowerCase()
        .slice(-12) || 'ext';
    return `${base}-${suffix}`.slice(0, 160);
  }

  async findOrCreateParkFromExternal({ name, slug, externalEntityId, externalSource, timezone, rawParkJson }) {
    const existing = await this.findParkByExternal(externalEntityId, externalSource);
    if (existing) {
      const locks = new Set(
        existing.enrichment && typeof existing.enrichment === 'object' && Array.isArray(existing.enrichment.locks?.park)
          ? existing.enrichment.locks.park
          : []
      );
      const upd = {
        providerSnapshot: this.mergeProviderSnapshot(existing.providerSnapshot, rawParkJson),
        lastSyncedAt: new Date(),
      };
      if (!locks.has('name')) upd.name = name;
      if (!locks.has('slug')) upd.slug = slug;
      if (!locks.has('timezone')) upd.timezone = timezone ?? null;
      await existing.update(upd);
      return existing;
    }
    return this.m.Park.create({
      name,
      slug,
      externalEntityId: String(externalEntityId),
      externalSource: String(externalSource),
      timezone: timezone || null,
      providerSnapshot: this.mergeProviderSnapshot({}, rawParkJson),
      lastSyncedAt: new Date(),
    });
  }

  async findOrCreateDefaultZone(parkId, parkSlug) {
    const slug = `${parkSlug}-default`.slice(0, 128);
    const [zone] = await this.m.ParkZone.findOrCreate({
      where: { parkId, slug },
      defaults: { name: 'General', slug, sortOrder: 0 },
    });
    return zone;
  }

  findAssetByExternal(externalSource, externalEntityId, transaction) {
    return this.m.ParkAsset.findOne({
      where: { externalSource: String(externalSource), externalEntityId: String(externalEntityId) },
      transaction,
    });
  }

  findAssetsByExternalIds(externalSource, externalEntityIds, transaction) {
    const ids = [...new Set(externalEntityIds.map((id) => String(id)).filter(Boolean))];
    if (!ids.length) return Promise.resolve([]);
    return this.m.ParkAsset.findAll({
      where: {
        externalSource: String(externalSource),
        externalEntityId: { [Op.in]: ids },
      },
      transaction,
    });
  }

  listAssets({ parkId, assetTypeCode, limit = 500, offset = 0 } = {}) {
    const where = {};
    if (parkId) where.parkId = parkId;
    const include = this.assetIncludes();
    if (assetTypeCode) {
      include[0].where = { code: String(assetTypeCode).toUpperCase() };
      include[0].required = true;
    }
    return this.m.ParkAsset.findAll({
      where,
      include,
      order: [['name', 'ASC']],
      limit: Math.min(Number(limit) || 500, 2000),
      offset: Number(offset) || 0,
    });
  }

  getAssetById(assetId) {
    return this.m.ParkAsset.findByPk(assetId, { include: this.assetIncludes() });
  }

  /**
   * Upsert park_asset by external id (canonical → persistence).
   */
  async upsertAsset(
    {
      parkId,
      zoneId,
      parentAssetId,
      assetTypeId,
      name,
      shortName,
      slug,
      description,
      zoneLabel,
      latitude,
      longitude,
      status,
      activeFlag,
      openingFlag,
      externalSource,
      externalEntityId,
      externalParentId,
      /** Latest ThemeParks (or other) entity JSON — stored under provider_snapshot.lastEntity */
      rawEntity,
    },
    transaction
  ) {
    const extId = String(externalEntityId);
    const src = String(externalSource);
    const existing = await this.m.ParkAsset.findOne({
      where: { externalSource: src, externalEntityId: extId },
      transaction,
    });
    const payload = {
      parkId,
      zoneId: zoneId || null,
      parentAssetId: parentAssetId || null,
      assetTypeId,
      name,
      shortName: shortName != null ? String(shortName).slice(0, 120) : null,
      slug: slug.slice(0, 160),
      description: description != null ? String(description) : null,
      zoneLabel: zoneLabel != null ? String(zoneLabel).slice(0, 200) : null,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      status: status || 'UNKNOWN',
      activeFlag: activeFlag !== false,
      openingFlag: openingFlag === true || openingFlag === false ? openingFlag : null,
      externalSource: src,
      externalEntityId: extId,
      externalParentId: externalParentId != null ? String(externalParentId) : null,
    };
    let asset;
    if (existing) {
      if (existing.syncManaged === false) {
        await existing.update(
          {
            providerSnapshot: this.mergeProviderSnapshot(existing.providerSnapshot, rawEntity),
            lastSyncedAt: new Date(),
          },
          { transaction }
        );
        asset = existing;
      } else {
        const locks = new Set(
          existing.enrichment && typeof existing.enrichment === 'object' && Array.isArray(existing.enrichment.locks?.asset)
            ? existing.enrichment.locks.asset
            : []
        );
        const merged = { ...payload };
        for (const k of locks) {
          if (Object.prototype.hasOwnProperty.call(merged, k)) delete merged[k];
        }
        await existing.update(
          {
            ...merged,
            providerSnapshot: this.mergeProviderSnapshot(existing.providerSnapshot, rawEntity),
            lastSyncedAt: new Date(),
          },
          { transaction }
        );
        asset = existing;
      }
    } else {
      const createPayload = {
        ...payload,
        providerSnapshot: this.mergeProviderSnapshot({}, rawEntity),
        lastSyncedAt: new Date(),
      };
      try {
        asset = await this.m.ParkAsset.create(createPayload, { transaction });
      } catch (e) {
        const isSlugConflict =
          e &&
          typeof e === 'object' &&
          Array.isArray(e.errors) &&
          e.errors.some(
            (er) =>
              String(er?.path || '').toLowerCase() === 'slug' ||
              String(er?.message || '').toLowerCase().includes('park_slug_uq')
          );
        if (!isSlugConflict) throw e;
        createPayload.slug = this.buildUniqueSlug(createPayload.slug, extId);
        asset = await this.m.ParkAsset.create(createPayload, { transaction });
      }
    }
    await this.m.AssetTarget.findOrCreate({
      where: { assetId: asset.assetId },
      defaults: { assetId: asset.assetId },
      transaction,
    });
    return asset;
  }

  async ensureSpecialization(asset, typeCode, transaction) {
    const code = String(typeCode).toUpperCase();
    const id = asset.assetId;
    if (code === 'RIDE') {
      const [row, created] = await this.m.RideMasterData.findOrCreate({
        where: { assetId: id },
        defaults: { assetId: id },
        transaction,
      });
      if (created) {
        const tpl = await this.m.RideTemplate.findOne({
          where: { code: 'RIDE_DEFAULT' },
          transaction,
        });
        if (tpl && tpl.defaultProfile && typeof tpl.defaultProfile === 'object') {
          await this.updateRideMasterFromProfile(id, tpl.defaultProfile, transaction);
        }
      }
      return row;
    }
    if (code === 'SHOW') {
      const [row] = await this.m.ShowMasterData.findOrCreate({
        where: { assetId: id },
        defaults: { assetId: id },
        transaction,
      });
      return row;
    }
    if (code === 'RESTAURANT') {
      const [row] = await this.m.RestaurantMasterData.findOrCreate({
        where: { assetId: id },
        defaults: { assetId: id },
        transaction,
      });
      return row;
    }
    if (code === 'SHOP') {
      const [row] = await this.m.ShopMasterData.findOrCreate({
        where: { assetId: id },
        defaults: { assetId: id },
        transaction,
      });
      return row;
    }
    return null;
  }

  createObservation({ assetId, metricCode, metricValue, unit, timestamp, source }, transaction) {
    return this.m.AssetObservation.create(
      {
        assetId,
        metricCode,
        metricValue: String(metricValue),
        unit: unit || null,
        timestamp: timestamp || new Date(),
        source: source || 'THEMEPARKS_WIKI',
      },
      { transaction }
    );
  }

  listRecentObservations({ parkId, limit = 200, metricCode } = {}) {
    const whereObs = {};
    if (metricCode) whereObs.metricCode = metricCode;
    const assetWhere = {};
    if (parkId) assetWhere.parkId = parkId;
    return this.m.AssetObservation.findAll({
      where: whereObs,
      include: [
        {
          model: this.m.ParkAsset,
          as: 'asset',
          required: true,
          where: assetWhere,
          include: [{ model: this.m.Park, as: 'park', required: false }],
        },
      ],
      order: [['timestamp', 'DESC']],
      limit: Math.min(Number(limit) || 200, 2000),
    });
  }

  listRideMasterRows(parkId, limit = 1000) {
    return this.m.ParkAsset.findAll({
      where: parkId ? { parkId } : {},
      include: [
        { model: this.m.AssetType, as: 'assetType', required: true, where: { code: 'RIDE' } },
        { model: this.m.RideMasterData, as: 'rideMaster', required: true },
        { model: this.m.Park, as: 'park', required: false },
        { model: this.m.ParkZone, as: 'zone', required: false },
        { model: this.m.AssetTarget, as: 'assetTarget', required: false },
      ],
      order: [['name', 'ASC']],
      limit: Math.min(Number(limit) || 1000, 5000),
    });
  }

  findRideTemplateByCode(code) {
    return this.m.RideTemplate.findOne({ where: { code: String(code) } });
  }

  /**
   * Apply ride template / inbound profile: ride_* columns + nested `targets` → asset_targets.
   * @param {string} assetId
   * @param {Record<string, unknown>} profile
   * @param {import('sequelize').Transaction} [transaction]
   */
  async updateRideMasterFromProfile(assetId, profile, transaction) {
    const row = await this.m.RideMasterData.findByPk(assetId, { transaction });
    if (!row) return null;
    const patch = {};
    const map = [
      ['capacityPph', 'capacityPph'],
      ['theoreticalCapacityPph', 'theoreticalCapacityPph'],
      ['dispatchIntervalSec', 'dispatchIntervalSec'],
      ['cycleTimeSec', 'cycleTimeSec'],
      ['plannedCycleTimeSec', 'plannedCycleTimeSec'],
      ['opcReferenceCycleTimeSec', 'opcReferenceCycleTimeSec'],
      ['maxQueueGuests', 'maxQueueGuests'],
      ['maxSpeedKmh', 'maxSpeedKmh'],
      ['structureHeightM', 'structureHeightM'],
      ['trackLengthM', 'trackLengthM'],
      ['virtualLineEnabled', 'virtualLineEnabled'],
      ['seatsPerCycle', 'seatsPerCycle'],
      ['trainsCount', 'trainsCount'],
      ['rideCategory', 'rideCategory'],
      ['minStaff', 'minStaff'],
      ['normalStaff', 'normalStaff'],
      ['peakStaff', 'peakStaff'],
      ['operatorMin', 'minStaff'],
      ['operatorStandard', 'normalStaff'],
      ['operatorPeak', 'peakStaff'],
      ['weatherSensitive', 'weatherSensitive'],
      ['rainSensitive', 'rainSensitive'],
      ['windLimitKmh', 'windLimitKmh'],
      ['minHeightCm', 'minHeightCm'],
      ['maxHeightCm', 'maxHeightCm'],
      ['thrillLevel', 'thrillLevel'],
      ['manufacturer', 'manufacturer'],
      ['buildYear', 'buildYear'],
      ['plcType', 'plcType'],
      ['maintenanceClass', 'maintenanceClass'],
    ];
    for (const [k, attr] of map) {
      if (profile[k] !== undefined) patch[attr] = profile[k];
    }
    await row.update(patch, { transaction });

    const targets = profile.targets && typeof profile.targets === 'object' ? profile.targets : null;
    if (targets) {
      await this.upsertAssetTargetsFromProfile(assetId, targets, transaction);
    } else if (profile.targetAvailabilityPct != null || profile.targetOeePct != null) {
      await this.upsertAssetTargetsFromProfile(
        assetId,
        {
          targetAvailabilityPct: profile.targetAvailabilityPct ?? profile.targetAvailability,
          targetWaitTimeMin: profile.targetWaitTimeMin,
          targetUtilizationPct: profile.targetUtilizationPct,
          targetOeePct: profile.targetOeePct ?? profile.targetOee,
          revenuePriority: profile.revenuePriority,
        },
        transaction
      );
    }
    return row;
  }

  /**
   * @param {string} assetId
   * @param {Record<string, unknown>} t
   * @param {import('sequelize').Transaction} [transaction]
   */
  async upsertAssetTargetsFromProfile(assetId, t, transaction) {
    const [at] = await this.m.AssetTarget.findOrCreate({
      where: { assetId },
      defaults: { assetId },
      transaction,
    });
    const patch = {};
    if (t.targetAvailabilityPct != null) patch.targetAvailabilityPct = t.targetAvailabilityPct;
    if (t.targetWaitTimeMin != null) patch.targetWaitTimeMin = t.targetWaitTimeMin;
    if (t.targetUtilizationPct != null) patch.targetUtilizationPct = t.targetUtilizationPct;
    if (t.targetOeePct != null) patch.targetOeePct = t.targetOeePct;
    if (t.revenuePriority != null) patch.revenuePriority = String(t.revenuePriority).slice(0, 32);
    if (Object.keys(patch).length) await at.update(patch, { transaction });
    return at;
  }

  assertAssetExists(assetId, transaction) {
    return this.m.ParkAsset.findByPk(assetId, { attributes: ['assetId'], transaction });
  }

  listRuntimeOverrides(assetId) {
    return this.m.AssetRuntimeOverride.findAll({
      where: { assetId },
      order: [
        ['active', 'DESC'],
        ['validFrom', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
  }

  createRuntimeOverride({ assetId, payload, validFrom, validTo, active }, transaction) {
    return this.m.AssetRuntimeOverride.create(
      {
        assetId,
        payload: payload && typeof payload === 'object' ? payload : {},
        validFrom: validFrom || null,
        validTo: validTo || null,
        active: active !== false,
      },
      { transaction }
    );
  }

  async getRuntimeOverrideForAsset(overrideId, assetId, transaction) {
    return this.m.AssetRuntimeOverride.findOne({
      where: { id: overrideId, assetId },
      transaction,
    });
  }

  async updateRuntimeOverride(overrideId, assetId, patch, transaction) {
    const row = await this.getRuntimeOverrideForAsset(overrideId, assetId, transaction);
    if (!row) return null;
    const allowed = {};
    if (patch.payload !== undefined) {
      allowed.payload = patch.payload && typeof patch.payload === 'object' ? patch.payload : {};
    }
    if (patch.validFrom !== undefined) allowed.validFrom = patch.validFrom || null;
    if (patch.validTo !== undefined) allowed.validTo = patch.validTo || null;
    if (patch.active !== undefined) allowed.active = Boolean(patch.active);
    await row.update(allowed, { transaction });
    return row;
  }
}

module.exports = { AssetsRepository };
