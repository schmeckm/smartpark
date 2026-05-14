'use strict';

/**
 * Shared Postgres SQL fragments for `ride_feature_snapshots_5m` analytics.
 */

/** Postgres fragment: row has numeric wait in wait_time OR current_wait_time_min (alias e.g. `w`). */
function sqlHasNumericWait(alias = 'w') {
  const a = alias;
  const rxNum = '^-?[0-9]+(\\.[0-9]+)?$';
  return `(
  (${a}.wait_time IS NOT NULL AND btrim(${a}.wait_time::text) <> '' AND ${a}.wait_time::text ~ '${rxNum}')
  OR (${a}.current_wait_time_min IS NOT NULL AND btrim(${a}.current_wait_time_min::text) <> ''
      AND ${a}.current_wait_time_min::text ~ '${rxNum}')
)`;
}

module.exports = {
  sqlHasNumericWait,
};
