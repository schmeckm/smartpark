/**
 * Phase 6 — ML Forecast Health Strip (read-only aggregation helpers).
 * Pure functions for tests + Vue wiring; no network calls.
 */

/** Matches DQ hints emitted by `ai-feature-data-quality.service.js` that weaken ridge inputs. */
export const DQ_MODEL_RELEVANT_PATTERN = /weather|traffic|staffing|calendar|completeness/i

export function reasonCodesList(reasonCodesJson) {
  if (!Array.isArray(reasonCodesJson)) return []
  return reasonCodesJson.map((x) => String(x))
}

export function countNoGovernedSnapshotHorizons(results) {
  let n = 0
  for (const r of results || []) {
    if (reasonCodesList(r?.reasonCodesJson).includes('NO_GOVERNED_SNAPSHOT')) n += 1
  }
  return n
}

export function hasMixedMlBaselineRows(results) {
  let anyMl = false
  let anyBaselineOnly = false
  for (const r of results || []) {
    const c = reasonCodesList(r?.reasonCodesJson)
    if (c.includes('SOURCE_ML_MODEL')) anyMl = true
    if (c.includes('SOURCE_BASELINE') && !c.includes('SOURCE_ML_MODEL')) anyBaselineOnly = true
  }
  return anyMl && anyBaselineOnly
}

export function flattenFeatureDataQualityWarnings(dq) {
  if (!dq || typeof dq !== 'object') return []
  const out = []
  for (const r of dq.parkFeatureQuality ?? []) {
    if (Array.isArray(r?.featureDataQuality)) out.push(...r.featureDataQuality.map((x) => String(x)))
  }
  for (const r of dq.rideFeatureQuality ?? []) {
    if (Array.isArray(r?.featureDataQuality)) out.push(...r.featureDataQuality.map((x) => String(x)))
  }
  for (const r of dq.lowConfidenceForecasts ?? []) {
    if (Array.isArray(r?.featureDataQuality)) out.push(...r.featureDataQuality.map((x) => String(x)))
  }
  return out
}

export function dqHintsSuggestModelGap(warnings) {
  for (const w of warnings || []) {
    if (DQ_MODEL_RELEVANT_PATTERN.test(String(w))) return true
  }
  return false
}

export function computeMissingFeaturesTotal(kpis) {
  if (!kpis || typeof kpis !== 'object') return null
  const w = Number(kpis.snapshotsMissingWeatherCount)
  const c = Number(kpis.snapshotsMissingCalendarCount)
  const t = Number(kpis.snapshotsMissingTrafficCount)
  const s = Number(kpis.snapshotsMissingStaffingCount)
  const nums = [w, c, t, s]
  if (nums.some((x) => !Number.isFinite(x))) return null
  return w + c + t + s
}

/** @returns {'ok'|'warning'|'critical'|'unknown'} */
export function badgeFeatureCompleteness(avgCompletenessScore) {
  if (avgCompletenessScore == null || Number.isNaN(Number(avgCompletenessScore))) return 'unknown'
  const x = Number(avgCompletenessScore)
  if (x >= 0.9) return 'ok'
  if (x >= 0.75) return 'warning'
  return 'critical'
}

/** @returns {'ok'|'warning'|'critical'|'unknown'} */
export function badgeMissingFeatures(totalMissing) {
  if (totalMissing == null || Number.isNaN(Number(totalMissing))) return 'unknown'
  const n = Number(totalMissing)
  if (n === 0) return 'ok'
  if (n <= 10) return 'warning'
  return 'critical'
}

/** @returns {'ok'|'warning'|'critical'|'unknown'} */
export function badgeTraceQuality(totalTraces, fallbackCount, opts = {}) {
  const closed = Number(opts.closedPeriodTraceCount ?? 0)
  const n = Number(totalTraces)
  const fb = Number(fallbackCount)
  if (!Number.isFinite(n) || n <= 0) return 'unknown'
  if (closed > 0 && closed === n) return 'na'
  const denom = n - closed
  if (denom <= 0) return 'na'
  if (!Number.isFinite(fb) || fb < 0) return 'unknown'
  const ratio = fb / denom
  if (ratio <= 0.2) return 'ok'
  if (ratio <= 0.5) return 'warning'
  return 'critical'
}

/** @returns {'ok'|'warning'} */
export function badgeModelDataMismatch({ results, dqWarnings }) {
  const dqWarn =
    Array.isArray(dqWarnings) && dqHintsSuggestModelGap(dqWarnings) ? true : false
  const res = Array.isArray(results) ? results : []
  const noGov = countNoGovernedSnapshotHorizons(res) > 0
  const mixed = hasMixedMlBaselineRows(res)
  return dqWarn || noGov || mixed ? 'warning' : 'ok'
}

/**
 * @param {'ridge'|'baseline'|'fallback'|'unknown'} engineMode
 * @param {number} coefRows — merged learned coefficient rows (detail + coefficients endpoint).
 */
export function badgeCoefficientAvailability(engineMode, coefRows, hasSelection, detailLoading) {
  if (!hasSelection) return 'unknown'
  if (detailLoading) return 'unknown'
  if (engineMode === 'baseline' || engineMode === 'fallback') return 'na'
  if (engineMode === 'unknown') return 'unknown'
  const n = Number(coefRows)
  if (!Number.isFinite(n)) return 'unknown'
  if (n > 0) return 'ok'
  return 'warning'
}

/** @returns {'ok'|'warning'|'critical'|'unknown'} */
export function badgeExplanationHealth(lowConfidenceForecastCount) {
  if (lowConfidenceForecastCount == null || Number.isNaN(Number(lowConfidenceForecastCount))) return 'unknown'
  const n = Number(lowConfidenceForecastCount)
  if (n === 0) return 'ok'
  if (n <= 10) return 'warning'
  return 'critical'
}

/**
 * Forecast accuracy strip — uses mean `avgPercentageError` as decimal (e.g. 0.12 = 12%).
 * Pass optional `{ kpi }` so evaluations that are only UNKNOWN due to closed-period snapshots show as N/A.
 * @returns {'ok'|'warning'|'critical'|'unknown'|'na'}
 */
export function badgeForecastAccuracyHealth(avgPercentageError, context) {
  const kpi = context && typeof context === 'object' ? context.kpi : null
  if (kpi && typeof kpi === 'object' && Number(kpi.totalEvaluations) > 0) {
    const comparable =
      (Number(kpi.okCount) || 0) +
      (Number(kpi.warningCount) || 0) +
      (Number(kpi.criticalCount) || 0)
    const unk = Number(kpi.unknownCount) || 0
    const closedUnk = Number(kpi.closedPeriodUnknownCount) || 0
    if (comparable === 0 && unk > 0 && closedUnk === unk) return 'na'
  }
  if (avgPercentageError == null || Number.isNaN(Number(avgPercentageError))) return 'unknown'
  const x = Number(avgPercentageError)
  if (x <= 0.1) return 'ok'
  if (x <= 0.25) return 'warning'
  return 'critical'
}

/** Optional stale/live aggregation — unavailable unless wired to ride-level UNS APIs. */
export function badgeStaleSignals(staleCount, liveCount, apiAvailable) {
  if (!apiAvailable) return 'na'
  const stale = Number(staleCount)
  const live = Number(liveCount)
  if (!Number.isFinite(stale) || !Number.isFinite(live)) return 'unknown'
  if (stale === 0) return 'ok'
  const denom = stale + live
  const ratio = denom > 0 ? stale / denom : 1
  if (ratio <= 0.15) return 'warning'
  return 'critical'
}
