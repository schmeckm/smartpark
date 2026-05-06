/**
 * Park-wide ride forecast smoke: all active RIDE assets with external_entity_id.
 *
 * Usage:
 *   node scripts/smoke-ride-forecast-all.js [PARK_ID]
 * Env: PARK_ID / INTERNAL_PARK_ID, PROVIDER (default themeparks_wiki),
 *      MIN_SAMPLES (default 1), MAX_FAILURES_ALLOWED (default 0),
 *      LOW_CONFIDENCE_WARN (default 0.25), ZERO_SAMPLES_IS_FAIL (default 1: true),
 *      API_URL, SKIP_WAIT=1, AUTO_REFRESH=1
 *   PowerShell: `$env:MAX_FAILURES_ALLOWED='10'; $env:SKIP_WAIT='1'; node scripts/smoke-ride-forecast-all.js`
 *
 * Writes data/ai-smoke-status.json with rideForecastAll + referenceRides (Euro-Mir, WODAN).
 * Exit: 0 within failure budget, 1 exceeded, 2 API unreachable when wait enabled
 */
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize } = require(path.join(__dirname, '..', 'src', 'db', 'sequelize'));
const {
  Park,
  ParkAsset,
  AssetType,
  RideWaitTimeSample,
  RideFeatureSnapshot,
} = require(path.join(__dirname, '..', 'src', 'models'));
const { Op } = require('sequelize');

const DEFAULT_INTERNAL_PARK = '0519e1e9-9866-481e-b54d-2b81836ff4a2';
const DEFAULT_EXT_PARK = '639738d3-9574-4f60-ab5b-4c392901320b';
const EUROMIR_ENTITY = process.env.EUROMIR_ENTITY_ID || 'd1bd3846-b26a-4308-aca8-634a248115ba';
const WODAN_ENTITY = process.env.WODAN_ENTITY_ID || '686c3cc3-3b30-4033-b245-e0856737bb26';

const STATUS_OUT = path.join(process.cwd(), 'data', 'ai-smoke-status.json');

function num(v, d = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function envBool(name, defaultTrue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultTrue;
  return v === '1' || v === 'true' || v === 'yes';
}

async function waitForApi(base, ms = 60000) {
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
  throw new Error(`API not reachable at ${base} (waited ${ms}ms). Set SKIP_WAIT=1 to skip.`);
}

async function tryLogin(base) {
  try {
    const login = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@smartpark.com', password: 'Smartpark123!' }),
    });
    const lj = await login.json();
    if (!lj.success) return { ok: false, offline: false, message: lj.message || 'login failed' };
    return { ok: true, token: lj.data.accessToken };
  } catch (e) {
    return { ok: false, offline: true, message: e?.message || String(e) };
  }
}

function hintWeather(fdq) {
  if (!Array.isArray(fdq)) return false;
  return fdq.some((h) => /weather|rain|precipitation/i.test(String(h)));
}
function hintTraffic(fdq) {
  if (!Array.isArray(fdq)) return false;
  return fdq.some((h) => /traffic|event calendar|calendar not/i.test(String(h)));
}
function hintStaffing(fdq, row) {
  if (Array.isArray(fdq) && fdq.some((h) => /staffing|staff/i.test(String(h)))) return true;
  const sg = row?.snapshotContext?.staffing?.staffingGapNormal;
  return sg != null && Number.isFinite(Number(sg));
}

async function fetchMl(base, token, parkId, assetId) {
  const r = await fetch(`${base}/api/v1/ai/assets/${encodeURIComponent(assetId)}/effective-ml-config`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': parkId },
  });
  const j = await r.json();
  return { ok: r.ok && j.success, data: j.data || null };
}

async function loadMlMap(base, token, parkId, assets, concurrency = 16) {
  const map = new Map();
  for (let i = 0; i < assets.length; i += concurrency) {
    const slice = assets.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      slice.map(async (a) => {
        const r = await fetchMl(base, token, parkId, a.assetId);
        map.set(a.assetId, r);
      })
    );
  }
  return map;
}

async function referenceRideSmoke(base, token, parkId, extPark, provider, externalEntityId, label) {
  const checkedAt = new Date().toISOString();
  const out = { passed: false, checkedAt, label, summary: {} };
  if (!token) {
    out.summary = { reason: 'no_token' };
    return out;
  }
  const sampleCnt = await RideWaitTimeSample.count({
    where: { provider, externalEntityId },
  });
  const snapCnt = await RideFeatureSnapshot.count({ where: { provider, externalEntityId } });
  const url =
    `${base}/api/v1/ai/parks/${encodeURIComponent(extPark)}/entities/forecast/summary?` +
    `provider=${encodeURIComponent(provider)}&limit=500`; /* Joi parkForecastQuery.max */
  const fr = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': parkId } });
  const fj = await fr.json();
  const row = fr.ok && fj.success ? (fj.data || []).find((x) => String(x.externalEntityId).toLowerCase() === externalEntityId.toLowerCase()) : null;
  const asset = await ParkAsset.findOne({ where: { parkId, externalEntityId, activeFlag: true } });
  let mlOk = false;
  if (asset?.assetId) {
    const ml = await fetchMl(base, token, parkId, asset.assetId);
    mlOk = Boolean(ml.ok && (ml.data?.profile || ml.data?.profileCode));
  }
  const fcOk =
    row &&
    (row.forecast15Minutes != null || row.forecast60Minutes != null) &&
    row.forecastSource &&
    num(row.confidence) != null &&
    Array.isArray(row.featureDataQuality);
  out.passed = Boolean(sampleCnt > 0 && snapCnt > 0 && fcOk && mlOk);
  out.summary = { sampleCnt, snapCnt, hasForecast: Boolean(row), mlOk: Boolean(mlOk) };
  return out;
}

function writeStatusFile(rideForecastAll, refEuromir, refWodan) {
  let existing = {};
  try {
    if (fs.existsSync(STATUS_OUT)) {
      existing = JSON.parse(fs.readFileSync(STATUS_OUT, 'utf8'));
    }
  } catch {
    /* ignore corrupt */
  }
  const next = {
    ...existing,
    rideForecastAll,
    referenceRides: {
      ...(existing.referenceRides || {}),
      euromir: refEuromir,
      wodan: refWodan,
    },
  };
  if (refEuromir?.checkedAt != null) {
    next.euromir = { passed: Boolean(refEuromir.passed), checkedAt: refEuromir.checkedAt };
  }
  if (refWodan?.checkedAt != null) {
    next.wodan = { passed: Boolean(refWodan.passed), checkedAt: refWodan.checkedAt };
  }
  fs.mkdirSync(path.dirname(STATUS_OUT), { recursive: true });
  fs.writeFileSync(STATUS_OUT, JSON.stringify(next, null, 2), 'utf8');
  console.log(`Wrote ${STATUS_OUT}`);
}

async function main() {
  const base = process.env.API_URL || 'http://127.0.0.1:3000';
  const internalParkId =
    process.argv[2] || process.env.PARK_ID || process.env.INTERNAL_PARK_ID || DEFAULT_INTERNAL_PARK;
  const provider = process.env.PROVIDER || 'themeparks_wiki';
  const minSamples = Math.max(1, Number(process.env.MIN_SAMPLES) || 1);
  const mfRaw = process.env.MAX_FAILURES_ALLOWED;
  const maxFailuresAllowed =
    mfRaw !== undefined && mfRaw !== '' && Number.isFinite(Number(mfRaw)) ? Math.max(0, Number(mfRaw)) : 0;
  const lowConfWarn = Number(process.env.LOW_CONFIDENCE_WARN) >= 0 ? Number(process.env.LOW_CONFIDENCE_WARN) : 0.25;
  const zeroSamplesIsFail = envBool('ZERO_SAMPLES_IS_FAIL', true);

  if (process.env.SKIP_WAIT !== '1') {
    try {
      await waitForApi(base, 60000);
    } catch (e) {
      console.error(String(e.message || e));
      process.exit(2);
    }
  }

  const auth = await tryLogin(base);
  const token = auth.ok ? auth.token : null;
  if (!token) {
    console.error(`API login required (offline=${Boolean(auth.offline)}): ${auth.message || 'no token'}`);
    process.exit(1);
  }

  await sequelize.authenticate();
  const park = await Park.findByPk(internalParkId);
  if (!park) {
    console.error('Park not found:', internalParkId);
    process.exit(1);
  }
  const externalParkId = park.externalEntityId || process.env.EXTERNAL_PARK_ID || DEFAULT_EXT_PARK;

  const rides = await ParkAsset.findAll({
    where: {
      parkId: internalParkId,
      activeFlag: true,
      externalEntityId: { [Op.ne]: null },
    },
    include: [{ model: AssetType, as: 'assetType', attributes: ['code'], where: { code: 'RIDE' }, required: true }],
    order: [['name', 'ASC']],
  });

  if (token && process.env.AUTO_REFRESH === '1') {
    const rr = await fetch(`${base}/api/v1/ai/forecasts/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const rj = await rr.json();
    console.log('AUTO_REFRESH:', rj.success ? 'ok' : rj.message || 'fail');
  }

  let forecastRows = [];
  if (token) {
    const url =
      `${base}/api/v1/ai/parks/${encodeURIComponent(externalParkId)}/entities/forecast/summary?` +
      `provider=${encodeURIComponent(provider)}&limit=500`;
    const fr = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId } });
    const fj = await fr.json();
    if (!fr.ok || !fj.success) {
      console.error('Forecast list failed:', fj.message || fr.status);
      process.exit(1);
    }
    forecastRows = fj.data || [];
  }

  const byEntity = new Map(forecastRows.map((r) => [String(r.externalEntityId || '').toLowerCase(), r]));

  const mlMap = token && rides.length ? await loadMlMap(base, token, internalParkId, rides, 16) : new Map();

  const totals = {
    totalRides: rides.length,
    passed: 0,
    failed: 0,
    warnings: 0,
    noSamples: 0,
    noSnapshots: 0,
    noForecast: 0,
    lowConfidence: 0,
    missingMlProfile: 0,
    missingWeather: 0,
    missingTraffic: 0,
    missingStaffing: 0,
  };
  const issueCounts = {};
  const bump = (key) => {
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  };

  for (const asset of rides) {
    const extId = asset.externalEntityId;
    let fail = false;
    let warn = false;

    const sampleCnt = await RideWaitTimeSample.count({ where: { provider, externalEntityId: extId } });
    const snapCnt = await RideFeatureSnapshot.count({ where: { provider, externalEntityId: extId } });
    const row = byEntity.get(String(extId).toLowerCase()) || null;

    if (sampleCnt === 0) {
      totals.noSamples += 1;
      bump('noSamples');
      if (zeroSamplesIsFail) fail = true;
      else warn = true;
    } else if (sampleCnt < minSamples) {
      bump('lowSampleCount');
      warn = true;
    }

    if (snapCnt === 0) {
      totals.noSnapshots += 1;
      bump('noSnapshots');
      fail = true;
    }

    if (!row) {
      totals.noForecast += 1;
      bump('noForecast');
      fail = true;
    } else {
      if (row.forecast15Minutes == null && row.forecast60Minutes == null) {
        bump('noForecastHorizon');
        fail = true;
      }
      if (row.forecastSource == null || row.forecastSource === '') {
        bump('missingForecastSource');
        fail = true;
      }
      if (num(row.confidence) == null) {
        bump('missingConfidence');
        fail = true;
      } else if (num(row.confidence) < lowConfWarn) {
        totals.lowConfidence += 1;
        bump('lowConfidence');
        warn = true;
      }
      if (!Array.isArray(row.featureDataQuality)) {
        bump('missingFeatureDataQuality');
        fail = true;
      } else {
        if (hintWeather(row.featureDataQuality)) {
          totals.missingWeather += 1;
          bump('missingWeather');
          warn = true;
        }
        if (hintTraffic(row.featureDataQuality)) {
          totals.missingTraffic += 1;
          bump('missingTraffic');
          warn = true;
        }
        if (!hintStaffing(row.featureDataQuality, row)) {
          totals.missingStaffing += 1;
          bump('missingStaffing');
          warn = true;
        }
      }
    }

    const ml = mlMap.get(asset.assetId);
    const mlOk = Boolean(ml && ml.ok && (ml.data?.profile || ml.data?.profileCode));
    if (!mlOk) {
      totals.missingMlProfile += 1;
      bump('missingMlProfile');
      fail = true;
    }

    if (fail) {
      totals.failed += 1;
    } else if (warn) {
      totals.warnings += 1;
    } else {
      totals.passed += 1;
    }
  }

  const topIssues = Object.entries(issueCounts)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const checkedAt = new Date().toISOString();
  const overallPass = totals.failed <= maxFailuresAllowed;
  const rideForecastAll = {
    passed: overallPass,
    checkedAt,
    summary: {
      totalRides: totals.totalRides,
      passed: totals.passed,
      warnings: totals.warnings,
      failed: totals.failed,
      noSamples: totals.noSamples,
      noSnapshots: totals.noSnapshots,
      noForecast: totals.noForecast,
      lowConfidence: totals.lowConfidence,
      missingMlProfile: totals.missingMlProfile,
      missingWeather: totals.missingWeather,
      missingTraffic: totals.missingTraffic,
      missingStaffing: totals.missingStaffing,
      maxFailuresAllowed,
    },
    topIssues,
  };

  const refEuromir = await referenceRideSmoke(
    base,
    token,
    internalParkId,
    externalParkId,
    provider,
    EUROMIR_ENTITY,
    'Euro-Mir'
  );
  const refWodan = await referenceRideSmoke(
    base,
    token,
    internalParkId,
    externalParkId,
    provider,
    WODAN_ENTITY,
    'WODAN'
  );

  writeStatusFile(rideForecastAll, refEuromir, refWodan);

  console.log(JSON.stringify({ totals, topIssues, overallPass, maxFailuresAllowed }, null, 2));

  if (totals.failed > maxFailuresAllowed) {
    console.error(`FAIL: failed rides ${totals.failed} > maxFailuresAllowed ${maxFailuresAllowed}`);
    process.exit(1);
  }
  console.log('PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
