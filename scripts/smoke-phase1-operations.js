/**
 * Phase 1 hardening smoke: full UNS registry mirror + canonical Sparkplug metric rows + Add-on Board rideOperations shape.
 * Run: npm run smoke:phase1-operations
 * Requires: Postgres (same as other smokes), migrations applied.
 */
/* eslint-disable no-console */
require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const {
  sequelize,
  Park,
  SparkplugMetricDefinition,
  SignalCatalog,
  REGISTRY_SOURCE_MIRRORED,
} = require(path.join(__dirname, '..', 'src', 'models'));
const {
  unsRegistryMirrorService,
} = require(path.join(__dirname, '..', 'src', 'services', 'uns-registry-mirror.service'));
const { AddonBoardService } = require(path.join(__dirname, '..', 'src', 'services', 'addon-board.service'));

const CANONICAL_METRIC = 'actual_dispatch_interval_sec';

async function main() {
  await sequelize.authenticate();

  await unsRegistryMirrorService.syncFromLegacy();

  const spark = await SparkplugMetricDefinition.findOne({
    where: { registrySource: REGISTRY_SOURCE_MIRRORED, metricName: CANONICAL_METRIC },
  });
  if (!spark) {
    throw new Error(`Missing mirrored SparkplugMetricDefinition: ${CANONICAL_METRIC}`);
  }

  const sig = await SignalCatalog.findOne({
    where: { registrySource: REGISTRY_SOURCE_MIRRORED, signalCode: CANONICAL_METRIC },
  });
  if (!sig) {
    throw new Error(`Missing mirrored SignalCatalog row: ${CANONICAL_METRIC}`);
  }

  const parkId =
    process.env.INTERNAL_PARK_ID ||
    (await Park.findOne({ attributes: ['id'], order: [['name', 'ASC']] }))?.id;
  if (!parkId) {
    console.warn('SKIP: no park — mirror checks only');
    console.log('OK phase1-operations smoke (mirror only)', { canonicalMetric: CANONICAL_METRIC });
    await sequelize.close();
    process.exit(0);
    return;
  }

  const addon = new AddonBoardService();
  const { rides } = await addon.getParkRides(parkId);
  const first = rides?.[0];
  if (!first) {
    console.warn('WARN: no rides in park — skipping rideOperations assertion');
  } else {
    const detail = await addon.getRideDetail(parkId, first.rideId);
    const ro = detail?.swdec?.rideOperations;
    if (!ro || typeof ro !== 'object') {
      throw new Error('Expected rideDetail.swdec.rideOperations object');
    }
    for (const k of [
      'operationalStatus',
      'operationalStatusSource',
      'unplannedDowntimeMinutesToday',
      'plannedDowntimeMinutesToday',
      'availabilityPercentToday',
      'mttrMinutes',
      'mtbfHours',
      'reliabilityLookbackDays',
      'dispatchIntervalTargetSec',
      'dispatchIntervalActualSec',
      'dispatchEfficiencyPercent',
      'dispatchSource',
    ]) {
      if (!(k in ro)) throw new Error(`rideOperations missing key: ${k}`);
    }
    const wx = detail.swdec?.weatherContext;
    if (wx == null || typeof wx !== 'object') {
      throw new Error('Expected rideDetail.swdec.weatherContext object (may be sparse)');
    }
    if (!('dataLayers' in wx)) throw new Error('weatherContext missing dataLayers');

    const cx = detail.swdec?.crossAssetContext;
    if (!cx || typeof cx !== 'object') throw new Error('Expected rideDetail.swdec.crossAssetContext object');
    for (const k of ['schemaVersion', 'zoneVenues', 'hints']) {
      if (!(k in cx)) throw new Error(`crossAssetContext missing key: ${k}`);
    }
    const zv = cx.zoneVenues;
    if (!zv || typeof zv !== 'object') throw new Error('crossAssetContext.zoneVenues must be object');
    for (const k of ['restaurants', 'shops', 'shows']) {
      if (!Number.isFinite(Number(zv[k]))) throw new Error(`crossAssetContext.zoneVenues.${k} must be numeric`);
    }
    if (!Array.isArray(cx.hints)) throw new Error('crossAssetContext.hints must be array');
  }

  console.log('OK phase1-operations smoke', {
    parkId: String(parkId),
    canonicalMetric: CANONICAL_METRIC,
  });
  await sequelize.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
