/**
 * Smoke: ADR forecast + explanation → Ridge predict (± explain) → optional AI Studio FEATURE_STORE predict.
 *
 * Usage:
 *   node scripts/ai-ml-chain-smoke.mjs
 *
 * Env:
 *   API_URL (default http://127.0.0.1:3000)
 *   ACCESS_TOKEN — JWT; if omitted, tries ADMIN_EMAIL / ADMIN_PASSWORD (defaults match smoke-euromir-e2e.js)
 *   INTERNAL_PARK_ID — X-Park-Id (default from smoke script)
 *   EXTERNAL_PARK_ID, EXTERNAL_ENTITY_ID — ThemeParks-style UUIDs for ADR forecast
 *   RIDE_ID — internal park_assets.asset_id for /ai/ml/predict/rides/:rideId
 *   SKIP_STUDIO=1 — skip POST /ai/studio/predict
 *   SKIP_WAIT=1 — do not block on GET /api/v1/ai/health
 *
 * Exit: 0 pass, 1 assertion failure, 2 API unreachable (when SKIP_WAIT not set)
 */
/* eslint-disable no-console */
const DEFAULT_INTERNAL_PARK = '0519e1e9-9866-481e-b54d-2b81836ff4a2'
const DEFAULT_EXT_PARK = '639738d3-9574-4f60-ab5b-4c392901320b'
/** Euro-Mir external entity id (themeparks_wiki) — see docs/euromir-forecast-regression.md */
const DEFAULT_EXT_ENTITY = 'd1bd3846-b26a-4308-aca8-634a248115ba'

const base = process.env.API_URL || 'http://127.0.0.1:3000'
const internalParkId = process.env.INTERNAL_PARK_ID || DEFAULT_INTERNAL_PARK
const externalParkId = process.env.EXTERNAL_PARK_ID || DEFAULT_EXT_PARK
const externalEntityId = process.env.EXTERNAL_ENTITY_ID || DEFAULT_EXT_ENTITY
const rideIdEnv = process.env.RIDE_ID || process.env.INTERNAL_ASSET_ID || ''

async function waitForHealth(ms = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${base}/api/v1/ai/health`)
      if (r.ok) return
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 600))
  }
  throw new Error(`API not reachable at ${base}`)
}

async function resolveInternalRideId(token) {
  if (rideIdEnv) return rideIdEnv
  const url = `${base}/api/v1/assets?parkId=${encodeURIComponent(internalParkId)}&assetTypeCode=RIDE&limit=500`
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId },
  })
  const j = await r.json().catch(() => ({}))
  const rows = Array.isArray(j.data) ? j.data : []
  const want = String(externalEntityId).toLowerCase()
  const hit = rows.find((a) => String(a.externalEntityId || a.external_entity_id || '').toLowerCase() === want)
  const id = hit?.assetId ?? hit?.asset_id ?? hit?.id ?? null
  return id ? String(id) : null
}

async function tryLogin() {
  const email = process.env.ADMIN_EMAIL || 'admin@smartpark.com'
  const password = process.env.ADMIN_PASSWORD || 'Smartpark123!'
  try {
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const lj = await login.json()
    if (!lj.success) return null
    return lj.data?.accessToken || null
  } catch {
    return null
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function apiGet(path, token, extraHeaders = {}) {
  const r = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Park-Id': internalParkId,
      ...extraHeaders,
    },
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

async function apiPost(path, token, body) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Park-Id': internalParkId,
    },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

async function main() {
  if (process.env.SKIP_WAIT !== '1') {
    try {
      await waitForHealth(30000)
    } catch (e) {
      console.error(String(e.message || e))
      process.exit(2)
    }
  }

  let token = process.env.ACCESS_TOKEN || null
  if (!token) token = await tryLogin()
  if (!token) {
    console.error('No ACCESS_TOKEN and login failed. Set ACCESS_TOKEN or ADMIN_EMAIL/ADMIN_PASSWORD.')
    process.exit(2)
  }

  const rideId = await resolveInternalRideId(token)
  if (!rideId) {
    console.error('Could not resolve internal ride id. Set RIDE_ID or ensure /api/v1/assets lists the ride for this park.')
    process.exit(2)
  }
  console.log('Using internal ride id:', rideId)

  const failures = []

  // 1) ADR park summary
  const parkSum = await apiGet(
    `/api/v1/ai/parks/${encodeURIComponent(externalParkId)}/forecast/summary?provider=themeparks_wiki`,
    token
  )
  if (!parkSum.ok) failures.push(`park forecast summary HTTP ${parkSum.status}`)
  else assert(parkSum.j?.success === true, 'park summary envelope')
  console.log('[1] Park forecast summary:', parkSum.ok ? 'ok' : parkSum.status)

  // 2) Entity forecast explanation
  const expl = await apiGet(
    `/api/v1/ai/entities/${encodeURIComponent(externalEntityId)}/forecast/explanation?externalParkId=${encodeURIComponent(
      externalParkId
    )}&provider=themeparks_wiki&horizon=60`,
    token
  )
  if (!expl.ok) failures.push(`entity forecast explanation HTTP ${expl.status}`)
  else {
    assert(expl.j?.success === true, 'explanation envelope')
    const ex = expl.j.data?.explainability
    assert(ex && typeof ex === 'object', 'missing explainability object')
  }
  console.log('[2] Entity forecast explanation:', expl.ok ? 'ok' : expl.status)

  // 3) Ridge without explain
  const pr0 = await apiGet(`/api/v1/ai/ml/predict/rides/${encodeURIComponent(rideId)}?horizon=60`, token)
  if (!pr0.ok) failures.push(`ridge predict HTTP ${pr0.status}`)
  else {
    assert(pr0.j?.success === true, 'ridge envelope')
    assert(pr0.j.data?.explanation == null, 'ridge without explain must omit explanation')
  }
  console.log('[3] Ridge predict (no explain):', pr0.ok ? 'ok' : pr0.status)

  // 4) Ridge with explain=1
  const pr1 = await apiGet(
    `/api/v1/ai/ml/predict/rides/${encodeURIComponent(rideId)}?horizon=60&explain=1`,
    token
  )
  if (!pr1.ok) failures.push(`ridge predict explain HTTP ${pr1.status}`)
  else {
    assert(pr1.j?.success === true, 'ridge explain envelope')
    const ex = pr1.j.data?.explanation
    assert(ex && typeof ex === 'object', 'ridge explain=1 must include explanation object')
  }
  console.log('[4] Ridge predict (?explain=1):', pr1.ok ? 'ok' : pr1.status)

  // 5) Optional AI Studio predict (FEATURE_STORE / latest snapshot)
  if (process.env.SKIP_STUDIO === '1') {
    console.log('[5] AI Studio predict: skipped (SKIP_STUDIO=1)')
  } else {
    const st = await apiPost('/api/v1/ai/studio/predict', token, {
      entityType: 'RIDE',
      entityId: rideId,
      targetVariable: 'wait_time_minutes',
      featureSource: 'latest_snapshot',
      features: {},
    })
    if (!st.ok) {
      console.warn(
        `[5] AI Studio predict: HTTP ${st.status} — set SKIP_STUDIO=1 if no model/snapshots (${st.j?.message || JSON.stringify(st.j).slice(0, 200)})`
      )
    } else {
      assert(st.j?.success === true, 'studio envelope')
      console.log('[5] AI Studio predict (latest_snapshot): ok value=', st.j.data?.value)
    }
  }

  if (failures.length) {
    console.error('Failures:', failures)
    process.exit(1)
  }
  console.log('ai-ml-chain-smoke: all checks passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
