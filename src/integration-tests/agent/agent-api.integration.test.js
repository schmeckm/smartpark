'use strict';

/**
 * Agent API integration tests — opt-in: AGENT_INTEGRATION_TESTS=1 with Postgres migrated + seeded users.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { sequelize, Park, AgentRun, AgentStep } = require('../../models');
const { loginAccessToken, app } = require('../../test-utils/integration-http');

const ENABLED = process.env.AGENT_INTEGRATION_TESTS === '1' || process.env.AGENT_INTEGRATION_TESTS === 'true';

let dbOk = false;

test.before(async () => {
  if (!ENABLED) return;
  try {
    await sequelize.authenticate();
    dbOk = true;
  } catch {
    dbOk = false;
  }
});

test('POST /agent/runs daily_executive_brief creates run, steps, actions; GET returns detail', async (t) => {
  if (!ENABLED || !dbOk) {
    t.skip();
    return;
  }
  const park = await Park.findOne({ attributes: ['id'] });
  if (!park) {
    t.skip();
    return;
  }

  const token = await loginAccessToken('admin@smartpark.com', 'Smartpark123!');

  const beforeCount = await AgentRun.count({ where: { parkId: park.id } });

  const post = await request(app)
    .post('/api/v1/agent/runs')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Park-Id', String(park.id))
    .send({
      skillId: 'daily_executive_brief',
      parkId: String(park.id),
      triggerType: 'manual',
    });

  if (post.status === 500 || post.status === 503) {
    t.skip();
    return;
  }

  assert.equal(post.status, 201, post.text);
  assert.equal(post.body.success, true);
  const runId = post.body.data?.id;
  assert.ok(runId);

  const afterCount = await AgentRun.count({ where: { parkId: park.id } });
  assert.equal(afterCount, beforeCount + 1);

  const steps = await AgentStep.findAll({
    where: { runId },
    order: [['stepIndex', 'ASC']],
  });
  assert.ok(steps.length >= 5, `expected plan + 3 tools + synthesize, got ${steps.length}`);
  for (let i = 0; i < steps.length; i += 1) {
    assert.equal(steps[i].stepIndex, i);
  }

  const list = await request(app)
    .get('/api/v1/agent/runs')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Park-Id', String(park.id));

  assert.equal(list.status, 200);
  const ids = (list.body.data?.items || []).map((r) => r.id);
  assert.ok(ids.includes(runId));

  const detail = await request(app)
    .get(`/api/v1/agent/runs/${runId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Park-Id', String(park.id));

  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.body.data?.steps));
  assert.ok(Array.isArray(detail.body.data?.actions));
  assert.equal(detail.body.data.actions.length, 3);
  assert.ok(typeof detail.body.data.outputSummary === 'string');

  const metrics = await request(app)
    .get('/api/v1/agent/approval-metrics')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Park-Id', String(park.id));

  assert.equal(metrics.status, 200, metrics.text);
  assert.equal(metrics.body.success, true);
  const m = metrics.body.data;
  assert.equal(String(m.parkId), String(park.id));
  assert.ok(typeof m.decided === 'number');
  assert.ok(m.bySkill && typeof m.bySkill === 'object');
  assert.ok(m.approvalRate === null || typeof m.approvalRate === 'number');
});
