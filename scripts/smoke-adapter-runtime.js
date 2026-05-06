/**
 * Smoke test: local adapter runtime (no HTTP server).
 * Run: npm run smoke:adapter-runtime
 */
/* eslint-disable no-console */
require('dotenv').config();

const path = require('node:path');

// Load app env (JWT etc. not required for this script)
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
  const runtime = new AdapterRuntimeService();
  return runtime
    .runLocal({
      adapterKey: 'demo_static_adapter',
      mode: 'poll',
      config: {},
      context: { parkSlug: 'europapark' },
      profiles: ['UNS_JSON', 'SPARKPLUG_JSON', 'CANONICAL_HISTORIAN'],
      emit: false,
    })
    .then((data) => {
      const obs = data.observations || [];
      if (obs.length < 3) {
        console.error(`FAIL: expected >= 3 observations, got ${obs.length}`);
        process.exit(1);
      }

      const flat = flattenEncoded(data.encodedOutputs);
      const uns = flat.find((r) => r.profile === 'uns_json' && typeof r.topic === 'string' && r.topic.startsWith('tpuns/'));
      if (!uns) {
        console.error('FAIL: missing UNS JSON encoded topic (tpuns/...)');
        process.exit(1);
      }

      const sp = flat.find(
        (r) => r.profile === 'sparkplug_json' && typeof r.topic === 'string' && r.topic.startsWith('spBv1.0/')
      );
      if (!sp) {
        console.error('FAIL: missing Sparkplug-style topic (spBv1.0/...)');
        process.exit(1);
      }

      const canon = flat.find((r) => r.profile === 'canonical_historian' && Array.isArray(r.canonicalMessages));
      if (!canon) {
        console.error('FAIL: missing canonical historian encoder output');
        process.exit(1);
      }

      console.log('PASS: adapter runtime smoke (poll, validate, encode, emit=false)');
      process.exit(0);
    })
    .catch((e) => {
      console.error('FAIL:', e.message || e);
      process.exit(1);
    });
}

main();
