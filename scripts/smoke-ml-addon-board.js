/**
 * Smoke: Add-on Board summary + ML park aggregate (DB only, no HTTP auth).
 * Run: npm run smoke:ml-addon-board
 * Env: INTERNAL_PARK_ID (optional UUID of parks.id)
 */
/* eslint-disable no-console */
const path = require('node:path');
require('dotenv').config();
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize } = require(path.join(__dirname, '..', 'src', 'db', 'sequelize'));
const { Park } = require(path.join(__dirname, '..', 'src', 'models'));
const { AddonBoardService } = require(path.join(__dirname, '..', 'src', 'services', 'addon-board.service'));
const { getParkBoardMlAggregates } = require(path.join(
  __dirname,
  '..',
  'src',
  'services',
  'ml',
  'addon-board-ml-bridge.service'
));

async function main() {
  await sequelize.authenticate();
  const parkId = process.env.INTERNAL_PARK_ID || null;
  const park = parkId
    ? await Park.findByPk(parkId, { attributes: ['id', 'name'] })
    : await Park.findOne({ order: [['createdAt', 'ASC']], attributes: ['id', 'name'] });
  if (!park) {
    console.warn('SKIP: no park');
    process.exit(0);
  }
  const id = String(park.id);
  const board = new AddonBoardService();
  const summary = await board.getParkSummary(id);
  const mlAgg = await getParkBoardMlAggregates(id, { limit: 40, criticalAtMinutes: 55 });
  console.log('OK addon-board summary keys:', Object.keys(summary).sort().join(', '));
  console.log('OK ml aggregate:', {
    parkDemandForecastIndex: mlAgg.parkDemandForecastIndex,
    averageForecastWaitTime60: mlAgg.averageForecastWaitTime60,
    forecastCriticalRides: mlAgg.forecastCriticalRides,
    ridesConsidered: mlAgg.ridesConsidered,
    cacheHit: mlAgg.cacheHit === true,
  });
  const mlAgg2 = await getParkBoardMlAggregates(id, { limit: 40 });
  console.log('OK second call cacheHit:', mlAgg2.cacheHit === true);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
