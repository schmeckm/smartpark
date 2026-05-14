/**
 * Builds 5m UTC feature snapshots from canonical ride messages (all providers with
 * WAIT_TIME_UPDATED / ENTITY_STATUS_UPDATED); SoR for ML/X rows at bucket granularity.
 * @see docs/adr/0001-forecast-architecture.md
 */
const { Op, Sequelize, QueryTypes } = require('sequelize');
const {
  sequelize,
  Park,
  CanonicalInboundMessage,
  ParkFeatureSnapshot,
  RideFeatureSnapshot,
  ForecastTrainingLabel,
} = require('../models');
const {
  buildParkXLayer,
  buildRideXLayer,
  resolveParkByExternalExternalId,
  findPreviousRideSnapshot,
} = require('./ai-snapshot-x-context.service');
const { loadActiveProfileCodesByAssetIds } = require('./ml-effective-config.service');
const { ParkOperatingSnapshotRepository } = require('../repositories/park-operating-snapshot.repository');
const { evaluateScheduledOperatingHours } = require('../utils/operating-hours-eval.util');
const { syntheticScheduleFromParkEnrichment } = require('../utils/master-operating-hours.util');
const { snapshotEligibilityDefaultsForSchedule } = require('../utils/ride-snapshot-eligibility.util');
const { coerceNumericWaitMinutes } = require('../utils/canonical-wait-payload.util');

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bucket5m(dateValue) {
  const ts = new Date(dateValue).getTime();
  const floored = Math.floor(ts / (5 * 60 * 1000)) * 5 * 60 * 1000;
  return new Date(floored);
}

/** `themeparks_wiki:<parkId>` or `<provider>:<externalParkId>` where park id may contain ':' */
function splitParkCompoundKey(parkKey) {
  const idx = parkKey.indexOf(':');
  if (idx <= 0) return { provider: parkKey, externalParkId: '' };
  return { provider: parkKey.slice(0, idx), externalParkId: parkKey.slice(idx + 1) };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/** Sequelize model attribute names (camelCase) — required for Postgres ON CONFLICT update list. */
const RIDE_SNAPSHOT_UPDATE_FIELDS = [
  'entityType',
  'waitTime',
  'status',
  'isOpen',
  'hasWaitSample',
  'internalParkId',
  'internalAssetId',
  'currentWaitTimeMin',
  'previousWaitTimeMin',
  'waitTimeDelta5m',
  'rollingAvgWait15m',
  'rollingAvgWait60m',
  'theoreticalCapacityPph',
  'staffingGapNormal',
  'rainSensitive',
  'weatherSensitive',
  'parkCrowdIndex',
  'temperatureC',
  'precipitationMm',
  'isPublicHoliday',
  'isSchoolHoliday',
  'trafficIndex',
  'specialEventFlag',
  'completenessScore',
  'xFeaturesExtras',
  'rainProbabilityPercent',
  'inboundEtaMin',
  'capacityFactor',
  'mlProfileCode',
  'weatherSensitivityScore',
  'queueElasticityScore',
  'staffDependencyScore',
  'targetWaitTime15m',
  'targetWaitTime60m',
  'parkIsOpen',
  'rideIsOpen',
  'forecastEligible',
  'trainingEligible',
  'accuracyEligible',
  'dataQualityReason',
  'updatedAt',
];

/** ForecastTrainingLabel upsert columns (camelCase model attrs). */
const FORECAST_LABEL_UPDATE_FIELDS = ['labelWait', 'labelCrowdIndex', 'labelOpenRatio', 'labelQuality', 'updatedAt'];

const PARK_SNAPSHOT_UPDATE_FIELDS = [
  'timezone',
  'ridesReporting',
  'ridesOpen',
  'openRatio',
  'avgWait',
  'medianWait',
  'p90Wait',
  'maxWait',
  'closedRatio',
  'sourceMessageCount',
  'internalParkId',
  'localDate',
  'localHour',
  'dayOfWeek',
  'month',
  'season',
  'isWeekend',
  'isPublicHoliday',
  'isSchoolHoliday',
  'holidayName',
  'temperatureC',
  'precipitationMm',
  'windSpeedKmh',
  'weatherCondition',
  'trafficIndex',
  'specialEventFlag',
  'parkCrowdIndex',
  'completenessScore',
  'targetWaitTime15m',
  'targetWaitTime60m',
  'targetWaitTime120m',
  'xFeaturesExtras',
  'rainProbabilityPercent',
  'inboundEtaMin',
  'visitorsEstimate',
  'openRidesCount',
  'closedRidesCount',
  'crowdIndex',
  'withinScheduledOperatingHours',
  'scheduledOperatingSnapshotAt',
  'updatedAt',
];

/**
 * @param {object} meta - parkXByKey entry with park, parkX, externalParkId, provider
 * @param {Date} bucketUtc
 * @param {import('../repositories/park-operating-snapshot.repository').ParkOperatingSnapshotRepository} operatingRepo
 */
async function computeParkScheduledOperatingForMeta(meta, bucketUtc, operatingRepo) {
  let withinScheduledOperatingHours = null;
  let scheduledOperatingSnapshotAt = null;
  const { externalParkId, parkX } = meta;
  if (parkX.localDate && meta.park) {
    const parkPlain =
      meta.park && typeof meta.park.get === 'function' ? meta.park.get({ plain: true }) : meta.park || {};
    const masterSchedule = syntheticScheduleFromParkEnrichment(parkPlain.enrichment, parkX.localDate);
    if (masterSchedule) {
      const ev = evaluateScheduledOperatingHours(masterSchedule, bucketUtc, parkX.timezone);
      withinScheduledOperatingHours = ev.within;
      scheduledOperatingSnapshotAt = parkPlain.updatedAt ? new Date(parkPlain.updatedAt) : null;
    } else {
      const extCandidates = [
        ...new Set(
          [externalParkId, parkPlain.externalEntityId, parkPlain.slug]
            .filter((x) => x != null && String(x).trim() !== '')
            .map((x) => String(x).trim())
        ),
      ];
      if (extCandidates.length) {
        const opRow = await operatingRepo.findLatestOpeningRowForLocalDateFirstMatching(
          meta.provider || 'themeparks_wiki',
          extCandidates,
          parkX.localDate
        );
        if (opRow) {
          const ev = evaluateScheduledOperatingHours(opRow.openingTimes, bucketUtc, parkX.timezone);
          withinScheduledOperatingHours = ev.within;
          scheduledOperatingSnapshotAt = opRow.sampledAt || null;
        }
      }
    }
  }
  return { withinScheduledOperatingHours, scheduledOperatingSnapshotAt };
}

class AiFeatureStoreService {
  async buildSnapshots({ now = new Date() } = {}) {
    const operatingRepo = new ParkOperatingSnapshotRepository();
    const bucket = bucket5m(now);
    const since = new Date(bucket.getTime() - 10 * 60 * 1000);
    const rows = await CanonicalInboundMessage.findAll({
      where: {
        messageType: { [Op.in]: ['WAIT_TIME_UPDATED', 'ENTITY_STATUS_UPDATED'] },
        occurredAt: { [Op.gte]: since, [Op.lte]: now },
        externalParkId: { [Op.ne]: null },
      },
      order: [['occurredAt', 'DESC']],
      limit: 5000,
    });

    const latestByEntity = new Map();
    for (const row of rows) {
      const entityId = row.externalEntityId;
      if (!entityId) continue;
      const key = `${row.provider}:${row.externalParkId}:${entityId}`;
      if (!latestByEntity.has(key)) latestByEntity.set(key, row);
    }

    const byPark = new Map();
    for (const row of latestByEntity.values()) {
      const payload = row.payload || {};
      const waitTime = coerceNumericWaitMinutes(payload.waitTime);
      const isOpen = typeof payload.isOpen === 'boolean' ? payload.isOpen : null;
      const parkKey = `${row.provider}:${row.externalParkId}`;
      if (!byPark.has(parkKey)) byPark.set(parkKey, []);
      byPark.get(parkKey).push({ waitTime, isOpen });
    }

    const parkModelByExt = new Map();
    const parkXByKey = new Map();
    const parkKeys = [...byPark.keys()];
    for (const parkKey of parkKeys) {
      const { provider, externalParkId } = splitParkCompoundKey(parkKey);
      let park = parkModelByExt.get(externalParkId);
      if (!parkModelByExt.has(externalParkId)) {
        // eslint-disable-next-line no-await-in-loop
        park = await resolveParkByExternalExternalId(externalParkId);
        parkModelByExt.set(externalParkId, park);
      }
      const samples = byPark.get(parkKey);
      const ridesReporting = samples.length;
      const waits = samples.map((s) => s.waitTime).filter((v) => v != null);
      const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
      // eslint-disable-next-line no-await-in-loop
      const parkX = await buildParkXLayer({
        park,
        bucketUtc: bucket,
        externalParkId,
        avgWait,
        ridesReporting,
      });
      parkXByKey.set(parkKey, { provider, externalParkId, park, parkX, samples, avgWait, ridesReporting });
    }

    /** Parks with adapter-ingested weather/calendar but maybe no ThemeParks wait samples this bucket. */
    const sinceAdapterCtx = new Date(bucket.getTime() - 48 * 60 * 60 * 1000);
    const extraParkIds = new Set();
    const wxParkRows = await sequelize.query(
      `SELECT DISTINCT internal_park_id AS id FROM weather_observations WHERE internal_park_id IS NOT NULL AND observed_at >= :since`,
      { replacements: { since: sinceAdapterCtx }, type: QueryTypes.SELECT }
    );
    for (const r of wxParkRows) {
      if (r && r.id) extraParkIds.add(String(r.id));
    }
    const calParkRows = await sequelize.query(
      `SELECT DISTINCT park_id AS id FROM park_calendar_context WHERE updated_at >= :since`,
      { replacements: { since: sinceAdapterCtx }, type: QueryTypes.SELECT }
    );
    for (const r of calParkRows) {
      if (r && r.id) extraParkIds.add(String(r.id));
    }
    for (const pid of extraParkIds) {
      // Must include enrichment (defaultOperatingHours) and masterProfile so scheduled-hours
      // evaluation can prefer MASTER_DATA over ThemeParks snapshots (otherwise PARK_CLOSED drift).
      const park = await Park.findByPk(pid, {
        attributes: ['id', 'externalEntityId', 'slug', 'timezone', 'name', 'enrichment', 'masterProfile', 'updatedAt'],
      });
      if (!park) continue;
      const ext =
        park.externalEntityId != null && String(park.externalEntityId).trim() !== ''
          ? String(park.externalEntityId).trim()
          : String(park.slug || '').trim();
      if (!ext) continue;
      const parkKey = `themeparks_wiki:${ext}`;
      if (parkXByKey.has(parkKey)) continue;
      const parkX = await buildParkXLayer({
        park,
        bucketUtc: bucket,
        externalParkId: ext,
        avgWait: null,
        ridesReporting: 0,
      });
      parkXByKey.set(parkKey, {
        provider: 'themeparks_wiki',
        externalParkId: ext,
        park,
        parkX,
        samples: [],
        avgWait: null,
        ridesReporting: 0,
      });
    }

    for (const meta of parkXByKey.values()) {
      // eslint-disable-next-line no-await-in-loop
      const sched = await computeParkScheduledOperatingForMeta(meta, bucket, operatingRepo);
      meta.withinScheduledOperatingHours = sched.withinScheduledOperatingHours;
      meta.scheduledOperatingSnapshotAt = sched.scheduledOperatingSnapshotAt;
    }

    const rideItems = [];
    for (const row of latestByEntity.values()) {
      const payload = row.payload || {};
      const waitTime = coerceNumericWaitMinutes(payload.waitTime);
      const status = typeof payload.status === 'string' ? payload.status : null;
      const isOpen = typeof payload.isOpen === 'boolean' ? payload.isOpen : null;
      const entityType =
        typeof payload.entityType === 'string'
          ? payload.entityType
          : row.entityType || 'ATTRACTION';
      const parkKey = `${row.provider}:${row.externalParkId}`;
      const meta = parkXByKey.get(parkKey);
      const park = meta?.park || parkModelByExt.get(row.externalParkId) || null;
      const parkX = meta?.parkX || null;
      const elig = snapshotEligibilityDefaultsForSchedule({
        withinScheduledOperatingHours: meta?.withinScheduledOperatingHours ?? null,
        rideIsOpen: isOpen,
        ridePayloadWait: waitTime,
      });
      // eslint-disable-next-line no-await-in-loop
      const prevRow = await findPreviousRideSnapshot(row.provider, row.externalParkId, row.externalEntityId, bucket);
      const prevPlain = prevRow ? prevRow.get({ plain: true }) : null;
      // eslint-disable-next-line no-await-in-loop
      const rideX = await buildRideXLayer({
        provider: row.provider,
        park,
        bucketUtc: bucket,
        externalParkId: row.externalParkId,
        externalEntityId: row.externalEntityId,
        waitTime,
        parkX,
        previousRideSnapshotPlain: prevPlain,
      });

      rideItems.push({
        provider: row.provider,
        externalParkId: row.externalParkId,
        externalEntityId: row.externalEntityId,
        entityType,
        snapshotAt: bucket,
        waitTime,
        status,
        isOpen,
        hasWaitSample: rideX.currentWaitTimeMin != null,
        internalParkId: rideX.internalParkId,
        internalAssetId: rideX.internalAssetId,
        currentWaitTimeMin: rideX.currentWaitTimeMin,
        previousWaitTimeMin: rideX.previousWaitTimeMin,
        waitTimeDelta5m: rideX.waitTimeDelta5m,
        rollingAvgWait15m: rideX.rollingAvgWait15m,
        rollingAvgWait60m: rideX.rollingAvgWait60m,
        theoreticalCapacityPph: rideX.theoreticalCapacityPph,
        staffingGapNormal: rideX.staffingGapNormal,
        rainSensitive: rideX.rainSensitive,
        weatherSensitive: rideX.weatherSensitive,
        parkCrowdIndex: rideX.parkCrowdIndex,
        temperatureC: rideX.temperatureC,
        precipitationMm: rideX.precipitationMm,
        isPublicHoliday: rideX.isPublicHoliday,
        isSchoolHoliday: rideX.isSchoolHoliday,
        trafficIndex: rideX.trafficIndex,
        specialEventFlag: rideX.specialEventFlag,
        completenessScore: rideX.completenessScore,
        xFeaturesExtras: rideX.xFeaturesExtras,
        rainProbabilityPercent: null,
        inboundEtaMin: null,
        capacityFactor: null,
        mlProfileCode: null,
        weatherSensitivityScore: null,
        queueElasticityScore: null,
        staffDependencyScore: null,
        targetWaitTime15m: null,
        targetWaitTime60m: null,
        parkIsOpen: elig.parkIsOpen,
        rideIsOpen: elig.rideIsOpen,
        forecastEligible: elig.forecastEligible,
        trainingEligible: elig.trainingEligible,
        accuracyEligible: elig.accuracyEligible,
        dataQualityReason: elig.dataQualityReason,
      });
    }

    const assetIds = [...new Set(rideItems.map((r) => r.internalAssetId).filter(Boolean))];
    const profileMap = assetIds.length ? await loadActiveProfileCodesByAssetIds(assetIds) : new Map();
    for (const r of rideItems) {
      if (r.internalAssetId) {
        r.mlProfileCode = profileMap.get(r.internalAssetId) || null;
      }
    }

    if (rideItems.length) {
      await RideFeatureSnapshot.bulkCreate(rideItems, {
        /** Must match DB unique index `uq_ride_feature_snapshots_5m_provider_entity_snapshot` (Postgres ON CONFLICT). */
        conflictAttributes: ['provider', 'externalEntityId', 'snapshotAt'],
        updateOnDuplicate: RIDE_SNAPSHOT_UPDATE_FIELDS,
        /** Avoid RETURNING on large upserts; not needed for snapshot pipeline. */
        returning: false,
      });
    }

    const parkItems = [];
    for (const [, meta] of parkXByKey.entries()) {
      const { provider, externalParkId, samples, avgWait, ridesReporting, parkX } = meta;
      const ridesOpen = samples.filter((s) => s.isOpen === true).length;
      const ridesClosed = samples.filter((s) => s.isOpen === false).length;
      const waits = samples.map((s) => s.waitTime).filter((v) => v != null);

      const withinScheduledOperatingHours = meta.withinScheduledOperatingHours ?? null;
      const scheduledOperatingSnapshotAt = meta.scheduledOperatingSnapshotAt ?? null;

      parkItems.push({
        provider,
        externalParkId,
        snapshotAt: bucket,
        timezone: parkX.timezone,
        ridesReporting,
        ridesOpen,
        openRatio: ridesReporting ? ridesOpen / ridesReporting : 0,
        avgWait,
        medianWait: percentile(waits, 0.5),
        p90Wait: percentile(waits, 0.9),
        maxWait: waits.length ? Math.max(...waits) : null,
        closedRatio: ridesReporting ? samples.filter((s) => s.isOpen === false).length / ridesReporting : 0,
        sourceMessageCount: samples.length,
        internalParkId: parkX.internalParkId,
        localDate: parkX.localDate,
        localHour: parkX.localHour,
        dayOfWeek: parkX.dayOfWeek,
        month: parkX.month,
        season: parkX.season,
        isWeekend: parkX.isWeekend,
        isPublicHoliday: parkX.isPublicHoliday,
        isSchoolHoliday: parkX.isSchoolHoliday,
        holidayName: parkX.holidayName,
        temperatureC: parkX.temperatureC,
        precipitationMm: parkX.precipitationMm,
        windSpeedKmh: parkX.windSpeedKmh,
        weatherCondition: parkX.weatherCondition,
        trafficIndex: parkX.trafficIndex,
        specialEventFlag: parkX.specialEventFlag,
        parkCrowdIndex: parkX.parkCrowdIndex,
        completenessScore: parkX.completenessScore,
        targetWaitTime15m: parkX.targetWaitTime15m,
        targetWaitTime60m: parkX.targetWaitTime60m,
        targetWaitTime120m: parkX.targetWaitTime120m,
        xFeaturesExtras: parkX.xFeaturesExtras,
        rainProbabilityPercent: parkX.rainProbabilityPercent ?? null,
        inboundEtaMin: null,
        visitorsEstimate: null,
        openRidesCount: ridesOpen,
        closedRidesCount: ridesClosed,
        crowdIndex: parkX.parkCrowdIndex,
        withinScheduledOperatingHours,
        scheduledOperatingSnapshotAt,
      });
    }

    if (parkItems.length) {
      await ParkFeatureSnapshot.bulkCreate(parkItems, {
        /** Must match DB unique index `uq_park_feature_snapshots_5m_provider_park_snapshot`. */
        conflictAttributes: ['provider', 'externalParkId', 'snapshotAt'],
        updateOnDuplicate: PARK_SNAPSHOT_UPDATE_FIELDS,
        returning: false,
      });
    }

    return { parkSnapshots: parkItems.length, rideSnapshots: rideItems.length, bucket: bucket.toISOString() };
  }

  async buildLabels({ horizons = [15, 60] } = {}) {
    const now = new Date();
    const lookback = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const bases = await ParkFeatureSnapshot.findAll({
      where: { snapshotAt: { [Op.gte]: lookback } },
      order: [['snapshotAt', 'DESC']],
      limit: 1000,
    });
    const labels = [];
    for (const base of bases) {
      for (const horizonMinutes of horizons) {
        const targetAt = new Date(new Date(base.snapshotAt).getTime() + horizonMinutes * 60 * 1000);
        const target = await ParkFeatureSnapshot.findOne({
          where: {
            provider: base.provider,
            externalParkId: base.externalParkId,
            snapshotAt: {
              [Op.between]: [
                new Date(targetAt.getTime() - 5 * 60 * 1000),
                new Date(targetAt.getTime() + 5 * 60 * 1000),
              ],
            },
          },
          order: [['snapshotAt', 'ASC']],
        });
        if (!target) {
          labels.push({
            scope: 'PARK',
            provider: base.provider,
            externalParkId: base.externalParkId,
            externalEntityId: null,
            baseSnapshotAt: base.snapshotAt,
            horizonMinutes,
            labelQuality: 'MISSING',
          });
          continue;
        }
        const crowdIndex = Math.max(0, Math.min(100, Math.round(toNum(target.avgWait, 0))));
        labels.push({
          scope: 'PARK',
          provider: base.provider,
          externalParkId: base.externalParkId,
          externalEntityId: null,
          baseSnapshotAt: base.snapshotAt,
          horizonMinutes,
          labelWait: target.avgWait,
          labelCrowdIndex: crowdIndex,
          labelOpenRatio: target.openRatio,
          labelQuality: target.ridesReporting >= 5 ? 'OK' : 'SPARSE',
        });
      }
    }
    if (labels.length) {
      const parkLevel = labels.filter((l) => l.externalEntityId == null);
      const entityLevel = labels.filter((l) => l.externalEntityId != null && String(l.externalEntityId).trim() !== '');
      if (parkLevel.length) {
        await ForecastTrainingLabel.bulkCreate(parkLevel, {
          /** Partial unique: (provider, external_park_id, base_snapshot_at, horizon_minutes) WHERE external_entity_id IS NULL */
          conflictAttributes: ['provider', 'externalParkId', 'baseSnapshotAt', 'horizonMinutes'],
          /** DB column in predicate must match partial index (Sequelize maps camelCase keys wrong here). */
          conflictWhere: Sequelize.where(Sequelize.col('external_entity_id'), Op.is, null),
          updateOnDuplicate: FORECAST_LABEL_UPDATE_FIELDS,
          returning: false,
        });
      }
      if (entityLevel.length) {
        await ForecastTrainingLabel.bulkCreate(entityLevel, {
          /** Partial unique: (provider, external_park_id, external_entity_id, base_snapshot_at, horizon_minutes) WHERE external_entity_id IS NOT NULL */
          conflictAttributes: [
            'provider',
            'externalParkId',
            'externalEntityId',
            'baseSnapshotAt',
            'horizonMinutes',
          ],
          conflictWhere: Sequelize.where(Sequelize.col('external_entity_id'), Op.not, null),
          updateOnDuplicate: FORECAST_LABEL_UPDATE_FIELDS,
          returning: false,
        });
      }
    }
    return { labelsWritten: labels.length };
  }
}

module.exports = { AiFeatureStoreService };
