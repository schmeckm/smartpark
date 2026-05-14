'use strict';

/**
 * Deterministic DB fixtures for ML forecast observability / accuracy e2e (governed snapshots only).
 * Does not touch MQTT/UNS. Caller must run cleanup after tests.
 */

const { Op } = require('sequelize');
const {
  sequelize,
  Park,
  ParkAsset,
  AssetType,
  RideFeatureSnapshot,
  MlPredictionResult,
  MlPredictionTrace,
  MlForecastAccuracyLog,
} = require('../../models');

/** Stable UUIDs — unlikely to collide with demo seeds; cleanup removes rows by these ids. */
const FIXTURE_PARK_ID = 'e2ef0001-0000-4000-8000-000000000001';
const FIXTURE_ASSET_ID = 'e2ef0002-0000-4000-8000-000000000002';
const FIXTURE_PARK_SLUG = 'ml-obs-e2e-fixture-park';
const FIXTURE_ASSET_SLUG = 'ml-obs-e2e-fixture-ride';
const FIXTURE_PROVIDER = 'ml_obs_e2e_fixture';
const FIXTURE_EXT_PARK = 'ml_obs_e2e_ext_park';
const FIXTURE_EXT_RIDE = 'ml_obs_e2e_ext_ride';

/** Round UTC time down to a 5-minute bucket (feature store convention). */
function roundDownTo5MinutesUtc(d = new Date()) {
  const x = new Date(d);
  x.setUTCSeconds(0, 0);
  const min = x.getUTCMinutes();
  x.setUTCMinutes(min - (min % 5), 0, 0);
  return x;
}

function baseRideSnapshotRow(snapshotAt, overrides = {}) {
  const xExtras = {
    zone_congestion_score: 50,
    ride_status_num: 1,
    wait_time_trend_30m: 0,
    ...(typeof overrides.xFeaturesExtras === 'object' && overrides.xFeaturesExtras ? overrides.xFeaturesExtras : {}),
  };
  return {
    provider: FIXTURE_PROVIDER,
    externalParkId: FIXTURE_EXT_PARK,
    externalEntityId: FIXTURE_EXT_RIDE,
    entityType: 'RIDE',
    snapshotAt,
    waitTime: overrides.waitTime ?? null,
    status: overrides.status ?? 'OPEN',
    isOpen: overrides.isOpen ?? true,
    hasWaitSample: true,
    internalParkId: FIXTURE_PARK_ID,
    internalAssetId: FIXTURE_ASSET_ID,
    currentWaitTimeMin: overrides.currentWaitTimeMin ?? 20,
    previousWaitTimeMin: overrides.previousWaitTimeMin ?? 20,
    waitTimeDelta5m: overrides.waitTimeDelta5m ?? 0,
    rollingAvgWait15m: overrides.rollingAvgWait15m ?? 20,
    rollingAvgWait60m: overrides.rollingAvgWait60m ?? 20,
    parkCrowdIndex: overrides.parkCrowdIndex ?? 70,
    temperatureC: overrides.temperatureC ?? 18,
    precipitationMm: overrides.precipitationMm ?? 0,
    isSchoolHoliday: overrides.isSchoolHoliday ?? false,
    isPublicHoliday: overrides.isPublicHoliday ?? false,
    trafficIndex: overrides.trafficIndex ?? 0.5,
    completenessScore: overrides.completenessScore ?? 0.95,
    xFeaturesExtras: xExtras,
    rainSensitive: true,
    weatherSensitive: true,
    specialEventFlag: false,
    parkIsOpen: overrides.parkIsOpen ?? true,
    rideIsOpen: overrides.rideIsOpen ?? true,
    forecastEligible: overrides.forecastEligible ?? true,
    trainingEligible: overrides.trainingEligible ?? true,
    accuracyEligible: overrides.accuracyEligible ?? true,
    dataQualityReason: overrides.dataQualityReason ?? null,
  };
}

/**
 * Remove any prior fixture rows (idempotent).
 */
async function cleanupMlForecastObservabilityFixture() {
  await MlForecastAccuracyLog.destroy({
    where: { parkId: FIXTURE_PARK_ID },
  }).catch(() => {});
  await MlPredictionResult.destroy({
    where: { parkId: FIXTURE_PARK_ID },
  }).catch(() => {});
  await MlPredictionTrace.destroy({
    where: { parkId: FIXTURE_PARK_ID },
  }).catch(() => {});
  await RideFeatureSnapshot.destroy({
    where: {
      [Op.or]: [
        { internalParkId: FIXTURE_PARK_ID, internalAssetId: FIXTURE_ASSET_ID },
        { provider: FIXTURE_PROVIDER, externalEntityId: FIXTURE_EXT_RIDE },
      ],
    },
  }).catch(() => {});
  await ParkAsset.destroy({ where: { assetId: FIXTURE_ASSET_ID } }).catch(() => {});
  await Park.destroy({ where: { id: FIXTURE_PARK_ID } }).catch(() => {});
}

/**
 * Inserts park, RIDE asset, and the **current** governed snapshot (wait 20, crowd 70, zone congestion 50, …).
 * Does not insert the horizon “actual” snapshot — call {@link insertAccuracyActualSnapshot} after predict + backdate.
 *
 * @returns {Promise<{ parkId: string, rideId: string }>}
 */
async function seedMlForecastObservabilityFixture() {
  await cleanupMlForecastObservabilityFixture();

  const rideType = await AssetType.findOne({ where: { code: 'RIDE' } });
  if (!rideType) {
    throw new Error('asset_types row with code RIDE is required for fixture');
  }

  await Park.create({
    id: FIXTURE_PARK_ID,
    name: 'ML Observability E2E Fixture Park',
    slug: FIXTURE_PARK_SLUG,
    timezone: 'UTC',
    externalSource: 'FIXTURE',
    externalEntityId: null,
  });

  await ParkAsset.create({
    assetId: FIXTURE_ASSET_ID,
    parkId: FIXTURE_PARK_ID,
    zoneId: null,
    assetTypeId: rideType.id,
    name: 'ML Observability E2E Ride',
    slug: FIXTURE_ASSET_SLUG,
    status: 'ACTIVE',
    externalSource: 'FIXTURE',
    externalEntityId: FIXTURE_EXT_RIDE,
  });

  const snapNow = roundDownTo5MinutesUtc(new Date());
  await RideFeatureSnapshot.create(baseRideSnapshotRow(snapNow));

  return { parkId: FIXTURE_PARK_ID, rideId: FIXTURE_ASSET_ID };
}

/**
 * Backdate prediction results so horizon-minutes eligibility passes without waiting real time.
 * @param {string} predictionId
 * @param {string} parkId
 * @param {number} minutesAgoBase — `created_at = now - minutesAgoBase`
 */
async function backdateMlPredictionResultsForAccuracy(predictionId, parkId, minutesAgoBase = 40) {
  const past = new Date(Date.now() - minutesAgoBase * 60 * 1000);
  await sequelize.query(
    `UPDATE ml_prediction_results SET created_at = :past, updated_at = :past
     WHERE prediction_id = :predictionId AND park_id = :parkId`,
    { replacements: { past, predictionId, parkId } }
  );
  await sequelize.query(
    `UPDATE ml_prediction_traces SET created_at = :past, updated_at = :past
     WHERE prediction_id = :predictionId AND park_id = :parkId`,
    { replacements: { past, predictionId, parkId } }
  );
}

/**
 * Insert governed snapshot at `nominalEvalAt` (±7.5 min window used by accuracy service) with actual wait 25.
 * @param {Date} nominalEvalAt — typically backdated `created_at + 15 minutes`
 */
async function insertAccuracyActualSnapshot(nominalEvalAt) {
  await RideFeatureSnapshot.create(
    baseRideSnapshotRow(nominalEvalAt, {
      currentWaitTimeMin: 25,
      waitTime: 25,
      rollingAvgWait15m: 25,
      rollingAvgWait60m: 25,
      parkCrowdIndex: 70,
    })
  );
}

/**
 * Remove accuracy logs for one prediction so KPI catch-up can re-evaluate after inserting actual snapshot.
 */
async function deleteAccuracyLogsForPrediction(predictionId) {
  await MlForecastAccuracyLog.destroy({ where: { predictionId } });
}

module.exports = {
  FIXTURE_PARK_ID,
  FIXTURE_ASSET_ID,
  FIXTURE_PROVIDER,
  roundDownTo5MinutesUtc,
  cleanupMlForecastObservabilityFixture,
  seedMlForecastObservabilityFixture,
  backdateMlPredictionResultsForAccuracy,
  insertAccuracyActualSnapshot,
  deleteAccuracyLogsForPrediction,
};
