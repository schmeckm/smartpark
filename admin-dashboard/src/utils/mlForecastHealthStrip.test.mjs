import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  badgeTraceQuality,
  badgeCoefficientAvailability,
  badgeMissingFeatures,
  badgeFeatureCompleteness,
  badgeModelDataMismatch,
  badgeExplanationHealth,
  badgeForecastAccuracyHealth,
  computeMissingFeaturesTotal,
  countNoGovernedSnapshotHorizons,
  flattenFeatureDataQualityWarnings,
  hasMixedMlBaselineRows,
} from './mlForecastHealthStrip.mjs'

describe('mlForecastHealthStrip', () => {
  it('trace quality unknown when no traces', () => {
    assert.equal(badgeTraceQuality(0, 0), 'unknown')
  })

  it('trace quality OK under 20% fallback ratio', () => {
    assert.equal(badgeTraceQuality(10, 2), 'ok')
  })

  it('trace quality Warning between 20% and 50%', () => {
    assert.equal(badgeTraceQuality(10, 3), 'warning')
    assert.equal(badgeTraceQuality(10, 5), 'warning')
  })

  it('trace quality Critical above 50%', () => {
    assert.equal(badgeTraceQuality(10, 6), 'critical')
  })

  it('coefficient availability unknown without selection', () => {
    assert.equal(badgeCoefficientAvailability('ridge', 5, false, false), 'unknown')
  })

  it('coefficient availability NA for fallback trace when selected', () => {
    assert.equal(badgeCoefficientAvailability('fallback', 0, true, false), 'na')
  })

  it('coefficient availability Warning for ridge without coefficients', () => {
    assert.equal(badgeCoefficientAvailability('ridge', 0, true, false), 'warning')
  })

  it('coefficient availability OK for ridge with coefficients', () => {
    assert.equal(badgeCoefficientAvailability('ridge', 4, true, false), 'ok')
  })

  it('coefficient availability unknown while detail loads', () => {
    assert.equal(badgeCoefficientAvailability('ridge', 0, true, true), 'unknown')
  })

  it('missing features thresholds', () => {
    assert.equal(badgeMissingFeatures(0), 'ok')
    assert.equal(badgeMissingFeatures(10), 'warning')
    assert.equal(badgeMissingFeatures(11), 'critical')
    assert.equal(badgeMissingFeatures(null), 'unknown')
  })

  it('feature completeness thresholds', () => {
    assert.equal(badgeFeatureCompleteness(0.95), 'ok')
    assert.equal(badgeFeatureCompleteness(0.8), 'warning')
    assert.equal(badgeFeatureCompleteness(0.5), 'critical')
  })

  it('explanation health unknown when KPI absent', () => {
    assert.equal(badgeExplanationHealth(null), 'unknown')
  })

  it('explanation health thresholds', () => {
    assert.equal(badgeExplanationHealth(0), 'ok')
    assert.equal(badgeExplanationHealth(10), 'warning')
    assert.equal(badgeExplanationHealth(11), 'critical')
  })

  it('countNoGovernedSnapshotHorizons sums horizons', () => {
    assert.equal(countNoGovernedSnapshotHorizons([{ reasonCodesJson: ['NO_GOVERNED_SNAPSHOT'] }, {}]), 1)
  })

  it('computeMissingFeaturesTotal sums four KPI buckets', () => {
    assert.equal(
      computeMissingFeaturesTotal({
        snapshotsMissingWeatherCount: 1,
        snapshotsMissingCalendarCount: 2,
        snapshotsMissingTrafficCount: 3,
        snapshotsMissingStaffingCount: 4,
      }),
      10
    )
  })

  it('computeMissingFeaturesTotal returns null without KPI shape', () => {
    assert.equal(computeMissingFeaturesTotal(null), null)
  })

  it('model/data mismatch warns on NO_GOVERNED_SNAPSHOT', () => {
    assert.equal(
      badgeModelDataMismatch({
        results: [{ reasonCodesJson: ['NO_GOVERNED_SNAPSHOT'] }],
        dqWarnings: [],
      }),
      'warning'
    )
  })

  it('model/data mismatch warns on mixed SOURCE rows', () => {
    assert.equal(
      badgeModelDataMismatch({
        results: [
          { reasonCodesJson: ['SOURCE_ML_MODEL'] },
          { reasonCodesJson: ['SOURCE_BASELINE'] },
        ],
        dqWarnings: [],
      }),
      'warning'
    )
  })

  it('model/data mismatch OK when traces clean and DQ clean', () => {
    assert.equal(
      badgeModelDataMismatch({
        results: [{ reasonCodesJson: ['SOURCE_ML_MODEL'] }],
        dqWarnings: [],
      }),
      'ok'
    )
  })

  it('model/data mismatch warns on DQ snapshot hints alone', () => {
    assert.equal(
      badgeModelDataMismatch({
        results: [],
        dqWarnings: ['Weather features missing'],
      }),
      'warning'
    )
  })

  it('flattenFeatureDataQualityWarnings merges rows', () => {
    const dq = {
      parkFeatureQuality: [{ featureDataQuality: ['Weather features missing'] }],
      rideFeatureQuality: [{ featureDataQuality: ['Traffic index missing'] }],
      lowConfidenceForecasts: [{ featureDataQuality: ['Low confidence stub'] }],
    }
    const w = flattenFeatureDataQualityWarnings(dq)
    assert.equal(w.includes('Weather features missing'), true)
    assert.equal(w.includes('Traffic index missing'), true)
  })

  it('hasMixedMlBaselineRows detects split horizons', () => {
    assert.equal(
      hasMixedMlBaselineRows([
        { reasonCodesJson: ['SOURCE_ML_MODEL'] },
        { reasonCodesJson: ['SOURCE_BASELINE'] },
      ]),
      true
    )
    assert.equal(hasMixedMlBaselineRows([{ reasonCodesJson: ['SOURCE_BASELINE'] }]), false)
  })

  it('forecast accuracy NA when all UNKNOWN are closed-period snapshots', () => {
    assert.equal(
      badgeForecastAccuracyHealth(null, {
        kpi: {
          totalEvaluations: 5,
          okCount: 0,
          warningCount: 0,
          criticalCount: 0,
          unknownCount: 5,
          closedPeriodUnknownCount: 5,
        },
      }),
      'na'
    )
  })

  it('forecast accuracy health uses 10% / 25% thresholds on decimal MAPE', () => {
    assert.equal(badgeForecastAccuracyHealth(0.08), 'ok')
    assert.equal(badgeForecastAccuracyHealth(0.15), 'warning')
    assert.equal(badgeForecastAccuracyHealth(0.4), 'critical')
    assert.equal(badgeForecastAccuracyHealth(null), 'unknown')
  })

  it('trace quality NA when every trace is closed-period only', () => {
    assert.equal(badgeTraceQuality(5, 0, { closedPeriodTraceCount: 5 }), 'na')
  })

  it('trace quality OK excludes closed-period rows from denominator', () => {
    assert.equal(badgeTraceQuality(10, 1, { closedPeriodTraceCount: 4 }), 'ok')
  })
})
