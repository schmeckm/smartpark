const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pdmSimNumericAt,
  isPdSimMetricName,
  buildSimulatedSparkplugMetricRows,
  buildSimulatedSparkplugSeries,
  PDM_SIM_METRIC_DEFS,
} = require('./pdm-sparkplug-simulator.service');

test('pdmSimNumericAt is deterministic per timestamp', () => {
  const t = 1_704_000_000_000;
  const a = pdmSimNumericAt('asset-a', 'motor_rpm', t);
  const b = pdmSimNumericAt('asset-a', 'motor_rpm', t);
  assert.equal(a, b);
  assert.ok(typeof a === 'number' && Number.isFinite(a));
});

test('different assets produce different motor_rpm', () => {
  const t = 1_704_000_000_000;
  const a = pdmSimNumericAt('11111111-1111-1111-1111-111111111111', 'motor_rpm', t);
  const b = pdmSimNumericAt('22222222-2222-2222-2222-222222222222', 'motor_rpm', t);
  assert.notEqual(a, b);
});

test('isPdSimMetricName matches catalog', () => {
  assert.equal(isPdSimMetricName('motor_rpm'), true);
  assert.equal(isPdSimMetricName('pump_rpm'), true);
  assert.equal(isPdSimMetricName('motor_temp_a'), false);
});

test('motor_rpm and pump_rpm stay inside nominal bands', () => {
  const t = 1_704_000_000_000;
  const motor = pdmSimNumericAt('aid-motor', 'motor_rpm', t);
  const pump = pdmSimNumericAt('aid-pump', 'pump_rpm', t);
  assert.ok(motor >= 600 && motor <= 1800 * 1.06 + 1);
  assert.ok(pump >= 900 && pump <= 3200 * 1.06 + 1);
});

test('buildSimulatedSparkplugMetricRows returns all catalog metrics', () => {
  const rows = buildSimulatedSparkplugMetricRows('aid', 'devseg');
  assert.equal(rows.length, PDM_SIM_METRIC_DEFS.length);
  assert.ok(rows.every((r) => r.source === 'simulated'));
});

test('buildSimulatedSparkplugSeries is chronological ascending', () => {
  const pts = buildSimulatedSparkplugSeries('aid', 'motor_power_kw', { points: 20, stepSeconds: 60 });
  assert.equal(pts.length, 20);
  for (let i = 1; i < pts.length; i += 1) {
    assert.ok(Date.parse(pts[i].t) > Date.parse(pts[i - 1].t));
    assert.ok(Number.isFinite(pts[i].v));
  }
});
