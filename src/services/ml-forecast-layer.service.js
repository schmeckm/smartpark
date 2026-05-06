/**
 * ML enterprise layer (L1/L2/L3) on top of the X-heuristic forecast.
 * @see docs/adr/0001-forecast-architecture.md — order, guardrails, no parallel pipelines.
 */
const { MlGlobalFactor, MlParkFactor } = require('../models');
const { resolveEffectiveMlConfig } = require('./ml-effective-config.service');
const { dedupeInfluencingFactorsByGroup } = require('../utils/forecast-influencing-factors.util');
const { MlFactorCurrentResolverService, monthFromTimeZone } = require('./ml-factor-current-resolver.service');

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

/**
 * When true, RAIN_DEMAND_SHIFT bumps are skipped (camel or snake ride snapshot flags).
 */
function isRainSensitivityDisabled(rideSnap) {
  if (!rideSnap) return false;
  return (
    rideSnap.rainSensitive === false ||
    rideSnap.rain_sensitive === false ||
    rideSnap.rainSensitive === 0 ||
    rideSnap.rain_sensitive === 0
  );
}

/**
 * Public API shape for `mlFactorCurrents`: strip internal resolver-only fields (e.g. `meta.rainMm`).
 * @param {Map<string, object>} currentResolutions
 * @returns {Record<string, object>}
 */
function mlFactorCurrentsForApiResponse(currentResolutions) {
  return Object.fromEntries(
    [...currentResolutions.entries()].map(([code, row]) => {
      const { meta, ...pub } = row;
      return [code, pub];
    })
  );
}

/**
 * Enterprise L1+L2+L3 heuristic minutes on top of baseline X-layer forecast.
 * @param {object} summary - already passed through applyXLayerToForecast
 * @param {{ internalParkId?: string|null, internalAssetId?: string|null, parkSnap?: object|null, rideSnap?: object|null, timestamp?: Date|string }} ctx
 */
async function mergeMlEnterpriseLayer(summary, ctx) {
  const internalParkId = ctx.internalParkId || ctx.parkSnap?.internalParkId || ctx.parkSnap?.internal_park_id || null;
  const internalAssetId = ctx.internalAssetId || ctx.rideSnap?.internalAssetId || ctx.rideSnap?.internal_asset_id || null;
  const parkSnap = ctx.parkSnap || null;
  const rideSnap = ctx.rideSnap || null;

  let effConfig = null;
  if (internalAssetId) {
    try {
      effConfig = await resolveEffectiveMlConfig(internalAssetId);
    } catch {
      effConfig = null;
    }
  }
  const profPlain = effConfig?.profile || {};

  const globals = await MlGlobalFactor.findAll({ where: { activeFlag: true } });
  const parkRows = internalParkId
    ? await MlParkFactor.findAll({ where: { parkId: internalParkId, activeFlag: true } })
    : [];
  const gBy = new Map(globals.map((r) => [r.factorCode, r.get({ plain: true })]));
  const pBy = new Map(parkRows.map((r) => [r.factorCode, r.get({ plain: true })]));

  const mergeTimestampRaw =
    parkSnap?.snapshotAt ??
    parkSnap?.snapshot_at ??
    ctx.timestamp ??
    new Date();
  const mergeTimestamp = mergeTimestampRaw instanceof Date ? mergeTimestampRaw : new Date(mergeTimestampRaw);

  let currentResolutions = new Map();
  if (internalParkId) {
    try {
      const resolver = new MlFactorCurrentResolverService();
      currentResolutions = await resolver.resolveCurrentsForMerge({
        internalParkId,
        timestamp: mergeTimestamp,
        parkSnap,
        gBy,
        pBy,
      });
    } catch {
      currentResolutions = new Map();
    }
  }

  const factors = [];
  let delta = 0;

  function effWeight(code) {
    const p = pBy.get(code);
    const g = gBy.get(code);
    const w = p?.weightOverride != null && p.weightOverride !== '' ? n(p.weightOverride, 1) : n(g?.weight, 1);
    return w;
  }

  function effValue(code) {
    const resolved = currentResolutions.get(code);
    if (resolved && resolved.currentSource) {
      return n(resolved.current, 1);
    }
    const p = pBy.get(code);
    const g = gBy.get(code);
    const v =
      p?.currentValue != null && p.currentValue !== ''
        ? n(p.currentValue, 1)
        : g?.currentValue != null && g.currentValue !== ''
          ? n(g.currentValue, 1)
          : n(g?.defaultValue, 1);
    return v;
  }

  function bump(code, minutes, detail) {
    if (!minutes) return;
    delta += minutes;
    factors.push({ feature: code, impact: `${minutes >= 0 ? '+' : ''}${minutes} min`, detail: detail || code });
  }

  const isHoliday = Boolean(parkSnap?.isPublicHoliday || parkSnap?.is_public_holiday);
  const isSchool = Boolean(
    parkSnap?.isSchoolHoliday ||
      parkSnap?.is_school_holiday ||
      parkSnap?.isSchoolBreak ||
      parkSnap?.is_school_break
  );
  const isWeekend = Boolean(parkSnap?.isWeekend ?? parkSnap?.is_weekend);
  const hasSnapMonth = parkSnap?.month != null && parkSnap?.month !== '';
  const month = hasSnapMonth
    ? n(parkSnap.month, 0)
    : monthFromTimeZone(mergeTimestamp, parkSnap?.timezone || parkSnap?.timeZone || 'UTC');
  const precip = n(parkSnap?.precipitationMm ?? parkSnap?.precipitation_mm);

  if (gBy.has('HOLIDAY_PRESSURE') && isHoliday) {
    bump('HOLIDAY_PRESSURE', Math.round(6 * effValue('HOLIDAY_PRESSURE') * effWeight('HOLIDAY_PRESSURE')), 'Public holiday');
  }
  if (gBy.has('SCHOOL_BREAK_PRESSURE') && isSchool) {
    bump('SCHOOL_BREAK_PRESSURE', Math.round(5 * effValue('SCHOOL_BREAK_PRESSURE') * effWeight('SCHOOL_BREAK_PRESSURE')), 'School break');
  }
  if (gBy.has('WEEKEND_UPLIFT') && isWeekend) {
    bump('WEEKEND_UPLIFT', Math.round(3 * effValue('WEEKEND_UPLIFT') * effWeight('WEEKEND_UPLIFT')), 'Weekend');
  }
  if (
    gBy.has('SUMMER_SEASON_FACTOR') &&
    month != null &&
    month >= 5 &&
    month <= 9 &&
    effValue('SUMMER_SEASON_FACTOR') > 0
  ) {
    const detail = month >= 6 && month <= 8 ? 'Summer season' : 'Shoulder season';
    bump(
      'SUMMER_SEASON_FACTOR',
      Math.round(2 * effValue('SUMMER_SEASON_FACTOR') * effWeight('SUMMER_SEASON_FACTOR')),
      detail
    );
  }
  const rainResolved = currentResolutions.get('RAIN_DEMAND_SHIFT');
  const rainMmMeta = rainResolved?.meta?.rainMm;
  const rainMm =
    rainMmMeta != null && Number.isFinite(Number(rainMmMeta)) ? Number(rainMmMeta) : precip;
  if (gBy.has('RAIN_DEMAND_SHIFT') && rainMm > 0.3 && !isRainSensitivityDisabled(rideSnap)) {
    const profileRain = n(profPlain.rainImpactScore ?? profPlain.rain_impact_score, 0);
    const sign = profileRain >= 0 ? 1 : -1;
    const base = Math.min(8, Math.round(rainMm));
    const mins = Math.round(sign * base * effValue('RAIN_DEMAND_SHIFT') * effWeight('RAIN_DEMAND_SHIFT'));
    bump('RAIN_DEMAND_SHIFT', mins, 'Rain shift (L1×L3 profile)');
  }
  /** Macro: no uplift when effective index matches global default × weight (seeded neutral). */
  const gMacro = gBy.get('MACRO_TOURISM_INDEX');
  if (gMacro) {
    const v = effValue('MACRO_TOURISM_INDEX');
    const w = effWeight('MACRO_TOURISM_INDEX');
    const defV = n(gMacro.defaultValue, 1);
    const combined = v * w;
    const neutral = defV * w;
    if (Math.abs(combined - neutral) > 0.08) {
      bump('MACRO_TOURISM_INDEX', Math.round(2 * combined), 'Macro tourism');
    }
  }

  if (internalAssetId && effConfig) {
    const prof = effConfig.profile || {};
    const qe = n(prof.queueElasticityScore ?? prof.queue_elasticity_score, 0.5);
    const cur = n(summary.currentAvgWaitMinutes, 0);
    bump('QUEUE_ELASTICITY', Math.round(cur * (qe - 0.5) * 0.15), `Profile ${effConfig.profileCode || 'DEFAULT'}`);
    if (effConfig.warnings?.length) {
      for (const w of effConfig.warnings.slice(0, 3)) {
        factors.push({ feature: 'ML_CONFIG', impact: '0 min', detail: w });
      }
    }
  }

  const f15 = summary.forecast15Minutes != null ? Math.max(0, Math.round(summary.forecast15Minutes + delta * 0.35)) : null;
  const f60 = summary.forecast60Minutes != null ? Math.max(0, Math.round(summary.forecast60Minutes + delta)) : null;
  const mergedFactors = dedupeInfluencingFactorsByGroup([...(summary.topInfluencingFactors || []), ...factors]).slice(
    0,
    12
  );

  const hasMl =
    delta !== 0 || factors.some((f) => f.feature && !String(f.feature).startsWith('ML_CONFIG'));

  const mlFactorCurrents = mlFactorCurrentsForApiResponse(currentResolutions);

  return {
    ...summary,
    forecast15Minutes: f15,
    forecast60Minutes: f60,
    topInfluencingFactors: mergedFactors,
    forecastSource: hasMl ? 'FEATURE_MODEL' : summary.forecastSource,
    mlFactorCurrents,
  };
}

module.exports = {
  mergeMlEnterpriseLayer,
  isRainSensitivityDisabled,
  mlFactorCurrentsForApiResponse,
};
