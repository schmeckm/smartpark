/**
 * Regression: Europa-Park WODAN (Outdoor Coaster) — ML profile, weather sensitivity,
 * capacity / staffing signals, forecast factors, and data-quality WARNING semantics.
 *
 * Usage:
 *   node scripts/smoke-wodan-e2e.js [internalParkUuid]
 * Env: API_URL, SKIP_WAIT=1, AUTO_REFRESH=1, ASSIGN_ML=0 to skip profile PUT,
 *      INTERNAL_PARK_ID, EXTERNAL_PARK_ID, EXTERNAL_ENTITY_ID, OUTDOOR_COASTER_PROFILE_ID
 *
 * Exit: 0 pass, 1 test failure, 2 API unreachable during health wait (SKIP_WAIT not set)
 */
/* eslint-disable no-console */
require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize } = require(path.join(__dirname, '..', 'src', 'db', 'sequelize'));
const {
  ParkAsset,
  RideWaitTimeSample,
  RideFeatureSnapshot,
  Park,
  RideMasterData,
  AssetMlProfileAssignment,
} = require(path.join(__dirname, '..', 'src', 'models'));
const { Op } = require('sequelize');

const DEFAULT_INTERNAL_PARK = '0519e1e9-9866-481e-b54d-2b81836ff4a2';
const DEFAULT_EXT_PARK = '639738d3-9574-4f60-ab5b-4c392901320b';
/** ThemeParks.wiki entity UUID for WODAN - Timburcoaster (Europa-Park seed) */
const DEFAULT_EXT_ENTITY = '686c3cc3-3b30-4033-b245-e0856737bb26';
const OUTDOOR_COASTER_PROFILE_ID = process.env.OUTDOOR_COASTER_PROFILE_ID || 'b0000001-0000-4000-8000-000000000001';
const OUTDOOR_COASTER_CODE = 'OUTDOOR_COASTER_HIGH_CAPACITY';

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

function staffingFactorCount(factors) {
  if (!Array.isArray(factors)) return 0;
  return factors.filter((f) => f && String(f.feature || '').toLowerCase().includes('staffing')).length;
}

function hasCapacitySignal(row) {
  const cap = row?.snapshotContext?.capacity?.theoreticalCapacityPph;
  if (cap != null && Number.isFinite(Number(cap))) return true;
  const fac = row?.topInfluencingFactors || [];
  return fac.some((f) => {
    const n = String(f?.feature || '').toLowerCase();
    return n.includes('capacity') || n.includes('throughput') || n.includes('queue_elasticity');
  });
}

/** Weather gaps live in `featureDataQuality` warnings (not informational notes). */
function hasWeatherGapWarning(row) {
  const hints = row?.featureDataQuality || [];
  return hints.some((h) => /weather|rain|precipitation/i.test(String(h)));
}

/**
 * API uses forecastDataQualityStatus OK | WARNING — never FAIL for missing externals;
 * assert we never regress to a hard FAIL label if introduced later.
 */
function assertForecastQualitySemantics(row, failures) {
  const st = row?.forecastDataQualityStatus;
  if (st === 'FAIL' || st === 'FAILED') {
    failures.push('forecastDataQualityStatus must not be FAIL/FAILED for missing weather (expect WARNING)');
  }
  if (hasWeatherGapWarning(row) && st !== 'WARNING') {
    failures.push(
      'when weather is listed in featureDataQuality warnings, forecastDataQualityStatus must be WARNING'
    );
  }
}

function assertOutdoorCoasterSemantics(row, eff, latestSnapPlain, failures) {
  if (eff?.profileCode !== OUTDOOR_COASTER_CODE && eff?.profile?.profileCode !== OUTDOOR_COASTER_CODE) {
    failures.push(`effective ML profile must be ${OUTDOOR_COASTER_CODE}`);
  }
  const prof = eff?.profile || {};
  if (prof.weatherSensitive !== true && prof.weather_sensitive !== true) {
    failures.push('OUTDOOR_COASTER profile must have weatherSensitive=true (ride exposed to weather heuristics)');
  }
  if (prof.rainSensitive !== true && prof.rain_sensitive !== true) {
    failures.push('OUTDOOR_COASTER profile must have rainSensitive=true');
  }

  const sg = row?.snapshotContext?.staffing?.staffingGapNormal;
  if (sg != null && !Number.isFinite(Number(sg))) {
    failures.push('staffingGapNormal in snapshotContext must be numeric when present');
  }

  if (!hasCapacitySignal(row)) {
    failures.push('expected capacity signal (theoreticalCapacityPph in snapshotContext or capacity-related factor)');
  }

  if (!Array.isArray(row?.topInfluencingFactors) || row.topInfluencingFactors.length === 0) {
    failures.push('topInfluencingFactors must be non-empty for WODAN forecast row');
  } else if (staffingFactorCount(row.topInfluencingFactors) > 1) {
    failures.push('staffing-related factors should not appear duplicated (expect dedupe by factor group)');
  }

  if (
    latestSnapPlain &&
    latestSnapPlain.mlProfileCode &&
    String(latestSnapPlain.mlProfileCode) !== OUTDOOR_COASTER_CODE
  ) {
    failures.push(`ride_feature_snapshots_5m.ml_profile_code should be ${OUTDOOR_COASTER_CODE} after assign+refresh`);
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
  else if (auth.offline) console.warn(`[WODAN E2E] API offline — ${auth.message}`);
  else console.warn(`[WODAN E2E] API login failed: ${auth.message}`);

  await sequelize.authenticate();
  const park = await Park.findByPk(internalParkId);
  if (!park) failures.push(`Park not found: ${internalParkId}`);
  details.parkName = park?.name || null;

  const asset = await ParkAsset.findOne({
    where: {
      parkId: internalParkId,
      [Op.or]: [
        { name: { [Op.iLike]: '%WODAN%' } },
        { slug: { [Op.iLike]: '%wodan%' } },
        { externalEntityId: externalEntityId },
      ],
    },
  });
  if (!asset) failures.push('WODAN asset not found in park_assets (name/slug/external_entity_id)');
  details.assetId = asset?.assetId || null;
  details.assetName = asset?.name || null;

  const master = asset ? await RideMasterData.findByPk(asset.assetId) : null;
  if (master) {
    const m = master.get({ plain: true });
    details.rideMaster = {
      theoreticalCapacityPph: m.theoreticalCapacityPph ?? m.theoretical_capacity_pph,
      weatherSensitive: m.weatherSensitive ?? m.weather_sensitive,
    };
    const tcp = Number(m.theoreticalCapacityPph ?? m.theoretical_capacity_pph);
    if (!Number.isFinite(tcp) || tcp <= 0) {
      failures.push('ride_master_data.theoretical_capacity_pph should be set for coaster capacity heuristics');
    }
  } else if (asset) {
    failures.push('ride_master_data row missing for WODAN asset');
  }

  const sampleCnt = await RideWaitTimeSample.count({
    where: { provider: 'themeparks_wiki', externalEntityId },
  });
  details.waitSamples = sampleCnt;
  if (sampleCnt <= 0) failures.push('wait samples count must be > 0');

  let snapCnt = await RideFeatureSnapshot.count({
    where: { provider: 'themeparks_wiki', externalEntityId },
  });
  details.featureSnapshotsBeforeRefresh = snapCnt;

  let mlJustAssigned = false;
  if (token && process.env.ASSIGN_ML !== '0' && asset?.assetId) {
    const existing = await AssetMlProfileAssignment.findOne({
      where: { assetId: asset.assetId, activeFlag: true },
      attributes: ['id', 'profileId'],
    });
    details.hadMlAssignment = Boolean(existing);
    if (!existing) {
      const pr = await fetch(`${base}/api/v1/ai/assets/${asset.assetId}/ml-profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Park-Id': internalParkId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ profileId: OUTDOOR_COASTER_PROFILE_ID }),
      });
      const pj = await pr.json();
      details.mlAssign = pj;
      if (!pr.ok || !pj.success) failures.push(`PUT ml-profile (OUTDOOR_COASTER) failed: ${pj.message || pr.status}`);
      else mlJustAssigned = true;
    }
  }

  if (token && mlJustAssigned && process.env.AUTO_REFRESH !== '0') {
    const rr = await fetch(`${base}/api/v1/ai/forecasts/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    details.refreshAfterMl = await rr.json();
    snapCnt = await RideFeatureSnapshot.count({
      where: { provider: 'themeparks_wiki', externalEntityId },
    });
  }

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
      'feature snapshots count must be > 0 (AUTO_REFRESH=1 or POST /api/v1/ai/forecasts/refresh, or AI_SAMPLING)'
    );
  }

  const latestSnap = await RideFeatureSnapshot.findOne({
    where: { provider: 'themeparks_wiki', externalEntityId },
    order: [['snapshotAt', 'DESC']],
  });
  let latestPlain = null;
  if (latestSnap) {
    latestPlain = latestSnap.get({ plain: true });
    details.latestSnapshot = {
      snapshotAt: latestPlain.snapshotAt,
      rollingAvgWait15m: latestPlain.rollingAvgWait15m,
      rollingAvgWait60m: latestPlain.rollingAvgWait60m,
      mlProfileCode: latestPlain.mlProfileCode,
      staffingGapNormal: latestPlain.staffingGapNormal,
      theoreticalCapacityPph: latestPlain.theoreticalCapacityPph,
      temperatureC: latestPlain.temperatureC,
      completenessScore: latestPlain.completenessScore,
    };
    const r15 = latestPlain.rollingAvgWait15m != null ? Number(latestPlain.rollingAvgWait15m) : null;
    const r60 = latestPlain.rollingAvgWait60m != null ? Number(latestPlain.rollingAvgWait60m) : null;
    if (sampleCnt > 5 && r15 == null && r60 == null) {
      failures.push(
        'rolling_avg_wait_15m/60m still null despite wait samples — check buildRideXLayer / snapshot refresh'
      );
    }
    if (latestPlain && latestPlain.staffingGapNormal == null && token) {
      details.note =
        'staffing_gap_normal null on latest snapshot (park staffing heuristic may be unavailable — not a hard fail)';
    }
  }

  let effPayload = null;
  let forecastRow = null;

  if (token) {
    if (asset?.assetId) {
      const er = await fetch(`${base}/api/v1/ai/assets/${asset.assetId}/effective-ml-config`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId },
      });
      const ej = await er.json();
      effPayload = ej.success ? ej.data : null;
      details.effectiveMl = effPayload?.profileCode || effPayload?.profile?.profileCode || null;
      if (!er.ok || !ej.success) failures.push('effective-ml-config failed');
      else if (!effPayload?.profile && !effPayload?.profileCode) failures.push('effective ML profile payload empty');
    }

    const url =
      `${base}/api/v1/ai/parks/${encodeURIComponent(externalParkId)}/entities/forecast/summary?` +
      `provider=themeparks_wiki&limit=500`;
    const fr = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId },
    });
    const fj = await fr.json();
    if (!fr.ok || !fj.success) failures.push(`forecast list: ${fj.message || fr.status}`);
    else {
      forecastRow = (fj.data || []).find(
        (x) => String(x.externalEntityId || '').toLowerCase() === externalEntityId.toLowerCase()
      );
      details.forecastRow = forecastRow
        ? {
            forecast15Minutes: forecastRow.forecast15Minutes,
            forecast60Minutes: forecastRow.forecast60Minutes,
            forecastSource: forecastRow.forecastSource,
            confidence: forecastRow.confidence,
            confidenceLevel: forecastRow.confidenceLevel,
            featureDataQuality: forecastRow.featureDataQuality,
            forecastDataQualityStatus: forecastRow.forecastDataQualityStatus,
            topInfluencingFactors: (forecastRow.topInfluencingFactors || []).map((f) => ({
              feature: f.feature,
              impact: f.impact,
            })),
            snapshotStaffing: forecastRow.snapshotContext?.staffing?.staffingGapNormal,
            snapshotCapacity: forecastRow.snapshotContext?.capacity?.theoreticalCapacityPph,
          }
        : null;
      if (!forecastRow) failures.push('WODAN row not in park entity forecast list');
      else {
        if (forecastRow.forecast15Minutes == null && forecastRow.forecast60Minutes == null) {
          failures.push('forecast15/60 both null');
        }
        if (forecastRow.forecastSource == null || forecastRow.forecastSource === '') {
          failures.push('forecastSource missing');
        }
        if (forecastRow.confidence == null || Number.isNaN(Number(forecastRow.confidence))) {
          failures.push('confidence missing');
        }
        if (!Array.isArray(forecastRow.featureDataQuality)) failures.push('featureDataQuality not an array');
        assertForecastQualitySemantics(forecastRow, failures);
        assertOutdoorCoasterSemantics(forecastRow, effPayload, latestPlain, failures);
      }
    }

    const dqUrl = `${base}/api/v1/ai/feature-data-quality`;
    const dqr = await fetch(dqUrl, { headers: { Authorization: `Bearer ${token}`, 'X-Park-Id': internalParkId } });
    const dqj = await dqr.json();
    if (dqr.ok && dqj.success) {
      const rides = dqj.data?.rideFeatureQuality || [];
      const wodanDq = rides.find(
        (r) => String(r.externalEntityId || '').toLowerCase() === externalEntityId.toLowerCase()
      );
      details.dataQualityRideRow = wodanDq
        ? {
            completenessScore: wodanDq.completenessScore,
            hints: wodanDq.featureDataQuality || wodanDq.feature_data_quality,
          }
        : null;
    }
  } else if (!auth.offline) {
    failures.push('API login required for forecast + ML + DQ checks');
  }

  console.log(JSON.stringify({ details }, null, 2));

  if (failures.length) {
    console.error('WODAN E2E FAIL\n', failures.join('\n'));
    process.exit(1);
  }
  if (!token) console.warn('WODAN E2E PASS (partial: DB only — API was offline)');
  else console.log('WODAN E2E PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('WODAN E2E FAIL (unexpected)', e);
  process.exit(1);
});
