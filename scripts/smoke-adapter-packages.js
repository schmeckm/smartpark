/**
 * Smoke: filesystem scan + demo adapter poll (no HTTP).
 * Run: npm run smoke:adapters
 */
/* eslint-disable no-console */
require('dotenv').config();

const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { AdapterPackageLoaderService } = require(path.join(__dirname, '..', 'src', 'services', 'adapter-package-loader.service.js'));
const { AdapterRuntimeService } = require(path.join(__dirname, '..', 'src', 'services', 'adapter-runtime.service.js'));

function flattenEncoded(encodedBlocks) {
  const rows = [];
  for (const block of encodedBlocks || []) {
    for (const r of block.results || []) rows.push(r);
  }
  return rows;
}

async function main() {
  const loader = new AdapterPackageLoaderService();
  const scanned = loader.scanPackages();
  if (!Array.isArray(scanned) || scanned.length < 1) {
    console.error('FAIL: scanPackages() should list at least one integration package');
    process.exit(1);
  }

  const demo = scanned.find((p) => p.adapterKey === 'demo_static_adapter');
  if (!demo) {
    console.error('FAIL: demo_static_adapter missing from scan');
    process.exit(1);
  }

  const runtime = new AdapterRuntimeService();
  const data = await runtime.runAdapter({
    adapterKey: 'demo_static_adapter',
    mode: 'poll',
    config: {},
    context: { parkSlug: 'europapark' },
    profiles: ['UNS_JSON', 'SPARKPLUG_JSON', 'CANONICAL_HISTORIAN'],
    emit: false,
  });

  const obs = data.observations || [];
  if (obs.length < 3) {
    console.error(`FAIL: expected >= 3 observations, got ${obs.length}`);
    process.exit(1);
  }

  const flat = flattenEncoded(data.encoded);
  const uns = flat.find((r) => r.profile === 'uns_json' && typeof r.topic === 'string' && r.topic.startsWith('tpuns/'));
  if (!uns) {
    console.error('FAIL: missing UNS encoded topic');
    process.exit(1);
  }
  const sp = flat.find(
    (r) => r.profile === 'sparkplug_json' && typeof r.topic === 'string' && r.topic.startsWith('spBv1.0/')
  );
  if (!sp) {
    console.error('FAIL: missing Sparkplug encoded topic');
    process.exit(1);
  }
  const canon = flat.find((r) => r.profile === 'canonical_historian' && Array.isArray(r.canonicalMessages));
  if (!canon) {
    console.error('FAIL: missing canonical historian output');
    process.exit(1);
  }

  console.log('PASS: smoke-adapter-packages (scan + poll + encoders)');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});
