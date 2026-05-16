'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildStudioResolutionExplanation,
  activeRow,
  bestMaeRow,
} = require('./ai-studio-runtime-resolution.util');

function row(partial) {
  return {
    id: 'x',
    modelScope: 'entity',
    entityType: 'RIDE',
    entityId: null,
    targetVariable: 'wait_time_minutes',
    version: 1,
    algorithm: 'linear_regression',
    activeFlag: false,
    archivedAt: null,
    mae: 10,
    r2: 0.5,
    ...partial,
  };
}

test('final pick prefers active entity over better inactive entity', () => {
  const entityCandidates = [
    row({ id: 'a', version: 2, mae: 5, activeFlag: false }),
    row({ id: 'b', version: 1, mae: 20, activeFlag: true }),
  ];
  const out = buildStudioResolutionExplanation({
    canonicalEntityId: 'ride-1',
    entityType: 'RIDE',
    entityCandidates,
    categoryCandidates: [],
    parkCandidates: [],
  });
  assert.equal(out.final.level, 'entity');
  assert.equal(out.final.model?.id, 'b');
  assert.match(out.final.reason, /active/i);
  const ent = out.levels.find((l) => l.level === 'entity');
  assert.ok(ent.bestMaeModel && ent.bestMaeModel.id === 'a');
  assert.ok(ent.activeModel && ent.activeModel.id === 'b');
});

test('best MAE alone does not win: category active beats missing entity active when entity has only inactive best', () => {
  const entityCandidates = [row({ id: 'a', modelScope: 'entity', entityId: 'ride-1', mae: 1, activeFlag: false })];
  const categoryCandidates = [row({ id: 'c', modelScope: 'category', entityId: null, mae: 99, activeFlag: true })];
  const out = buildStudioResolutionExplanation({
    canonicalEntityId: 'ride-1',
    entityType: 'RIDE',
    entityCandidates,
    categoryCandidates,
    parkCandidates: [],
  });
  assert.equal(out.final.level, 'category');
  assert.equal(out.final.model?.id, 'c');
});

test('archived rows ignored for active and best MAE', () => {
  const entityCandidates = [
    row({ id: 'arc', mae: 1, activeFlag: true, archivedAt: '2020-01-01T00:00:00.000Z' }),
    row({ id: 'ok', mae: 10, activeFlag: true, archivedAt: null }),
  ];
  assert.equal(activeRow(entityCandidates)?.id, 'ok');
  assert.equal(bestMaeRow(entityCandidates)?.id, 'ok');
});

test('FEATURE_STORE-style single path: explanation includes levels and rules_fallback when nothing active', () => {
  const out = buildStudioResolutionExplanation({
    canonicalEntityId: 'ride-1',
    entityType: 'RIDE',
    entityCandidates: [row({ id: 'only', mae: 3, activeFlag: false })],
    categoryCandidates: [],
    parkCandidates: [],
  });
  assert.equal(out.final.level, 'rules_fallback');
  assert.equal(out.final.model, null);
  assert.match(out.final.reason, /rules_fallback|heuristic|rules/i);
  const entityLevel = out.levels.find((l) => l.level === 'entity');
  assert.ok(entityLevel);
  assert.match(entityLevel.reason, /none are active|active/i);
});

test('help.bestVsActive documents metrics vs runtime', () => {
  const out = buildStudioResolutionExplanation({
    canonicalEntityId: null,
    entityType: 'WHOLE_PARK',
    entityCandidates: [],
    categoryCandidates: [],
    parkCandidates: [],
  });
  assert.equal(
    out.help.bestVsActive,
    'Best model means best evaluation metrics. Active model means used at runtime.'
  );
});

test('WHOLE_PARK skips entity and category; park active wins', () => {
  const out = buildStudioResolutionExplanation({
    canonicalEntityId: null,
    entityType: 'WHOLE_PARK',
    entityCandidates: [],
    categoryCandidates: [],
    parkCandidates: [row({ id: 'p', modelScope: 'park', entityType: 'WHOLE_PARK', entityId: null, activeFlag: true })],
  });
  assert.equal(out.final.level, 'park');
  assert.equal(out.final.model?.id, 'p');
});
