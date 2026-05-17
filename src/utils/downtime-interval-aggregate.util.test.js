const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sumDowntimeMsInIntervals,
  availabilityPctFromDowntime,
} = require('./downtime-interval-aggregate.util');

describe('downtime-interval-aggregate', () => {
  it('sums unplanned overlap only inside operating intervals', () => {
    const intervals = [{ startMs: 0, endMs: 6 * 3600000 }];
    const rows = [
      {
        startedAt: new Date(3600000),
        endedAt: new Date(2 * 3600000),
        planned: false,
      },
    ];
    const { unplannedMs } = sumDowntimeMsInIntervals(rows, intervals, new Date(6 * 3600000));
    assert.equal(unplannedMs, 3600000);
    const pct = availabilityPctFromDowntime(6 * 3600000, unplannedMs);
    assert.equal(Math.round(pct * 10) / 10, 83.3);
  });

  it('ignores downtime outside operating window', () => {
    const intervals = [{ startMs: 5 * 3600000, endMs: 10 * 3600000 }];
    const rows = [
      {
        startedAt: new Date(0),
        endedAt: new Date(2 * 3600000),
        planned: false,
      },
    ];
    const { unplannedMs } = sumDowntimeMsInIntervals(rows, intervals, new Date(10 * 3600000));
    assert.equal(unplannedMs, 0);
  });
});
