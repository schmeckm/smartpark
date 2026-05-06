/**
 * Default UNS metric leaves per platform asset type (`asset_types.code`, lowercased).
 * Master Data is the source of truth; UNS materialization uses these when expanding assets.
 */
const DEFAULT_METRICS_BY_ASSET_TYPE_CODE = {
  rides: ['status', 'queue_time', 'throughput', 'downtime'],
  ride: ['status', 'queue_time', 'throughput', 'downtime'],
  attractions: ['status', 'queue_time', 'throughput', 'downtime'],
  shows: ['status', 'next_show_time', 'fill_rate'],
  show: ['status', 'next_show_time', 'fill_rate'],
  restaurants: ['status', 'queue_time', 'service_capacity', 'wait_time'],
  restaurant: ['status', 'queue_time', 'service_capacity', 'wait_time'],
  shops: ['status', 'visitor_count', 'revenue'],
  shop: ['status', 'visitor_count', 'revenue'],
};

function getDefaultMetricsForAssetTypeCode(code) {
  const c = String(code || '')
    .trim()
    .toLowerCase();
  if (DEFAULT_METRICS_BY_ASSET_TYPE_CODE[c]) return [...DEFAULT_METRICS_BY_ASSET_TYPE_CODE[c]];
  return ['status', 'queue_time'];
}

module.exports = {
  DEFAULT_METRICS_BY_ASSET_TYPE_CODE,
  getDefaultMetricsForAssetTypeCode,
};
