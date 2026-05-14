'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  snapshotEligibilityDefaultsForSchedule,
  isForecastEligiblePlain,
  isTrainingEligiblePlain,
  isAccuracyEligiblePlain,
} = require('../utils/ride-snapshot-eligibility.util');

describe('ride-snapshot-eligibility.util', () => {
  it('marks PARK_CLOSED when scheduled hours say park closed', () => {
    const e = snapshotEligibilityDefaultsForSchedule({
      withinScheduledOperatingHours: false,
      rideIsOpen: true,
      ridePayloadWait: 10,
    });
    assert.equal(e.dataQualityReason, 'PARK_CLOSED');
    assert.equal(e.forecastEligible, false);
    assert.equal(e.trainingEligible, false);
    assert.equal(e.accuracyEligible, false);
    assert.equal(e.parkIsOpen, false);
  });

  it('marks RIDE_CLOSED when ride explicitly closed and park open', () => {
    const e = snapshotEligibilityDefaultsForSchedule({
      withinScheduledOperatingHours: true,
      rideIsOpen: false,
      ridePayloadWait: 5,
    });
    assert.equal(e.dataQualityReason, 'RIDE_CLOSED');
    assert.equal(e.forecastEligible, false);
    assert.equal(e.rideIsOpen, false);
  });

  it('keeps eligible when park and ride open', () => {
    const e = snapshotEligibilityDefaultsForSchedule({
      withinScheduledOperatingHours: true,
      rideIsOpen: true,
      ridePayloadWait: 12,
    });
    assert.equal(e.dataQualityReason, null);
    assert.equal(e.forecastEligible, true);
    assert.equal(e.trainingEligible, true);
    assert.equal(e.accuracyEligible, true);
  });

  it('plain-object guards treat missing flags as eligible', () => {
    assert.equal(isForecastEligiblePlain({}), true);
    assert.equal(isTrainingEligiblePlain({}), true);
    assert.equal(isAccuracyEligiblePlain({}), true);
    assert.equal(isForecastEligiblePlain({ forecastEligible: false }), false);
  });
});
