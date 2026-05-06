/**
 * Smoke: opcua_edge adapter in simulate mode (no node-opcua, no broker).
 * Run: node scripts/smoke-opcua-edge-adapter.js
 */
/* eslint-disable no-console */
require('dotenv').config();

const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { AdapterRuntimeService } = require(path.join(__dirname, '..', 'src', 'services', 'adapter-runtime.service.js'));

async function main() {
  const runtime = new AdapterRuntimeService();
  const config = {
    endpointUrl: 'opc.tcp://127.0.0.1:4840/freeopcua/server/',
    live: false,
    subscriptionTags: [
      {
        nodeId: 'ns=2;s=Demo.Tag',
        domain: 'rides',
        assetSlug: 'blue_fire',
        metric: 'queue_time',
        unit: 'min',
        eventType: 'QUEUE_TIME_OBSERVED',
        mockValue: 12,
      },
    ],
  };
  const data = await runtime.runAdapter({
    adapterKey: 'opcua_edge',
    mode: 'poll',
    config,
    context: { parkSlug: 'europa_park' },
    profiles: ['UNS_JSON', 'SPARKPLUG_JSON'],
    emit: false,
  });

  if (!data.success) {
    console.error('FAIL:', data.errors);
    process.exit(1);
  }
  const obs = data.observations || [];
  if (obs.length !== 1 || obs[0].value !== 12 || obs[0].assetSlug !== 'blue_fire') {
    console.error('FAIL: unexpected observations', obs);
    process.exit(1);
  }
  const flat = [];
  for (const block of data.encoded || []) {
    for (const r of block.results || []) flat.push(r);
  }
  const uns = flat.find((r) => r.profile === 'uns_json' && r.topic && r.topic.includes('blue_fire'));
  if (!uns) {
    console.error('FAIL: missing UNS row for blue_fire');
    process.exit(1);
  }
  console.log('PASS: smoke-opcua-edge-adapter');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
