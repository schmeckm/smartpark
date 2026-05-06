'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeScores, buildAiRecommendations } = require('./sqdc-board.service');

describe('sqdc-board.service', () => {
  it('computeScores penalizes incidents and safety events', () => {
    const s = computeScores({
      incidents: [{ severity: 'HIGH' }, { severity: 'MEDIUM' }],
      sqdcEvents: [{ eventType: 'SAFETY', severity: 'LOW' }],
      oee01: null,
      queueMinutes: null,
      avgMood1to5: null,
    });
    assert.ok(s.safety < 100);
    assert.ok(typeof s.overall === 'number');
  });

  it('computeScores uses OEE when present', () => {
    const s = computeScores({
      incidents: [],
      sqdcEvents: [],
      oee01: 0.92,
      queueMinutes: null,
      avgMood1to5: null,
    });
    assert.equal(s.delivery, 92);
  });

  it('buildAiRecommendations includes queue and critical safety', () => {
    const r = buildAiRecommendations({
      scores: { safety: 50, quality: 80, delivery: 80, customer: 80, overall: 72 },
      openCritical: 1,
      queueMinutes: 90,
      oee01: 0.5,
      avgMood1to5: null,
    });
    assert.ok(r.length >= 1);
    assert.ok(r.some((x) => x.category === 'DELIVERY' || x.category === 'SAFETY'));
  });

  it('buildAiRecommendations reacts to low mood', () => {
    const r = buildAiRecommendations({
      scores: { safety: 90, quality: 90, delivery: 90, customer: 90, overall: 90 },
      openCritical: 0,
      queueMinutes: null,
      oee01: null,
      avgMood1to5: 1.5,
    });
    assert.ok(r.some((x) => x.category === 'PEOPLE'));
  });

  it('buildAiRecommendations flags open unplanned downtime', () => {
    const r = buildAiRecommendations({
      scores: { safety: 90, quality: 90, delivery: 90, customer: 90, overall: 90 },
      openCritical: 0,
      queueMinutes: null,
      oee01: null,
      avgMood1to5: null,
      openUnplannedDowntime: 1,
    });
    assert.ok(r.some((x) => x.message.includes('downtime')));
  });
});
