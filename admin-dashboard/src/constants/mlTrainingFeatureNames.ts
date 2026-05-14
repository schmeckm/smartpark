/**
 * Must stay aligned with `src/services/ml/ride-feature-vector.util.js` → `TRAINING_FEATURE_NAMES`.
 * Phase 4 manual feature weights only apply to these keys.
 */
export const ML_TRAINING_FEATURE_NAMES = [
  'current_wait_time',
  'wait_time_trend_30m',
  'ride_status_num',
  'park_crowd_index',
  'zone_congestion_score',
  'rain_mm',
  'temperature_c',
  'school_holiday',
  'time_of_day',
] as const

export type MlTrainingFeatureName = (typeof ML_TRAINING_FEATURE_NAMES)[number]
