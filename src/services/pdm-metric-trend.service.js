'use strict';

const { linearRegressionSlope, coefficientOfVariation, spikeCount, valuesFromPoints } = require('../utils/pdm-metric-trend.utils');

/**
 * @param {string} metricName
 * @returns {'higher_is_worse'|'lower_is_worse'|'stability'}
 */
function metricPolarity(metricName) {
  const m = String(metricName || '').toLowerCase();
  if (m.includes('flow') || m.includes('pressure') && m.includes('hydraulic')) return 'lower_is_worse';
  if (m.includes('rpm') || m.includes('vibration') || m.includes('power') || m.includes('temp')) return 'higher_is_worse';
  return 'higher_is_worse';
}

/**
 * @param {Array<{ t: string; v: number }>} points chronological
 * @param {string} metricName
 * @returns {{
 *   metricName: string;
 *   trend: 'STABLE' | 'IMPROVING' | 'DECLINING' | 'UNSTABLE';
 *   slopePerStep: number;
 *   coefficientOfVariation: number | null;
 *   spikeCount: number;
 *   degradationTrend: boolean;
 *   instability: boolean;
 * }}
 */
function analyzeMetricTrendFromSamples(metricName, points) {
  const arr = Array.isArray(points) ? points : [];
  const values = valuesFromPoints(arr);
  const n = values.length;
  if (n < 4) {
    return {
      metricName,
      trend: 'STABLE',
      slopePerStep: 0,
      coefficientOfVariation: null,
      spikeCount: 0,
      degradationTrend: false,
      instability: false,
    };
  }

  const slope = linearRegressionSlope(values);
  const cv = coefficientOfVariation(values);
  const spikes = spikeCount(values);
  const pol = metricPolarity(metricName);
  const instability = (cv != null && cv > 0.08) || spikes >= 3;

  let degradationTrend = false;
  if (pol === 'higher_is_worse' && slope > 0.002 * (Math.abs(values[values.length - 1]) + 1)) degradationTrend = true;
  if (pol === 'lower_is_worse' && slope < -0.002 * (Math.abs(values[values.length - 1]) + 1)) degradationTrend = true;

  let trend = 'STABLE';
  if (instability) trend = 'UNSTABLE';
  else if (degradationTrend) trend = 'DECLINING';
  else if (
    (pol === 'higher_is_worse' && slope < -0.001 * (Math.abs(values[values.length - 1]) + 1)) ||
    (pol === 'lower_is_worse' && slope > 0.001 * (Math.abs(values[values.length - 1]) + 1))
  ) {
    trend = 'IMPROVING';
  }

  return {
    metricName,
    trend,
    slopePerStep: Math.round(slope * 1e6) / 1e6,
    coefficientOfVariation: cv != null ? Math.round(cv * 1e4) / 1e4 : null,
    spikeCount: spikes,
    degradationTrend,
    instability,
  };
}

module.exports = {
  metricPolarity,
  analyzeMetricTrendFromSamples,
};
