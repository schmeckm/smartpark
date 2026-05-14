'use strict';

/**
 * Read-only diagnostic counts + latest rows for ride_feature_snapshots_5m (operators / admins).
 */

const { sequelize } = require('../../db/sequelize');
const { AppError } = require('../../utils/app-error');
const { sqlHasNumericWait } = require('../../utils/ride-feature-snapshot-sql.util');

function clampWindowHours(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 2;
  return Math.min(72, Math.max(1, Math.floor(x)));
}

/** @param {unknown} x */
function isoOrNull(x) {
  if (x == null || x === '') return null;
  const d = x instanceof Date ? x : new Date(x);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** @param {unknown} v */
function decimalStr(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

/** Accept PG/driver quirks so diagnostic booleans don't all surface as "—". */
function boolOrNull(v) {
  if (v === true || v === false) return Boolean(v);
  if (v === 0 || v === 1) return v === 1;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 't' || s === 'true' || s === '1') return true;
  if (s === 'f' || s === 'false' || s === '0') return false;
  return null;
}

/**
 * @param {{ parkId: string, rideId: string, windowHours?: number }} opts
 */
async function getMlFeatureStoreSnapshotDebug(opts) {
  const parkId = opts.parkId != null ? String(opts.parkId).trim() : '';
  const rideId = opts.rideId != null ? String(opts.rideId).trim() : '';
  if (!parkId) {
    throw new AppError('Park context required', 400, { code: 'PARK_REQUIRED' });
  }
  if (!rideId) {
    throw new AppError('rideId is required', 422, { code: 'RIDE_REQUIRED' });
  }

  const windowHours = clampWindowHours(opts.windowHours);
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 3600 * 1000);
  const hasWaitSql = sqlHasNumericWait('w');
  const repl = { parkId, rideId, windowStart, windowEnd: now };

  /** @type {Array<Record<string, unknown>>} */
  const sumRows = await sequelize.query(
    `
SELECT
  COUNT(*)::int AS total_rows,
  SUM(CASE WHEN ${hasWaitSql} THEN 1 ELSE 0 END)::int AS rows_with_wait,
  SUM(CASE WHEN w.accuracy_eligible THEN 1 ELSE 0 END)::int AS rows_accuracy_eligible,
  MAX(w.snapshot_at) AS latest_in_window
FROM ride_feature_snapshots_5m w
WHERE w.internal_park_id::text = :parkId
  AND w.internal_asset_id::text = :rideId
  AND w.snapshot_at >= :windowStart AND w.snapshot_at <= :windowEnd
`,
    { replacements: repl, type: sequelize.QueryTypes.SELECT }
  );

  const s = sumRows[0] || {};

  /** @type {Array<Record<string, unknown>>} */
  const latestAnyRows = await sequelize.query(
    `
SELECT
  w.snapshot_at AS snapshot_at,
  w.wait_time AS wait_time,
  w.current_wait_time_min AS current_wait_time_min,
  w.accuracy_eligible AS accuracy_eligible,
  w.data_quality_reason AS data_quality_reason,
  w.park_is_open AS park_is_open,
  w.ride_is_open AS ride_is_open,
  w.precipitation_mm AS precipitation_mm,
  w.temperature_c AS temperature_c,
  w.is_school_holiday AS is_school_holiday,
  w.is_public_holiday AS is_public_holiday,
  w.park_crowd_index AS park_crowd_index,
  (
    EXTRACT(DOW FROM (w.snapshot_at AT TIME ZONE 'UTC')) IN (0::numeric, 6::numeric)
  ) AS is_weekend_utc
FROM ride_feature_snapshots_5m w
WHERE w.internal_park_id::text = :parkId
  AND w.internal_asset_id::text = :rideId
ORDER BY w.snapshot_at DESC
LIMIT 15
`,
    { replacements: { parkId, rideId }, type: sequelize.QueryTypes.SELECT }
  );

  /** @type {Array<Record<string, unknown>>} */
  const globalLatestRows = await sequelize.query(
    `
SELECT MAX(w.snapshot_at) AS mx
FROM ride_feature_snapshots_5m w
WHERE w.internal_park_id::text = :parkId
  AND w.internal_asset_id::text = :rideId
`,
    { replacements: { parkId, rideId }, type: sequelize.QueryTypes.SELECT }
  );
  const gx = globalLatestRows[0] || {};

  /** @param {Record<string, unknown>} row */
  function mapRow(row) {
    const r = row;
    return {
      snapshotAt: isoOrNull(r.snapshot_at),
      waitTime: r.wait_time != null && r.wait_time !== '' ? String(r.wait_time) : null,
      currentWaitTimeMin:
        r.current_wait_time_min != null && r.current_wait_time_min !== ''
          ? String(r.current_wait_time_min)
          : null,
      accuracyEligible: r.accuracy_eligible === true || r.accuracy_eligible === false ? Boolean(r.accuracy_eligible) : null,
      dataQualityReason: r.data_quality_reason != null ? String(r.data_quality_reason).trim() || null : null,
      parkIsOpen: r.park_is_open === true || r.park_is_open === false ? Boolean(r.park_is_open) : null,
      rideIsOpen: r.ride_is_open === true || r.ride_is_open === false ? Boolean(r.ride_is_open) : null,
      precipitationMm: decimalStr(r.precipitation_mm),
      temperatureC: decimalStr(r.temperature_c),
      isSchoolHoliday: boolOrNull(r.is_school_holiday),
      isPublicHoliday: boolOrNull(r.is_public_holiday),
      parkCrowdIndex: decimalStr(r.park_crowd_index),
      isWeekendUtc: boolOrNull(r.is_weekend_utc),
    };
  }

  return {
    rideId,
    windowHours,
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    rowsLastWindow: Number(s.total_rows) || 0,
    rowsWithNumericWaitInWindow: Number(s.rows_with_wait) || 0,
    rowsAccuracyEligibleInWindow: Number(s.rows_accuracy_eligible) || 0,
    latestSnapshotAtInWindow: isoOrNull(s.latest_in_window),
    latestSnapshotAtOverall: isoOrNull(gx.mx),
    latestSnapshots: Array.isArray(latestAnyRows) ? latestAnyRows.map((row) => mapRow(/** @type {Record<string, unknown>} */ (row))) : [],
  };
}

module.exports = {
  getMlFeatureStoreSnapshotDebug,
  clampWindowHours,
};
