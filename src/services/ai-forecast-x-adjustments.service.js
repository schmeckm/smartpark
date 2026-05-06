/**
 * X-heuristic layer: nudge baseline +15/+60 from latest park/ride feature snapshots.
 * Runs once per forecast after baseline; ML enterprise layer runs after this.
 * @see docs/adr/0001-forecast-architecture.md — coordinate with L1/L2 to avoid double counting.
 * Does not replace a trained model; keeps API backward-compatible (numeric confidence 0–1).
 */

const { seasonIndicatorFromCode } = require('../utils/season-indicator.util');

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function confidenceFromCompleteness(parkSnap, rideSnap) {
  const pc = parkSnap?.completenessScore ?? parkSnap?.completeness_score;
  const rc = rideSnap?.completenessScore ?? rideSnap?.completeness_score;
  const c = Math.min(pc != null && pc !== '' ? n(pc) : 0.5, rc != null && rc !== '' ? n(rc) : 0.5);
  if (c < 0.45) return { level: 'LOW', numeric: Math.max(0.15, c) };
  if (c < 0.72) return { level: 'MEDIUM', numeric: Math.max(0.35, c) };
  return { level: 'HIGH', numeric: Math.max(0.55, Math.min(0.95, c + 0.15)) };
}

/**
 * Split forecast UX: `warnings` drive WARNING status + confidence penalty; `notes` are informational only.
 * Traffic has no provider yet; missing calendar row defaults to non-holiday — neither should look like “errors”.
 * @returns {{ warnings: string[], notes: string[] }}
 */
function featureDataQualityHints(parkSnap, rideSnap) {
  const warnings = [];
  const notes = [];
  const temp = parkSnap?.temperatureC ?? parkSnap?.temperature_c;
  const precip = parkSnap?.precipitationMm ?? parkSnap?.precipitation_mm;
  const rainProb = parkSnap?.rainProbabilityPercent ?? parkSnap?.rain_probability_percent;
  if (temp == null && precip == null && rainProb == null) warnings.push('Weather features missing');
  const extras = parkSnap?.xFeaturesExtras || parkSnap?.x_features_extras;
  if (extras?.traffic === 'not_configured') notes.push('Traffic data not configured');
  if (extras?.events === 'not_configured') notes.push('Event calendar not configured');
  const sg = rideSnap?.staffingGapNormal ?? rideSnap?.staffing_gap_normal;
  const assetId = rideSnap?.internalAssetId ?? rideSnap?.internal_asset_id;
  if (rideSnap && assetId && sg == null) warnings.push('Staffing data incomplete');
  const comp = parkSnap?.completenessScore ?? parkSnap?.completeness_score;
  if (comp != null && comp !== '' && n(comp) < 0.45) warnings.push('Low snapshot completeness (park)');
  return { warnings, notes };
}

/**
 * @param {object} summary - getEntitySummary / getSummary shape
 * @param {{ parkSnap?: object|null, rideSnap?: object|null }} ctx
 */
function applyXLayerToForecast(summary, ctx) {
  const parkSnap = ctx.parkSnap || null;
  const rideSnap = ctx.rideSnap || null;
  const base15 = summary.forecast15Minutes;
  const base60 = summary.forecast60Minutes;
  const { warnings: dqWarnings, notes: dqNotes } = featureDataQualityHints(parkSnap, rideSnap);

  const xExtras = parkSnap?.xFeaturesExtras ?? parkSnap?.x_features_extras;
  const calendarRowConfigured = xExtras?.events === 'configured';

  const seasonSnap = seasonIndicatorFromCode(parkSnap?.season ?? parkSnap?.season_code);

  const snapshotContext = {
    weather: {
      temperatureC: parkSnap?.temperatureC ?? parkSnap?.temperature_c ?? null,
      precipitationMm: parkSnap?.precipitationMm ?? parkSnap?.precipitation_mm ?? null,
      rainProbabilityPercent:
        parkSnap?.rainProbabilityPercent ?? parkSnap?.rain_probability_percent ?? null,
      windSpeedKmh: parkSnap?.windSpeedKmh ?? parkSnap?.wind_speed_kmh ?? null,
      weatherCondition: parkSnap?.weatherCondition ?? parkSnap?.weather_condition ?? null,
    },
    calendar: {
      /** From park snapshot X-layer extras — distinguishes „no holiday today“ vs „calendar not queried“. */
      calendarRowConfigured,
      isPublicHoliday: Boolean(parkSnap?.isPublicHoliday ?? parkSnap?.is_public_holiday),
      isSchoolHoliday: Boolean(parkSnap?.isSchoolHoliday ?? parkSnap?.is_school_holiday),
      holidayName: parkSnap?.holidayName ?? parkSnap?.holiday_name ?? null,
    },
    traffic: { trafficIndex: parkSnap?.trafficIndex ?? parkSnap?.traffic_index ?? null },
    operating: {
      withinScheduledOperatingHours:
        parkSnap?.withinScheduledOperatingHours ?? parkSnap?.within_scheduled_operating_hours ?? null,
      scheduleSampledAt:
        parkSnap?.scheduledOperatingSnapshotAt ?? parkSnap?.scheduled_operating_snapshot_at ?? null,
    },
    season: {
      code: seasonSnap.code,
      labelDe: seasonSnap.labelDe,
      labelEn: seasonSnap.labelEn,
    },
    staffing: {
      staffingGapNormal: rideSnap?.staffingGapNormal ?? rideSnap?.staffing_gap_normal ?? null,
    },
    capacity: {
      theoreticalCapacityPph: rideSnap?.theoreticalCapacityPph ?? rideSnap?.theoretical_capacity_pph ?? null,
    },
    parkCrowdIndex: parkSnap?.parkCrowdIndex ?? parkSnap?.park_crowd_index ?? null,
  };

  if (base15 == null && base60 == null) {
    const { level, numeric } = confidenceFromCompleteness(parkSnap, rideSnap);
    const baseConf = summary.confidence != null ? n(summary.confidence) : numeric;
    let confidence = Math.max(0.1, Math.min(0.95, baseConf * 0.55 + numeric * 0.45));
    if (dqWarnings.length) {
      confidence = Math.max(0.12, confidence * (1 - 0.045 * Math.min(dqWarnings.length, 5)));
    }
    const forecastDataQualityStatus = dqWarnings.length ? 'WARNING' : 'OK';
    return {
      ...summary,
      confidenceLevel: level,
      forecastSource: 'FEATURE_SNAPSHOT_BASELINE_X_V1',
      topInfluencingFactors: [],
      confidence,
      featureDataQuality: dqWarnings,
      featureDataQualityNotes: dqNotes,
      forecastDataQualityStatus,
      snapshotCompletenessScore: parkSnap?.completenessScore ?? parkSnap?.completeness_score ?? null,
      snapshotContext,
    };
  }

  const factors = [];
  let delta = 0;

  const precip = n(parkSnap?.precipitationMm ?? parkSnap?.precipitation_mm);
  const rainSensitive = rideSnap?.rainSensitive !== false && rideSnap?.rain_sensitive !== false;
  if (rainSensitive && precip > 0.5) {
    const d = Math.min(8, Math.round(precip));
    delta += d;
    factors.push({ feature: 'precipitation_mm', impact: `+${d} min`, detail: 'Outdoor / rain-sensitive ride' });
  }

  if (parkSnap?.isPublicHoliday || parkSnap?.is_public_holiday) {
    delta += 5;
    factors.push({ feature: 'public_holiday', impact: '+5 min', detail: 'Calendar context' });
  }
  if (parkSnap?.isSchoolHoliday || parkSnap?.is_school_holiday) {
    delta += 4;
    factors.push({ feature: 'school_holiday', impact: '+4 min', detail: 'Calendar context' });
  }

  const traffic = n(parkSnap?.trafficIndex ?? parkSnap?.traffic_index);
  if (traffic > 0.65) {
    const d = Math.min(10, Math.round((traffic - 0.5) * 18));
    delta += d;
    factors.push({ feature: 'traffic_index', impact: `+${d} min`, detail: 'Traffic pressure (mock or provider)' });
  }

  const gap = n(rideSnap?.staffingGapNormal ?? rideSnap?.staffing_gap_normal);
  if (gap > 0) {
    const d = Math.min(10, Math.round(gap * 1.5));
    delta += d;
    factors.push({ feature: 'staffing_gap_normal', impact: `+${d} min`, detail: 'Heuristic staffing gap vs. placeholder norm' });
  }

  const cap = n(rideSnap?.theoreticalCapacityPph ?? rideSnap?.theoretical_capacity_pph);
  const curWait = n(rideSnap?.currentWaitTimeMin ?? rideSnap?.current_wait_time_min ?? summary.currentAvgWaitMinutes);
  if (cap > 0 && cap < 600 && curWait > 15) {
    const d = 3;
    delta += d;
    factors.push({
      feature: 'theoretical_capacity_pph',
      impact: `+${d} min`,
      detail: 'Lower hourly capacity vs. sustained queue (heuristic)',
    });
  }

  const f15 = base15 != null ? Math.max(0, Math.round(base15 + delta * 0.35)) : null;
  const f60 = base60 != null ? Math.max(0, Math.round(base60 + delta)) : null;
  const { level, numeric } = confidenceFromCompleteness(parkSnap, rideSnap);
  const baseConf = summary.confidence != null ? n(summary.confidence) : 0.4;
  let confidence = Math.max(0.1, Math.min(0.95, baseConf * 0.65 + numeric * 0.35));
  if (dqWarnings.length) {
    confidence = Math.max(0.12, confidence * (1 - 0.045 * Math.min(dqWarnings.length, 5)));
  }

  factors.sort((a, b) => Math.abs(parseInt(String(b.impact), 10) || 0) - Math.abs(parseInt(String(a.impact), 10) || 0));

  const forecastDataQualityStatus = dqWarnings.length ? 'WARNING' : 'OK';

  return {
    ...summary,
    forecast15Minutes: f15,
    forecast60Minutes: f60,
    confidence,
    confidenceLevel: level,
    forecastSource: 'FEATURE_SNAPSHOT_BASELINE_X_V1',
    topInfluencingFactors: factors.slice(0, 8),
    featureDataQuality: dqWarnings,
    featureDataQualityNotes: dqNotes,
    forecastDataQualityStatus,
    snapshotCompletenessScore: parkSnap?.completenessScore ?? parkSnap?.completeness_score ?? null,
    snapshotContext,
  };
}

module.exports = { applyXLayerToForecast, confidenceFromCompleteness, featureDataQualityHints };
