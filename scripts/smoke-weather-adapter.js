/**
 * Smoke: weather_open_meteo adapter (poll + Sparkplug/UNS encode, no MQTT).
 * Run: npm run smoke:weather-adapter
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

function isQueueTimeLike(obs) {
  const et = String(obs.eventType || '').toUpperCase();
  const m = String(obs.metric || '').toLowerCase();
  const d = String(obs.domain || '').toLowerCase();
  if (et.includes('QUEUE') && et.includes('TIME')) return true;
  if (m === 'queue_time' || m === 'wait_time') return true;
  if (d === 'queue' || d === 'queues') return true;
  return false;
}

function main() {
  const config = {
    parkSlug: 'europapark',
    latitude: 48.2661,
    longitude: 7.7225,
    timezone: 'Europe/Berlin',
  };
  const context = {
    parkSlug: config.parkSlug,
    sparkplugGroupId: 'europa_park',
    sparkplugEdgeNode: 'weather_gateway',
  };

  const runtime = new AdapterRuntimeService();
  return runtime
    .runLocal({
      adapterKey: 'weather_open_meteo',
      mode: 'poll',
      config,
      context,
      profiles: ['SPARKPLUG_JSON', 'UNS_JSON'],
      emit: false,
    })
    .then((data) => {
      if (!data.success) {
        console.error('FAIL: run not successful', data.errors);
        process.exit(1);
      }

      const obs = data.observations || [];
      const hasTemp = obs.some((o) => o.metric === 'temperature' && o.value != null);
      if (!hasTemp) {
        console.error('FAIL: expected at least one temperature observation with a value');
        process.exit(1);
      }

      for (const o of obs) {
        if (isQueueTimeLike(o)) {
          console.error('FAIL: queue-time-like observation must not appear:', o);
          process.exit(1);
        }
      }

      const flat = flattenEncoded(data.encodedOutputs);
      const sparkplugRows = flat.filter((r) => r.profile === 'sparkplug_json' && !r.error);
      const sparkplugTopic = sparkplugRows.find(
        (r) => typeof r.topic === 'string' && r.topic === 'spBv1.0/europa_park/DDATA/weather_gateway/current'
      );
      if (!sparkplugTopic) {
        console.error(
          'FAIL: expected Sparkplug topic spBv1.0/europa_park/DDATA/weather_gateway/current',
          sparkplugRows.map((r) => r.topic)
        );
        process.exit(1);
      }

      const names = new Set();
      for (const row of sparkplugRows) {
        const metricName = row?.payload?.metrics?.[0]?.name;
        if (typeof metricName === 'string') names.add(metricName);
      }
      const expected = ['temperature', 'rain_probability', 'rain_mm', 'wind_speed', 'weather_condition'];
      const missing = expected.filter((m) => !names.has(m));
      if (missing.length) {
        console.error('FAIL: missing expected Sparkplug metrics in payload.metrics:', missing, [...names]);
        process.exit(1);
      }

      const unsTemp = flat.find(
        (r) =>
          r.profile === 'uns_json' &&
          typeof r.topic === 'string' &&
          r.topic.includes('/weather/current/temperature')
      );
      if (!unsTemp || unsTemp.error) {
        console.error('FAIL: expected UNS_JSON topic containing /weather/current/temperature', flat);
        process.exit(1);
      }

      console.log('PASS: weather adapter smoke (Sparkplug topic+metrics, UNS topic, no queue-time)');
      process.exit(0);
    })
    .catch((e) => {
      console.error('FAIL:', e.message || e);
      process.exit(1);
    });
}

main();
