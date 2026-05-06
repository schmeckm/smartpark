/* eslint-disable no-console */
/**
 * Smoke: GET /api/v1/ai/feature-data-quality (requires running API + DB).
 * Usage: node scripts/smoke-ai-feature-data-quality.js [internalParkUuid]
 * Env: API_URL, SKIP_WAIT=1 (skip /ai/health wait; exit 2 = API unreachable during wait only)
 */
async function waitForApi(base, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${base}/api/v1/ai/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error(`API not reachable at ${base} (waited ${ms}ms). Start the API or set SKIP_WAIT=1.`);
}

async function main() {
  const base = process.env.API_URL || 'http://127.0.0.1:3000';
  if (process.env.SKIP_WAIT !== '1') {
    try {
      await waitForApi(base);
    } catch (e) {
      console.error(e.message || e);
      process.exit(2);
    }
  }
  const parkId = process.argv[2] || process.env.X_PARK_ID;
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartpark.com', password: 'Smartpark123!' }),
  });
  const lj = await login.json();
  if (!lj.success) throw new Error(`login: ${lj.message}`);
  const token = lj.data.accessToken;

  let pid = parkId;
  if (!pid) {
    const pr = await fetch(`${base}/api/v1/parks`, { headers: { Authorization: `Bearer ${token}` } });
    const pj = await pr.json();
    pid = pj.data?.[0]?.id;
  }
  if (!pid) throw new Error('No park id: pass argv[1] or set X_PARK_ID');

  const queries = [
    '',
    'entityType=RIDE',
    'completenessMax=0.99',
    'missingFeature=weather',
    'missingFeature=calendar',
    'missingFeature=traffic',
    'missingFeature=staffing',
    'confidenceMax=0.9',
  ];
  for (const q of queries) {
    const url = `${base}/api/v1/ai/feature-data-quality${q ? `?${q}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': pid } });
    const j = await r.json();
    console.log(q || '(no query)', r.status, j.success ? 'ok' : j.message);
    if (j.success) {
      console.log(
        '  kpis',
        j.data.kpis,
        'tables',
        j.data.parkFeatureQuality?.length,
        j.data.rideFeatureQuality?.length,
        j.data.assetsMissingMlProfile?.length,
        j.data.lowConfidenceForecasts?.length
      );
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
