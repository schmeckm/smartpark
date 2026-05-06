/**
 * Regression: Europa-Park Euro-Mir forecast pipeline (DB + API).
 *
 * Usage:
 *   node scripts/smoke-euromir-e2e.js [internalParkUuid]
 * Env: API_URL, SKIP_WAIT=1, AUTO_REFRESH=1, INTERNAL_PARK_ID, EXTERNAL_PARK_ID, EXTERNAL_ENTITY_ID
 *
 * Exit: 0 pass, 1 test failure, 2 API unreachable during health wait (SKIP_WAIT not set)
 */
/* eslint-disable no-console */
require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize } = require(path.join(__dirname, '..', 'src', 'db', 'sequelize'));
const { ParkAsset, RideWaitTimeSample, RideFeatureSnapshot, Park } = require(path.join(__dirname, '..', 'src', 'models'));
const { Op } = require('sequelize');

const DEFAULT_INTERNAL_PARK = '0519e1e9-9866-481e-b54d-2b81836ff4a2';
const DEFAULT_EXT_PARK = '639738d3-9574-4f60-ab5b-4c392901320b';
const DEFAULT_EXT_ENTITY = 'd1bd3846-b26a-4308-aca8-634a248115ba';
const RIDE_NAME = 'Euro-Mir';

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
  throw new Error(
    `API not reachable at ${base} (waited ${ms}ms). Start the API or set SKIP_WAIT=1 to run DB-only checks.`
  );
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

async function main() {
  const base = process.env.API_URL || 'http://127.0.0.1:3000';
  const internalParkId = process.argv[2] || process.env.INTERNAL_PARK_ID || DEFAULT_INTERNAL_PARK;
  const externalParkId = process.env.EXTERNAL_PARK_ID || DEFAULT_EXT_PARK;
  const externalEntityId = process.env.EXTERNAL_ENTITY_ID || DEFAULT_EXT_ENTITY;
  const failures = [];
  const details = {};

  if (process.env.SKIP_WAIT !== '1') {
    try {
      await waitForApi(base, 60000);
    } catch (e) {
      console.error(String(e.message || e));
      process.exit(2);
    }
  }

  let token = null;
  const auth = await tryLogin(base);
  if (auth.ok) token = auth.token;
  else if (auth.offline) console.warn(`[Euro-Mir E2E] API offline — ${auth.message}`);
  else console.warn(`[Euro-Mir E2E] API login failed: ${auth.message}`);

  await sequelize.authenticate();
  const park = await Park.findByPk(internalParkId);
  if (!park) failures.push(`Park not found: ${internalParkId}`);
  details.parkName = park?.name || null;

  const asset = await ParkAsset.findOne({
    where: {
      parkId: internalParkId,
      [Op.or]: [{ name: RIDE_NAME }, { externalEntityId: externalEntityId }],
    },
  });
  if (!asset) failures.push(`Asset "${RIDE_NAME}" not found for park`);
  details.assetId = asset?.assetId || null;
  details.assetName = asset?.name || null;

  const sampleCnt = await RideWaitTimeSample.count({
    where: {
      provider: 'themeparks_wiki',
      externalEntityId,
    },
  });
  details.waitSamples = sampleCnt;
  if (sampleCnt <= 0) failures.push('wait samples count must be > 0');

  let snapCnt = await RideFeatureSnapshot.count({
    where: { provider: 'themeparks_wiki', externalEntityId },
  });
  details.featureSnapshotsBeforeRefresh = snapCnt;

  if (snapCnt <= 0 && process.env.AUTO_REFRESH === '1' && token) {
    const rr = await fetch(`${base}/api/v1/ai/forecasts/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const rj = await rr.json();
    details.refresh = rj;
    if (!rj.success) failures.push('POST /ai/forecasts/refresh failed');
    snapCnt = await RideFeatureSnapshot.count({
      where: { provider: 'themeparks_wiki', externalEntityId },
    });
  }

  details.featureSnapshots = snapCnt;
  if (snapCnt <= 0) {
    failures.push(
      'feature snapshots count must be > 0 (set AUTO_REFRESH=1 with running API, or POST /api/v1/ai/forecasts/refresh, or enable AI_SAMPLING in compose)'
    );
  }

  const latestSnap = await RideFeatureSnapshot.findOne({
    where: { provider: 'themeparks_wiki', externalEntityId },
    order: [['snapshotAt', 'DESC']],
  });
  if (latestSnap) {
    const p = latestSnap.get({ plain: true });
    details.latestRolling15 = p.rollingAvgWait15m;
    details.latestRolling60 = p.rollingAvgWait60m;
    details.latestMlProfileCode = p.mlProfileCode;
  }

  if (token) {
    const url =
      `${base}/api/v1/ai/parks/${encodeURIComponent(externalParkId)}/entities/forecast/summary?` +
      `provider=themeparks_wiki&limit=500`;
    const fr = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId },
    });
    const fj = await fr.json();
    if (!fr.ok || !fj.success) failures.push(`forecast list: ${fj.message || fr.status}`);
    else {
      const row = (fj.data || []).find(
        (x) => String(x.externalEntityId || '').toLowerCase() === externalEntityId.toLowerCase()
      );
      details.forecastRow = row
        ? {
            forecast15Minutes: row.forecast15Minutes,
            forecast60Minutes: row.forecast60Minutes,
            forecastSource: row.forecastSource,
            confidence: row.confidence,
            featureDataQuality: row.featureDataQuality,
            forecastDataQualityStatus: row.forecastDataQualityStatus,
          }
        : null;
      if (!row) failures.push('Euro-Mir row not in park entity forecast list');
      else {
        if (row.forecast15Minutes == null && row.forecast60Minutes == null) {
          failures.push('forecast15/60 both null');
        }
        if (row.forecastSource == null || row.forecastSource === '') failures.push('forecastSource missing');
        if (row.confidence == null || Number.isNaN(Number(row.confidence))) failures.push('confidence missing');
        if (!Array.isArray(row.featureDataQuality)) failures.push('featureDataQuality not an array');
        const warnHints = row.featureDataQuality;
        if (warnHints.length > 0 && row.forecastDataQualityStatus !== 'WARNING') {
          failures.push('expected forecastDataQualityStatus=WARNING when featureDataQuality warnings are non-empty');
        }
      }
    }

    if (asset?.assetId) {
      const er = await fetch(`${base}/api/v1/ai/assets/${asset.assetId}/effective-ml-config`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId },
      });
      const ej = await er.json();
      details.effectiveMl = ej.success ? ej.data?.profileCode || ej.data?.source : null;
      if (!er.ok || !ej.success) failures.push('effective-ml-config failed');
      else if (!ej.data?.profile && !ej.data?.profileCode) failures.push('effective ML profile payload empty');
    }
  } else if (!auth.offline) {
    failures.push('API login required for forecast + effective-ML checks');
  }

  console.log(JSON.stringify({ details }, null, 2));

  if (failures.length) {
    console.error('Euro-Mir E2E FAIL\n', failures.join('\n'));
    process.exit(1);
  }
  if (!token) console.warn('Euro-Mir E2E PASS (partial: DB only — API was offline)');
  else console.log('Euro-Mir E2E PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('Euro-Mir E2E FAIL (unexpected)', e);
  process.exit(1);
});
