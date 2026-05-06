/** Minutes — ride wait at or above this triggers a crowd follow-up if newly crossed. */
const longWaitThresholdMinutes = 90;

/** Substrings in weather `condition` that should create WEATHER_IMPACT + recommendations */
const weatherImpactConditions = [
  'RAIN',
  'STORM',
  'HAIL',
  'SNOW',
  'THUNDER',
  'FOG',
  'WIND',
  'ICE',
  'HEAT',
  'COLD',
  'EXTREME',
];

module.exports = { longWaitThresholdMinutes, weatherImpactConditions };
