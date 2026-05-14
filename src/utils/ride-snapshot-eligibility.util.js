'use strict';

/**
 * Eligibility metadata for ride_feature_snapshots_5m (closed park / ride handling).
 * Snapshots remain stored for audit; ML consumers gate on flags.
 *
 * @param {object} opts
 * @param {boolean|null|undefined} opts.withinScheduledOperatingHours — from park schedule
 * @param {boolean|null|undefined} opts.rideIsOpen — from canonical payload
 * @param {number|null|undefined} opts.ridePayloadWait
 * @returns {{
 *   parkIsOpen: boolean|null,
 *   rideIsOpen: boolean|null,
 *   forecastEligible: boolean,
 *   trainingEligible: boolean,
 *   accuracyEligible: boolean,
 *   dataQualityReason: string|null,
 * }}
 */
function snapshotEligibilityDefaultsForSchedule(opts = {}) {
  const { withinScheduledOperatingHours, rideIsOpen, ridePayloadWait: _wait } = opts;

  let parkIsOpen = null;
  if (withinScheduledOperatingHours === false) parkIsOpen = false;
  else if (withinScheduledOperatingHours === true) parkIsOpen = true;

  let rideIsOpenFlag = null;
  if (rideIsOpen === false) rideIsOpenFlag = false;
  else if (rideIsOpen === true) rideIsOpenFlag = true;

  if (withinScheduledOperatingHours === false) {
    return {
      parkIsOpen: false,
      rideIsOpen: rideIsOpenFlag,
      forecastEligible: false,
      trainingEligible: false,
      accuracyEligible: false,
      dataQualityReason: 'PARK_CLOSED',
    };
  }

  if (rideIsOpen === false) {
    return {
      parkIsOpen,
      rideIsOpen: false,
      forecastEligible: false,
      trainingEligible: false,
      accuracyEligible: false,
      dataQualityReason: 'RIDE_CLOSED',
    };
  }

  return {
    parkIsOpen,
    rideIsOpen: rideIsOpenFlag,
    forecastEligible: true,
    trainingEligible: true,
    accuracyEligible: true,
    dataQualityReason: null,
  };
}

function isForecastEligiblePlain(row) {
  if (!row || typeof row !== 'object') return true;
  const v = row.forecastEligible ?? row.forecast_eligible;
  return v !== false;
}

function isTrainingEligiblePlain(row) {
  if (!row || typeof row !== 'object') return true;
  const v = row.trainingEligible ?? row.training_eligible;
  return v !== false;
}

function isAccuracyEligiblePlain(row) {
  if (!row || typeof row !== 'object') return true;
  const v = row.accuracyEligible ?? row.accuracy_eligible;
  return v !== false;
}

module.exports = {
  snapshotEligibilityDefaultsForSchedule,
  isForecastEligiblePlain,
  isTrainingEligiblePlain,
  isAccuracyEligiblePlain,
};
