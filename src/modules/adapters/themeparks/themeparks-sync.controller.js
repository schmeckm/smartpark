const { asyncHandler } = require('../../../utils/async-handler');
const { AppError } = require('../../../utils/app-error');
const env = require('../../../config/env');
const { syncParkFromThemeParks, syncParkFromThemeParksFromSettings } = require('./themeparks-sync.service');

const postSyncThemeParksPark = asyncHandler(async (req, res) => {
  const { sequelize, ...models } = require('../../../models');
  const parkExternalId = req.params.parkId;
  const data = await syncParkFromThemeParks(sequelize, models, parkExternalId);
  res.status(200).json({ success: true, data });
});

/** Uses externalParkData.selectedPark from Integration settings (no UUID in URL). */
const postSyncThemeParksFromSettings = asyncHandler(async (_req, res) => {
  const { sequelize, ...models } = require('../../../models');
  const data = await syncParkFromThemeParksFromSettings(sequelize, models);
  res.status(200).json({ success: true, data });
});

/** Re-run adapter discovery scan from persisted ThemeParks-linked park_assets (manual inbox refresh). */
const postScanThemeparksDiscoveryFromSettings = asyncHandler(async (_req, res) => {
  if (!env.adapterDiscoverySpyEnabled) {
    throw new AppError('Adapter discovery is disabled (ADAPTER_DISCOVERY_SPY_ENABLED=false)', 403, {
      code: 'FEATURE_DISABLED',
    });
  }
  const { getThemeparksWikiParkIdFromIntegrationSettings } = require('../../../services/themeparks-wiki-selected-park.service');
  const { AssetsRepository } = require('../../assets/assets.repository');
  const { scanParkAssetsForAdapterDiscovery } = require('../../../services/uns-spy-adapter-discovery.service');
  const externalParkId = await getThemeparksWikiParkIdFromIntegrationSettings();
  if (!externalParkId) {
    throw new AppError('No ThemeParks.wiki park selected in Integration settings', 422, { code: 'NO_SELECTED_PARK' });
  }
  const models = require('../../../models');
  const repo = new AssetsRepository(models);
  const park = await repo.findParkByExternal(externalParkId, 'THEMEPARKS_WIKI');
  if (!park) {
    throw new AppError('Internal park not found for selected ThemeParks park (run sync first)', 404, {
      code: 'PARK_NOT_FOUND',
    });
  }
  const data = await scanParkAssetsForAdapterDiscovery(park.id, externalParkId);
  res.status(200).json({ success: true, data });
});

module.exports = {
  postSyncThemeParksPark,
  postSyncThemeParksFromSettings,
  postScanThemeparksDiscoveryFromSettings,
};
