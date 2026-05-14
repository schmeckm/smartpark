'use strict';

/**
 * Read-only Feature Store readiness for ride_feature_snapshots_5m.
 * Does not run forecasts, change snapshots, or accuracy math.
 */

const { Op } = require('sequelize');
const { sequelize } = require('../../db/sequelize');
const { AiPipelineRun } = require('../../models');
const { getPlatformSettingsService } = require('../platform-settings.service');
const { AppError } = require('../../utils/app-error');
const { sqlHasNumericWait } = require('../../utils/ride-feature-snapshot-sql.util');

const STATUS = {
  OK: 'OK',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
};

const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const FRESH_OK_MS = 30 * 60 * 1000;
const FRESH_WARN_MS = 90 * 60 * 1000;

/**
 * @param {boolean} enabled
 * @param {'DB'|'ENV'|'DEFAULT'} source
 * @returns {{ enabled: boolean, source: string, status: string }}
 */
function computeSchedulerBlock(enabled, source) {
  return {
    enabled: Boolean(enabled),
    source: source || 'DEFAULT',
    status: enabled ? STATUS.OK : STATUS.CRITICAL,
  };
}

/**
 * @param {{ finishedAt?: Date|null, rideSnapshotsWritten?: number, featureStoreError?: string|null, status?: string }|null} lastRun
 */
function computeLastPipelineBlock(lastRun) {
  if (!lastRun || !lastRun.finishedAt) {
    return {
      lastRunAt: null,
      rideSnapshotsWritten: lastRun?.rideSnapshotsWritten ?? 0,
      featureStoreError: lastRun?.featureStoreError ?? null,
      status: STATUS.CRITICAL,
    };
  }
  const err =
    lastRun.featureStoreError != null && String(lastRun.featureStoreError).trim() !== ''
      ? String(lastRun.featureStoreError)
      : null;
  return {
    lastRunAt: lastRun.finishedAt instanceof Date ? lastRun.finishedAt.toISOString() : String(lastRun.finishedAt),
    rideSnapshotsWritten: Number(lastRun.rideSnapshotsWritten) || 0,
    featureStoreError: err,
    status: err ? STATUS.WARNING : STATUS.OK,
  };
}

/**
 * @param {{
 *   totalRows: number,
 *   latestSnapshotAt: Date|string|null,
 *   ridesWithSnapshots: number,
 * }} ag
 */
function computeSnapshotCoverageBlock(ag, nowMs = Date.now()) {
  const totalRows = Number(ag.totalRows) || 0;
  const ridesWithSnapshots = Number(ag.ridesWithSnapshots) || 0;
  const latestSnapshotAtRaw = ag.latestSnapshotAt ? new Date(ag.latestSnapshotAt) : null;
  const latestOk = latestSnapshotAtRaw != null && !Number.isNaN(latestSnapshotAtRaw.getTime());
  let status = STATUS.OK;

  if (totalRows <= 0) {
    status = STATUS.CRITICAL;
  } else if (latestOk) {
    const age = nowMs - latestSnapshotAtRaw.getTime();
    if (age > FRESH_WARN_MS) status = STATUS.CRITICAL;
    else if (age > FRESH_OK_MS) status = STATUS.WARNING;
  } else {
    status = STATUS.CRITICAL;
  }

  return {
    totalRows,
    ridesWithSnapshots,
    latestSnapshotAt: latestOk ? latestSnapshotAtRaw.toISOString() : null,
    status,
  };
}

/**
 * @param {{
 *   totalRows: number,
 *   rowsWithWaitTime: number,
 * }} w
 */
function computeWaitCoverageBlock(w) {
  const totalRows = Number(w.totalRows) || 0;
  const rowsWithWaitTime = Number(w.rowsWithWaitTime) || 0;
  const rowsWithoutWaitTime = Math.max(0, totalRows - rowsWithWaitTime);
  const coveragePercent = totalRows > 0 ? Math.round((100 * rowsWithWaitTime) / totalRows) : 0;

  let status = STATUS.CRITICAL;
  if (totalRows <= 0) {
    status = STATUS.CRITICAL;
  } else if (coveragePercent >= 70) {
    status = STATUS.OK;
  } else if (coveragePercent >= 30) {
    status = STATUS.WARNING;
  } else {
    status = STATUS.CRITICAL;
  }

  return {
    rowsWithWaitTime,
    rowsWithoutWaitTime,
    coveragePercent,
    status,
  };
}

/**
 * @param {{
 *   totalRows: number,
 *   eligibleRows: number,
 *   topReasons: { reason: string, count: number }[],
 * }} e
 */
function computeAccuracyEligibilityBlock(e) {
  const totalRows = Number(e.totalRows) || 0;
  const eligibleRows = Math.min(Number(e.eligibleRows) || 0, totalRows);
  const ineligibleRows = Math.max(0, totalRows - eligibleRows);
  const reasons = Array.isArray(e.topReasons) ? e.topReasons : [];

  /** @type {string} */
  let status = STATUS.WARNING;
  if (totalRows <= 0) status = STATUS.WARNING;
  else if (eligibleRows > 0) status = STATUS.OK;
  else {
    const closedCt = reasons
      .filter((r) => r.reason === 'PARK_CLOSED' || r.reason === 'RIDE_CLOSED')
      .reduce((s, x) => s + Number(x.count) || 0, 0);
    const dominantClosed = closedCt >= totalRows * 0.85;
    if (dominantClosed) status = STATUS.WARNING;
    else {
      const noWt = reasons.find((r) => r.reason === 'NO_WAIT_TIME');
      const noWtN = Number(noWt?.count) || 0;
      const noWtHeavy = totalRows > 0 && noWtN / totalRows >= 0.35;
      status = noWtHeavy ? STATUS.CRITICAL : STATUS.WARNING;
    }
  }

  return {
    eligibleRows,
    ineligibleRows,
    topReasons: reasons.slice(0, 12),
    status,
  };
}

async function aggregateSnapshotsForPark(parkId, rideIdOrNull, fromDate, toDate) {
  const hasWaitSql = sqlHasNumericWait('w');
  /** @type {Record<string, unknown>} */
  const replacements = {
    parkId: String(parkId),
    from: fromDate,
    to: toDate,
  };
  let rideClause = '';
  if (rideIdOrNull && String(rideIdOrNull).trim()) {
    replacements.rideId = String(rideIdOrNull).trim();
    rideClause = `AND w.internal_asset_id::text = :rideId`;
  }

  /** @type {Array<Record<string, unknown>>} */
  const summaryRows = await sequelize.query(
    `
SELECT
  COUNT(*)::int AS total_rows,
  COUNT(DISTINCT w.internal_asset_id)::int AS rides_distinct,
  MAX(w.snapshot_at) AS latest_snapshot_at,
  SUM(CASE WHEN ${hasWaitSql} THEN 1 ELSE 0 END)::int AS rows_with_wait,
  SUM(CASE WHEN w.accuracy_eligible AND ${hasWaitSql} THEN 1 ELSE 0 END)::int AS eligible_rows
FROM ride_feature_snapshots_5m w
WHERE w.internal_park_id::text = :parkId
  AND w.snapshot_at >= :from AND w.snapshot_at <= :to
  ${rideClause}
`,
    { replacements, type: sequelize.QueryTypes.SELECT }
  );

  const s = summaryRows[0] || {};
  const totalRows = Number(s.total_rows) || 0;
  const ridesWithSnapshots =
    replacements.rideId != null ? (totalRows > 0 ? 1 : 0) : Number(s.rides_distinct) || 0;
  const latestSnapshotAt = s.latest_snapshot_at || null;

  /** @type {Array<Record<string, unknown>>} */
  const reasonRows = await sequelize.query(
    `
SELECT reason_bucket AS reason, COUNT(*)::int AS count
FROM (
  SELECT CASE
    WHEN w.accuracy_eligible AND ${hasWaitSql} THEN '__ELIGIBLE__'
    WHEN w.accuracy_eligible = FALSE AND trim(coalesce(w.data_quality_reason, '')) = 'PARK_CLOSED' THEN 'PARK_CLOSED'
    WHEN w.accuracy_eligible = FALSE AND trim(coalesce(w.data_quality_reason, '')) = 'RIDE_CLOSED' THEN 'RIDE_CLOSED'
    WHEN w.accuracy_eligible = TRUE THEN 'NO_WAIT_TIME'
    ELSE 'OTHER_INELIGIBLE'
  END AS reason_bucket
  FROM ride_feature_snapshots_5m w
  WHERE w.internal_park_id::text = :parkId
    AND w.snapshot_at >= :from AND w.snapshot_at <= :to
    ${rideClause}
) t
WHERE t.reason_bucket <> '__ELIGIBLE__'
GROUP BY reason_bucket
ORDER BY COUNT(*) DESC
LIMIT 24
`,
    { replacements, type: sequelize.QueryTypes.SELECT }
  );

  const topReasons = reasonRows.map((row) => ({
    reason: String(row.reason || 'OTHER_INELIGIBLE'),
    count: Number(row.count) || 0,
  }));

  return {
    totalRows,
    ridesWithSnapshots,
    latestSnapshotAt,
    rowsWithWaitTime: Number(s.rows_with_wait) || 0,
    eligibleRows: Number(s.eligible_rows) || 0,
    topReasons,
  };
}

async function fetchLastFinishedPipelineRun() {
  return AiPipelineRun.findOne({
    where: {
      finishedAt: { [Op.ne]: null },
    },
    order: [['finishedAt', 'DESC']],
    attributes: [
      'startedAt',
      'finishedAt',
      'durationMs',
      'status',
      'parkSnapshotsWritten',
      'rideSnapshotsWritten',
      'labelsWritten',
      'featureStoreError',
      'scoringError',
    ],
  });
}

function resolveWindow(fromRaw, toRaw) {
  const toDate = toRaw ? new Date(toRaw) : new Date();
  if (Number.isNaN(toDate.getTime())) {
    throw new AppError('Invalid "to" date', 422, { code: 'INVALID_QUERY' });
  }
  const fromCandidate = fromRaw ? new Date(fromRaw) : new Date(toDate.getTime() - DEFAULT_RANGE_MS);
  if (Number.isNaN(fromCandidate.getTime())) {
    throw new AppError('Invalid "from" date', 422, { code: 'INVALID_QUERY' });
  }
  if (fromCandidate.getTime() > toDate.getTime()) {
    throw new AppError('"from" must be before or equal to "to"', 422, { code: 'INVALID_QUERY' });
  }
  return { from: fromCandidate, to: toDate };
}

/**
 * @param {{
 *   parkId: string,
 *   rideId?: string|null,
 *   from?: string|null,
 *   to?: string|null,
 * }} opts
 */
async function getMlFeatureStoreReadiness(opts) {
  const parkId = opts.parkId != null ? String(opts.parkId).trim() : '';
  if (!parkId) {
    throw new AppError('Park context required', 400, { code: 'PARK_REQUIRED' });
  }
  const rideId = opts.rideId != null && String(opts.rideId).trim() ? String(opts.rideId).trim() : null;
  const { from, to } = resolveWindow(opts.from || null, opts.to || null);

  const ps = getPlatformSettingsService();
  const eff = await ps.getEffectiveForPipelineHealth();
  const aiOn = eff.aiSampling.enabled;
  const scheduler = computeSchedulerBlock(aiOn.value, aiOn.source);

  const lastRunRow = await fetchLastFinishedPipelineRun();
  const lastPlain = lastRunRow ? lastRunRow.get({ plain: true }) : null;
  const lastPipelineRun = computeLastPipelineBlock(lastPlain);

  const ag = await aggregateSnapshotsForPark(parkId, rideId, from, to);
  const snapshotCoverage = computeSnapshotCoverageBlock({
    totalRows: ag.totalRows,
    latestSnapshotAt: ag.latestSnapshotAt,
    ridesWithSnapshots: ag.ridesWithSnapshots,
  });
  const waitTimeCoverage = computeWaitCoverageBlock({
    totalRows: ag.totalRows,
    rowsWithWaitTime: ag.rowsWithWaitTime,
  });
  const accuracyEligibility = computeAccuracyEligibilityBlock({
    totalRows: ag.totalRows,
    eligibleRows: ag.eligibleRows,
    topReasons: ag.topReasons,
  });

  return {
    scheduler,
    lastPipelineRun,
    snapshotCoverage,
    waitTimeCoverage,
    accuracyEligibility,
  };
}

module.exports = {
  getMlFeatureStoreReadiness,
  computeSchedulerBlock,
  computeLastPipelineBlock,
  computeSnapshotCoverageBlock,
  computeWaitCoverageBlock,
  computeAccuracyEligibilityBlock,
  STATUS,
  FRESH_OK_MS,
  FRESH_WARN_MS,
};
