const { AppSettingRepository } = require('../repositories/app-setting.repository');

const SELECTED_PARK_KEY = 'externalParkData.selectedPark';

/**
 * ThemeParks.wiki park entity id saved by the admin Integration settings UI (`externalParkId`).
 * Used as fallback when the `themeparks_wiki` adapter package `configJson.parkId` is empty.
 */
async function getThemeparksWikiParkIdFromIntegrationSettings() {
  const repo = new AppSettingRepository();
  const park = await repo.getValue(SELECTED_PARK_KEY, null);
  if (!park || typeof park !== 'object') return null;
  if (String(park.provider || '').toLowerCase() !== 'themeparks_wiki') return null;
  const id = park.externalParkId;
  if (id == null || String(id).trim() === '') return null;
  return String(id).trim();
}

module.exports = { getThemeparksWikiParkIdFromIntegrationSettings };
