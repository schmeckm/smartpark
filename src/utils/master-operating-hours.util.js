/**
 * Park-level default operating hours curated in master data (`parks.enrichment.defaultOperatingHours`).
 * When enabled, overrides ThemeParks calendar snapshots for the same evaluation paths.
 *
 * @param {object|null|undefined} enrichment - `parks.enrichment` JSON
 * @param {string} localDate - `YYYY-MM-DD` in park-local calendar
 * @returns {object|null} ThemeParks-shaped `opening_times` row or null to fall back to adapter snapshots
 */
function syntheticScheduleFromParkEnrichment(enrichment, localDate) {
  const enr = enrichment && typeof enrichment === 'object' ? enrichment : {};
  const cfg = enr.defaultOperatingHours;
  if (!cfg || typeof cfg !== 'object' || cfg.useMasterOperatingHours !== true) {
    return null;
  }
  const type = cfg.type != null ? String(cfg.type).toUpperCase() : 'OPERATING';
  if (type !== 'OPERATING') {
    return { date: localDate, type, openingTime: null, closingTime: null };
  }
  const openingTime = cfg.openingTime != null ? String(cfg.openingTime).trim() : '';
  const closingTime = cfg.closingTime != null ? String(cfg.closingTime).trim() : '';
  if (!openingTime || !closingTime) {
    return null;
  }
  return { date: localDate, type: 'OPERATING', openingTime, closingTime };
}

module.exports = {
  syntheticScheduleFromParkEnrichment,
};
