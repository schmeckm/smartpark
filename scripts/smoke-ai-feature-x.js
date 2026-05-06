/**
 * Smoke: X-feature snapshots + forecast enrichment + training dataset shape (needs Postgres + migrations).
 * Run: npm run smoke:ai-feature-x
 */
/* eslint-disable no-console */
require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize } = require(path.join(__dirname, '..', 'src', 'db', 'sequelize'));
const { ParkFeatureSnapshot, RideFeatureSnapshot, Park } = require(path.join(__dirname, '..', 'src', 'models'));
const { applyXLayerToForecast } = require(path.join(__dirname, '..', 'src', 'services', 'ai-forecast-x-adjustments.service'));
const { buildRideQueueTrainingDataset } = require(path.join(__dirname, '..', 'src', 'services', 'ai-training-dataset.service'));

async function main() {
  await sequelize.authenticate();
  const park = await Park.findOne({ order: [['createdAt', 'ASC']] });
  if (!park) {
    console.warn('SKIP: no park row');
    process.exit(0);
  }

  const ps = await ParkFeatureSnapshot.findOne({ order: [['snapshotAt', 'DESC']] });
  if (!ps) {
    console.warn('SKIP: no park_feature_snapshots_5m (run AI snapshot ingest first)');
    process.exit(0);
  }
  const pj = ps.get({ plain: true });
  if (!Object.prototype.hasOwnProperty.call(pj, 'temperatureC')) {
    throw new Error('Park snapshot model missing temperatureC — run migration 20260502140000-feature-store-x-extensions');
  }
  console.log('OK park snapshot weather keys:', {
    temperatureC: pj.temperatureC,
    precipitationMm: pj.precipitationMm,
    isPublicHoliday: pj.isPublicHoliday,
  });

  const rs = await RideFeatureSnapshot.findOne({ order: [['snapshotAt', 'DESC']] });
  if (rs) {
    const rj = rs.get({ plain: true });
    console.log('OK ride snapshot inherited-style keys:', {
      temperatureC: rj.temperatureC,
      parkCrowdIndex: rj.parkCrowdIndex,
      isSchoolHoliday: rj.isSchoolHoliday,
    });
  } else {
    console.warn('SKIP: no ride_feature_snapshots_5m');
  }

  const out = applyXLayerToForecast(
    {
      externalParkId: 'x',
      provider: 'themeparks_wiki',
      forecast15Minutes: 30,
      forecast60Minutes: 40,
      confidence: 0.7,
      trend: 'STABLE',
    },
    {
      parkSnap: {
        precipitation_mm: 2,
        is_school_holiday: true,
        traffic_index: 0.8,
        completeness_score: 0.8,
      },
      rideSnap: {
        rain_sensitive: true,
        staffing_gap_normal: 3,
        theoretical_capacity_pph: 400,
        current_wait_time_min: 25,
        internal_asset_id: '00000000-0000-4000-8000-000000000001',
        completeness_score: 0.75,
      },
    }
  );
  if (!Array.isArray(out.topInfluencingFactors) || !out.topInfluencingFactors.length) {
    throw new Error('Expected topInfluencingFactors from X-layer');
  }
  console.log('OK forecast X-layer sample:', {
    forecast15Minutes: out.forecast15Minutes,
    forecast60Minutes: out.forecast60Minutes,
    forecastSource: out.forecastSource,
    factors: out.topInfluencingFactors.slice(0, 4),
  });

  const ds = await buildRideQueueTrainingDataset(park.id, { target: 'queue_time_15m', limit: 5 });
  if (!ds.rows) throw new Error('training dataset missing rows array');
  const row0 = ds.rows[0];
  if (row0 && row0.features && !('snapshotAt' in row0.features) && !('snapshot_at' in row0.features)) {
    console.warn('training row features shape unexpected', Object.keys(row0.features).slice(0, 5));
  }
  console.log('OK training dataset:', { horizonMinutes: ds.horizonMinutes, n: ds.rows.length, hasTargetKey: row0 && 'target' in row0 });

  await sequelize.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
