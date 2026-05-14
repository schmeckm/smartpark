'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  computeSchedulerBlock,
  computeLastPipelineBlock,
  computeSnapshotCoverageBlock,
  computeWaitCoverageBlock,
  computeAccuracyEligibilityBlock,
  STATUS,
  FRESH_OK_MS,
  getMlFeatureStoreReadiness,
} = require('./ml-feature-store-readiness.service');
const { AppError } = require('../../utils/app-error');

describe('computeSchedulerBlock', () => {
  it('returns OK when AI sampling enabled', () => {
    const b = computeSchedulerBlock(true, 'ENV');
    assert.equal(b.enabled, true);
    assert.equal(b.source, 'ENV');
    assert.equal(b.status, STATUS.OK);
  });

  it('returns CRITICAL when AI sampling disabled', () => {
    const b = computeSchedulerBlock(false, 'DEFAULT');
    assert.equal(b.enabled, false);
    assert.equal(b.source, 'DEFAULT');
    assert.equal(b.status, STATUS.CRITICAL);
  });
});

describe('computeLastPipelineBlock', () => {
  it('detects CRITICAL when no finished run exists', () => {
    assert.equal(computeLastPipelineBlock(null).status, STATUS.CRITICAL);
    assert.strictEqual(
      computeLastPipelineBlock({ finishedAt: null }).lastRunAt,
      null
    );
  });

  it('detects WARNING when featureStoreError present', () => {
    const t = new Date('2026-05-01T12:00:00.000Z');
    const b = computeLastPipelineBlock({
      finishedAt: t,
      rideSnapshotsWritten: 3,
      featureStoreError: 'snapshot writer failed',
    });
    assert.equal(b.status, STATUS.WARNING);
    assert.ok(b.featureStoreError);
  });

  it('detects OK when last run has no feature store error', () => {
    const t = new Date('2026-05-01T12:00:00.000Z');
    const b = computeLastPipelineBlock({
      finishedAt: t,
      rideSnapshotsWritten: 120,
      featureStoreError: null,
    });
    assert.equal(b.status, STATUS.OK);
    assert.equal(b.rideSnapshotsWritten, 120);
  });
});

describe('computeSnapshotCoverageBlock', () => {
  const now = Date.parse('2026-06-15T13:00:00.000Z');

  it('detects CRITICAL when no snapshots', () => {
    const b = computeSnapshotCoverageBlock(
      { totalRows: 0, ridesWithSnapshots: 0, latestSnapshotAt: null },
      now
    );
    assert.equal(b.status, STATUS.CRITICAL);
  });

  it('detects OK when snapshots fresh', () => {
    const latest = new Date(now - FRESH_OK_MS / 2);
    const b = computeSnapshotCoverageBlock(
      { totalRows: 50, ridesWithSnapshots: 5, latestSnapshotAt: latest },
      now
    );
    assert.equal(b.status, STATUS.OK);
    assert.strictEqual(typeof b.latestSnapshotAt, 'string');
  });

  it('detects WARNING when staleness exceeds OK band only', () => {
    const latest = new Date(now - FRESH_OK_MS - 5 * 60 * 1000);
    const b = computeSnapshotCoverageBlock(
      { totalRows: 10, ridesWithSnapshots: 2, latestSnapshotAt: latest },
      now
    );
    assert.equal(b.status, STATUS.WARNING);
  });
});

describe('computeWaitCoverageBlock', () => {
  it('maps >=70 coverage to OK', () => {
    const b = computeWaitCoverageBlock({ totalRows: 100, rowsWithWaitTime: 71 });
    assert.equal(b.coveragePercent, 71);
    assert.equal(b.status, STATUS.OK);
  });

  it('maps 30–69 to WARNING', () => {
    assert.equal(
      computeWaitCoverageBlock({ totalRows: 100, rowsWithWaitTime: 42 }).status,
      STATUS.WARNING
    );
  });

  it('maps <30 to CRITICAL when rows exist', () => {
    const b = computeWaitCoverageBlock({ totalRows: 100, rowsWithWaitTime: 10 });
    assert.equal(b.status, STATUS.CRITICAL);
  });

  it('computes CRITICAL with zero rows', () => {
    const b = computeWaitCoverageBlock({ totalRows: 0, rowsWithWaitTime: 0 });
    assert.equal(b.coveragePercent, 0);
    assert.equal(b.status, STATUS.CRITICAL);
  });
});

describe('computeAccuracyEligibilityBlock', () => {
  it('treats dominant closed-period rows as WARNING not CRITICAL', () => {
    const b = computeAccuracyEligibilityBlock({
      totalRows: 400,
      eligibleRows: 0,
      topReasons: [
        { reason: 'PARK_CLOSED', count: 350 },
        { reason: 'OTHER_INELIGIBLE', count: 50 },
      ],
    });
    assert.equal(b.status, STATUS.WARNING);
    assert.strictEqual(b.ineligibleRows, 400);
  });

  it('returns OK when eligible rows exist', () => {
    const b = computeAccuracyEligibilityBlock({
      totalRows: 120,
      eligibleRows: 12,
      topReasons: [{ reason: 'NO_WAIT_TIME', count: 80 }],
    });
    assert.equal(b.status, STATUS.OK);
  });

  it('returns CRITICAL when NO_WAIT_TIME dominates open-period rows', () => {
    const b = computeAccuracyEligibilityBlock({
      totalRows: 200,
      eligibleRows: 0,
      topReasons: [{ reason: 'NO_WAIT_TIME', count: 200 }],
    });
    assert.equal(b.status, STATUS.CRITICAL);
  });
});

describe('getMlFeatureStoreReadiness', () => {
  it('rejects empty park id', async () => {
    await assert.rejects(
      async () => await getMlFeatureStoreReadiness({ parkId: '' }),
      (e) => e instanceof AppError
    );
  });
});
