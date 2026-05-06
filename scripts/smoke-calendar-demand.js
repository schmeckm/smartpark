/**
 * Smoke: calendar_demand adapter (Nager.at + YAML, poll + Sparkplug encode, no MQTT).
 * Run: npm run smoke:calendar-demand
 */
/* eslint-disable no-console */
require('dotenv').config();

const path = require('node:path');

require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { AdapterRuntimeService } = require(path.join(__dirname, '..', 'src', 'services', 'adapter-runtime.service.js'));

function flattenEncoded(encodedOutputs) {
  const rows = [];
  for (const block of encodedOutputs || []) {
    for (const r of block.results || []) rows.push(r);
  }
  return rows;
}

function main() {
  const config = {
    parkSlug: 'europapark',
    countrySet: ['DE', 'FR', 'CH'],
    regionWeights: {
      'DE-BW': 40,
      'FR-GrandEst': 30,
      'CH-BS': 15,
      'CH-BL': 10,
      'CH-AG': 5,
    },
    timezone: 'Europe/Berlin',
    dateOverride: '2025-12-25',
  };
  const context = {
    parkSlug: config.parkSlug,
    sparkplugGroupId: 'europa_park',
    sparkplugEdgeNode: 'calendar_gateway',
  };

  const runtime = new AdapterRuntimeService();
  return runtime
    .runLocal({
      adapterKey: 'calendar_demand',
      mode: 'poll',
      config,
      context,
      profiles: ['SPARKPLUG_JSON', 'UNS_JSON'],
      emit: false,
    })
    .then((data) => {
      if (!data.success) {
        console.error('FAIL: run not successful', data.errors, data.validationErrors);
        process.exit(1);
      }

      const obs = data.observations || [];
      if (obs.length !== 10) {
        console.error(`FAIL: expected 10 observations, got ${obs.length}`);
        process.exit(1);
      }

      const pub = obs.find((o) => o.metric === 'is_public_holiday');
      if (!pub || pub.value !== 1) {
        console.error('FAIL: expected is_public_holiday === 1 on 2025-12-25', pub);
        process.exit(1);
      }

      const score = obs.find((o) => o.metric === 'holiday_score');
      if (!score || typeof score.value !== 'number' || score.value < 70) {
        console.error('FAIL: expected holiday_score >= 70 when DE+FR+CH public holiday', score);
        process.exit(1);
      }

      const flat = flattenEncoded(data.encodedOutputs);
      const sparkplugRows = flat.filter((r) => r.profile === 'sparkplug_json' && !r.error);
      const topicOk = sparkplugRows.some(
        (r) => typeof r.topic === 'string' && r.topic === 'spBv1.0/europa_park/DDATA/calendar_gateway/current'
      );
      if (!topicOk) {
        console.error(
          'FAIL: expected Sparkplug topic spBv1.0/europa_park/DDATA/calendar_gateway/current',
          sparkplugRows.map((r) => r.topic)
        );
        process.exit(1);
      }

      const names = new Set();
      for (const row of sparkplugRows) {
        const metricName = row?.payload?.metrics?.[0]?.name;
        if (typeof metricName === 'string') names.add(metricName);
      }
      const expected = [
        'is_weekend',
        'is_public_holiday',
        'is_school_holiday',
        'bridge_day',
        'month',
        'weekday',
        'season_summer',
        'season_halloween',
        'season_winter',
        'holiday_score',
      ];
      const missing = expected.filter((m) => !names.has(m));
      if (missing.length) {
        console.error('FAIL: missing Sparkplug metrics:', missing, [...names]);
        process.exit(1);
      }

      console.log('PASS: calendar_demand smoke (CALENDAR_OBSERVED, Sparkplug topic+metrics, Nager+YAML)');
      process.exit(0);
    })
    .catch((e) => {
      console.error('FAIL:', e.message || e);
      process.exit(1);
    });
}

main();
