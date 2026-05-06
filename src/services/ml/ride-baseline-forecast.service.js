/**
 * Rule-based wait-time forecast when no trained model is available.
 */
const { snapshotToFeatureMap } = require('./ride-feature-vector.util');

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * @param {object} snapPlain - latest ride snapshot plain or feature map-like object
 * @param {{ horizons?: number[] }} [opts]
 */
function baselineForecastFromSnapshot(snapPlain, opts = {}) {
  const horizons = Array.isArray(opts.horizons) && opts.horizons.length ? opts.horizons.map(Number) : [15, 30, 60];
  const f = snapshotToFeatureMap(snapPlain);
  const cur = f.current_wait_time;
  const trend = f.wait_time_trend_30m;
  const congestion = f.zone_congestion_score / 100;
  const rain = f.rain_mm;
  const hol = f.school_holiday ? 3 : 0;

  const predictions = [];
  for (const h of horizons) {
    let value = cur;
    if (h <= 15) {
      value = cur + trend * (h / 30);
    } else if (h <= 30) {
      value = cur + trend;
    } else {
      const rainBump = rain > 0.5 ? rain * 1.2 : rain * 0.3;
      const congBump = congestion * 8;
      const recovery = Math.min(15, Math.max(0, -trend) * 0.15);
      value = cur + trend + hol * 0.4 + rainBump + congBump - recovery;
    }
    value = clamp(value, 0, 240);
    predictions.push({
      horizonMinutes: h,
      value: Math.round(value * 10) / 10,
      unit: 'min',
      source: 'BASELINE',
    });
  }

  return {
    predictionMode: 'BASELINE_ONLY',
    modelId: null,
    confidence: 0.45,
    predictions,
    topFactors: buildTopFactorsFromBaseline(f),
  };
}

function buildTopFactorsFromBaseline(f) {
  const pairs = [
    ['current_wait_time', Math.abs(f.current_wait_time)],
    ['wait_time_trend_30m', Math.abs(f.wait_time_trend_30m)],
    ['zone_congestion_score', Math.abs(f.zone_congestion_score)],
    ['rain_mm', Math.abs(f.rain_mm)],
    ['school_holiday', f.school_holiday ? 50 : 0],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs.slice(0, 4).map(([feature], idx) => ({
    feature,
    impact: idx === 0 ? 'HIGH' : idx <= 2 ? 'MEDIUM' : 'LOW',
  }));
}

module.exports = { baselineForecastFromSnapshot, clamp };
