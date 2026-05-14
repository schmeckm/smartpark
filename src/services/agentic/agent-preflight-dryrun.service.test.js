'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dryRunPlanForSkill, summarizeToolOutput } = require('./agent-preflight-dryrun.service');

test('dryRunPlanForSkill returns non-empty plan for supported skills', () => {
  assert.ok(dryRunPlanForSkill('daily_executive_brief').length >= 3);
  assert.ok(dryRunPlanForSkill('weather_pivot').some((s) => s.name === 'read.weather_snapshot'));
  assert.ok(dryRunPlanForSkill('ride_down_response').some((s) => s.name === 'read.rides_operational_snapshot'));
  assert.equal(dryRunPlanForSkill('unknown_skill').length, 0);
});

test('summarizeToolOutput handles forecast and incidents shapes', () => {
  assert.match(summarizeToolOutput('read.forecast_summary', { count: 3 }), /count=3/);
  assert.match(summarizeToolOutput('read.incidents_list', { items: [1, 2] }), /items=2/);
});
