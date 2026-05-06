/**
 * Hierarchical SQDC board service (park roll-up + asset detail).
 *
 * Integration hooks (future):
 * - MQTT / UNS live OEE: reuse UNS live events aggregation in a thin adapter.
 * - Legacy `sqdc_board_snapshots.delivery_oee_5m` (classic SQDC „Snapshot speichern“) is merged when
 *   hierarchical `sqdc_daily_snapshots.delivery_json.oee01` is missing — same business day / asset.
 * - Canonical inbound: map adapter payloads → `SqdcEvent` with source ADAPTER.
 * - Topic examples: smartpark/{parkId}/asset/{assetId}/sqdc/event
 * - Shift handover (`shift_handover_entries`) + asset downtime (`asset_downtime_events`) are loaded for the UTC day window.
 */

const { Op } = require('sequelize');
const {
  AssetDowntimeEvent,
  ParkAsset,
  RideMasterData,
  RestaurantMasterData,
  ShiftHandoverEntry,
  ShowMasterData,
  SqdcBoardSnapshot,
  SqdcDailySnapshot,
  SqdcEvent,
  SqdcMoodFeedback,
  User,
} = require('../models');
const { IncidentService } = require('./incident.service');
const { getPlatformSettingsService } = require('./platform-settings.service');
const { AppError } = require('../utils/app-error');

const incidentService = new IncidentService();

const SEV_WEIGHT = { CRITICAL: 40, HIGH: 25, MEDIUM: 10, LOW: 5 };

function clampScore(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function dayBoundsUtc(isoDate) {
  const from = new Date(`${isoDate}T00:00:00.000Z`);
  const to = new Date(`${isoDate}T23:59:59.999Z`);
  return { from, to };
}

/** ISO date `YYYY-MM-DD` plus `deltaDays` (UTC calendar). */
function addCalendarDaysIso(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function electricityFromDeliveryJson(snapPlain) {
  const dj =
    snapPlain?.deliveryJson && typeof snapPlain.deliveryJson === 'object' ? snapPlain.deliveryJson : {};
  const kwh = Number(dj.electricityKwhPerDay);
  const eur = Number(dj.electricityCostEurPerDay);
  return {
    electricityKwhPerDay: Number.isFinite(kwh) ? Math.round(kwh * 1000) / 1000 : null,
    electricityCostEurPerDay: Number.isFinite(eur) ? Math.round(eur * 100) / 100 : null,
  };
}

/** UTC calendar month for `YYYY-MM-DD` (defaults to current UTC month if invalid). */
function monthUtcBounds(isoDate) {
  const parts = String(isoDate || '').split('-');
  let y = Number(parts[0]);
  let mo = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    const d = new Date();
    y = d.getUTCFullYear();
    mo = d.getUTCMonth() + 1;
  }
  const mm = String(mo).padStart(2, '0');
  const my = String(y);
  const monthStart = `${my}-${mm}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const monthEnd = `${my}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { yearMonth: `${my}-${mm}`, monthStart, monthEnd, lastDay, y, mo, my, mm };
}

/** 0–100 score → ring segment (S/Q/D); thresholds from platform settings (park vs asset). */
function scoreToRingToneWith(v, greenMin, amberMin) {
  if (v == null || !Number.isFinite(Number(v))) return 'empty';
  const n = Number(v);
  if (n >= greenMin) return 'green';
  if (n >= amberMin) return 'amber';
  return 'red';
}

function normalizeScoreRingPair(greenRaw, amberRaw, defGreen, defAmber) {
  let g = Number.isFinite(Number(greenRaw)) ? Number(greenRaw) : defGreen;
  let a = Number.isFinite(Number(amberRaw)) ? Number(amberRaw) : defAmber;
  g = Math.min(100, Math.max(1, g));
  a = Math.min(99, Math.max(0, a));
  if (a >= g) a = Math.max(0, g - 1);
  return { greenMin: g, amberMin: a };
}

/** Daily electricity cost (EUR) in snapshot `delivery_json` → cost ring (C). */
function costDayToneWith(dj, eurGreenMax, eurAmberMax) {
  if (!dj || typeof dj !== 'object') return 'empty';
  const eur = Number(dj.electricityCostEurPerDay);
  if (!Number.isFinite(eur) || eur <= 0) return 'empty';
  let gMax = Number.isFinite(eurGreenMax) ? eurGreenMax : 200;
  let aMax = Number.isFinite(eurAmberMax) ? eurAmberMax : 500;
  gMax = Math.max(1, gMax);
  aMax = Math.max(gMax + 1, aMax);
  if (eur <= gMax) return 'green';
  if (eur <= aMax) return 'amber';
  return 'red';
}

/** Average mood 1–5 → People ring tone (SQDCP „P“). */
function moodAvgToPeopleToneWith(avg, greenMin, amberMin) {
  if (avg == null || !Number.isFinite(avg)) return 'empty';
  let g = Number.isFinite(greenMin) ? Number(greenMin) : 4;
  let a = Number.isFinite(amberMin) ? Number(amberMin) : 3;
  g = Math.min(5, Math.max(1, g));
  a = Math.min(5, Math.max(1, a));
  if (a >= g) a = Math.max(1, g - 0.5);
  if (avg >= g) return 'green';
  if (avg >= a) return 'amber';
  return 'red';
}

/**
 * Loads SQDC month-ring / UI band thresholds from `platform_settings` (cached in service).
 * @returns {Promise<{
 *   park: { greenMin: number, amberMin: number },
 *   asset: { greenMin: number, amberMin: number },
 *   costEurGreenMax: number,
 *   costEurAmberMax: number,
 *   peopleMoodGreenMin: number,
 *   peopleMoodAmberMin: number,
 * }>}
 */
async function loadSqdcToneThresholds() {
  const ps = getPlatformSettingsService();
  const [
    pg,
    pa,
    ag,
    aa,
    cg,
    ca,
    pgm,
    pam,
  ] = await Promise.all([
    ps.getNumber('SQDC_SCORE_RING_PARK_GREEN_MIN', 80),
    ps.getNumber('SQDC_SCORE_RING_PARK_AMBER_MIN', 55),
    ps.getNumber('SQDC_SCORE_RING_ASSET_GREEN_MIN', 80),
    ps.getNumber('SQDC_SCORE_RING_ASSET_AMBER_MIN', 55),
    ps.getNumber('SQDC_RING_COST_EUR_GREEN_MAX', 200),
    ps.getNumber('SQDC_RING_COST_EUR_AMBER_MAX', 500),
    ps.getNumber('SQDC_RING_PEOPLE_MOOD_GREEN_MIN', 4),
    ps.getNumber('SQDC_RING_PEOPLE_MOOD_AMBER_MIN', 3),
  ]);
  const park = normalizeScoreRingPair(pg, pa, 80, 55);
  const asset = normalizeScoreRingPair(ag, aa, 80, 55);
  let eurG = Number.isFinite(cg) ? cg : 200;
  let eurA = Number.isFinite(ca) ? ca : 500;
  eurG = Math.max(1, eurG);
  eurA = Math.max(eurG + 1, eurA);
  let moodG = Number.isFinite(pgm) ? pgm : 4;
  let moodA = Number.isFinite(pam) ? pam : 3;
  moodG = Math.min(5, Math.max(1, moodG));
  moodA = Math.min(5, Math.max(1, moodA));
  if (moodA >= moodG) moodA = Math.max(1, moodG - 0.5);
  return {
    park,
    asset,
    costEurGreenMax: eurG,
    costEurAmberMax: eurA,
    peopleMoodGreenMin: moodG,
    peopleMoodAmberMin: moodA,
  };
}

function sqdcUiThresholdsPayload(tones) {
  return {
    scoreRingPark: { greenMin: tones.park.greenMin, amberMin: tones.park.amberMin },
    scoreRingAsset: { greenMin: tones.asset.greenMin, amberMin: tones.asset.amberMin },
    ringCostEur: { greenAtMost: tones.costEurGreenMax, amberAtMost: tones.costEurAmberMax },
    ringPeopleMood: { greenAtLeast: tones.peopleMoodGreenMin, amberAtLeast: tones.peopleMoodAmberMin },
  };
}

function aggregateMoodsByDate(rows) {
  const m = new Map();
  for (const row of rows) {
    const p = row.get ? row.get({ plain: true }) : row;
    const day = String(p.feedbackDate);
    const sc = Number(p.moodScore);
    if (!Number.isFinite(sc)) continue;
    const cur = m.get(day) || { sum: 0, count: 0 };
    cur.sum += sc;
    cur.count += 1;
    m.set(day, cur);
  }
  return m;
}

/**
 * @param {ReturnType<typeof monthUtcBounds>} monthB
 * @param {import('sequelize').Model[]} snapRows
 * @param {Map<string, { sum: number, count: number }>} moodByDate
 * @param {{
 *   scoreGreen: number,
 *   scoreAmber: number,
 *   costEurGreenMax: number,
 *   costEurAmberMax: number,
 *   peopleMoodGreenMin: number,
 *   peopleMoodAmberMin: number,
 * }} ringTones
 */
function buildMonthRingOverview(monthB, snapRows, moodByDate, ringTones) {
  const snapMap = new Map();
  for (const r of snapRows) {
    const p = r.get ? r.get({ plain: true }) : r;
    snapMap.set(String(p.snapshotDate), p);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { lastDay, my, mm } = monthB;
  const days = [];
  for (let d = 1; d <= lastDay; d += 1) {
    const ds = `${my}-${mm}-${String(d).padStart(2, '0')}`;
    if (ds > today) {
      days.push({ date: ds, safety: 'empty', quality: 'empty', delivery: 'empty', cost: 'empty', people: 'empty' });
      continue;
    }
    const agg = moodByDate.get(ds);
    const peopleTone =
      agg && agg.count > 0 && Number.isFinite(agg.sum)
        ? moodAvgToPeopleToneWith(
            agg.sum / agg.count,
            ringTones.peopleMoodGreenMin,
            ringTones.peopleMoodAmberMin
          )
        : 'empty';

    const row = snapMap.get(ds);
    if (!row) {
      days.push({
        date: ds,
        safety: 'empty',
        quality: 'empty',
        delivery: 'empty',
        cost: 'empty',
        people: peopleTone,
      });
      continue;
    }
    const dj = row.deliveryJson && typeof row.deliveryJson === 'object' ? row.deliveryJson : {};
    days.push({
      date: ds,
      safety: scoreToRingToneWith(row.safetyScore, ringTones.scoreGreen, ringTones.scoreAmber),
      quality: scoreToRingToneWith(row.qualityScore, ringTones.scoreGreen, ringTones.scoreAmber),
      delivery: scoreToRingToneWith(row.deliveryScore, ringTones.scoreGreen, ringTones.scoreAmber),
      cost: costDayToneWith(dj, ringTones.costEurGreenMax, ringTones.costEurAmberMax),
      people: peopleTone,
    });
  }
  return { yearMonth: monthB.yearMonth, days };
}

/**
 * Deterministic 0–100 scores (graceful when data missing).
 */
function computeScores(input = {}) {
  const incidents = input.incidents || [];
  const events = input.sqdcEvents || [];
  let safety = 100;
  for (const i of incidents) {
    const sev = String(i.severity || 'MEDIUM').toUpperCase();
    safety -= SEV_WEIGHT[sev] ?? SEV_WEIGHT.MEDIUM;
  }
  for (const e of events) {
    if (String(e.eventType || '').toUpperCase() !== 'SAFETY') continue;
    const sev = String(e.severity || 'MEDIUM').toUpperCase();
    safety -= (SEV_WEIGHT[sev] ?? SEV_WEIGHT.MEDIUM) * 0.75;
  }
  safety = clampScore(safety) ?? 75;

  let quality = 88;
  for (const e of events) {
    if (String(e.eventType || '').toUpperCase() === 'QUALITY') {
      const sev = String(e.severity || 'MEDIUM').toUpperCase();
      quality -= (SEV_WEIGHT[sev] ?? 10) * 0.35;
    }
  }
  quality = clampScore(quality) ?? 80;

  let delivery = 78;
  if (input.oee01 != null && Number.isFinite(input.oee01)) {
    delivery = clampScore(input.oee01 * 100) ?? delivery;
  } else {
    for (const e of events) {
      if (String(e.eventType || '').toUpperCase() === 'DELIVERY') {
        delivery -= 8;
      }
    }
  }
  delivery = clampScore(delivery) ?? 72;

  let customer = 82;
  if (input.queueMinutes != null && input.queueMinutes > 90) customer -= 25;
  else if (input.queueMinutes != null && input.queueMinutes > 45) customer -= 12;
  if (input.avgMood1to5 != null) {
    customer = clampScore((input.avgMood1to5 / 5) * 100) ?? customer;
  }
  for (const e of events) {
    if (String(e.eventType || '').toUpperCase() === 'CUSTOMER') {
      const sev = String(e.severity || 'LOW').toUpperCase();
      customer -= (SEV_WEIGHT[sev] ?? 5) * 0.25;
    }
  }
  customer = clampScore(customer) ?? 75;

  const overall = clampScore((safety + quality + delivery + customer) / 4) ?? 76;
  return { safety, quality, delivery, customer, overall };
}

function buildAiRecommendations({
  scores,
  openCritical,
  queueMinutes,
  oee01,
  avgMood1to5,
  openUnplannedDowntime = 0,
}) {
  const out = [];
  let id = 1;
  const push = (category, severity, message, suggestedAction, confidence) => {
    out.push({
      recommendationId: `sqdc-ph-${id++}`,
      category,
      severity,
      message,
      suggestedAction,
      confidence,
    });
  };
  if (openUnplannedDowntime > 0) {
    push(
      'DELIVERY',
      'HIGH',
      'Open unplanned downtime / stoppage recorded for this scope.',
      'Review shift handover notes and OEE logbook; dispatch maintenance if still stopped.',
      0.72
    );
  }
  if (avgMood1to5 != null && avgMood1to5 <= 2) {
    push('PEOPLE', 'MEDIUM', 'Team mood feedback is low.', 'Supervisor check-in recommended.', 0.48);
  }
  if (queueMinutes != null && queueMinutes > 75) {
    push('DELIVERY', 'MEDIUM', 'Queue time is elevated.', 'Open additional capacity or redirect guests.', 0.55);
  }
  if (oee01 != null && oee01 < 0.65) {
    push('DELIVERY', 'HIGH', 'OEE is below a healthy band.', 'Review downtime root cause and dispatch maintenance.', 0.62);
  }
  if (openCritical > 0) {
    push('SAFETY', 'CRITICAL', 'Critical SQDC safety events are open.', 'Escalate to operations control immediately.', 0.9);
  }
  if (scores.safety < 60) {
    push('SAFETY', 'HIGH', 'Safety score is under target.', 'Run a safety stand-down and close open items.', 0.58);
  }
  if (scores.customer < 60) {
    push('CUSTOMER', 'MEDIUM', 'Customer score is under target.', 'Supervisor check-in recommended.', 0.52);
  }
  if (!out.length) {
    push('SYSTEM', 'LOW', 'No major deterministic triggers.', 'Continue monitoring MQTT/UNS and incidents.', 0.35);
  }
  return out;
}

function assertParkMatchesContext(contextParkId, urlParkId) {
  if (String(contextParkId) !== String(urlParkId)) {
    throw new AppError('Park id does not match X-Park-Id context', 403, { code: 'PARK_SCOPE_MISMATCH' });
  }
}

/** OEE 0–1 from hierarchical daily snapshot `delivery_json`, else classic board snapshot column. */
function mergedOee01(dailySnapRow, legacyOee5m) {
  if (dailySnapRow?.deliveryJson && typeof dailySnapRow.deliveryJson === 'object') {
    const v = Number(dailySnapRow.deliveryJson.oee01);
    if (Number.isFinite(v)) return v;
  }
  if (legacyOee5m != null) {
    const v = Number(legacyOee5m);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function mergedQueueMinutes(dailySnapRow) {
  if (dailySnapRow?.customerJson && typeof dailySnapRow.customerJson === 'object') {
    const v = Number(dailySnapRow.customerJson.queueMinutes);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function briefUser(u) {
  if (!u) return null;
  const p = u.get ? u.get({ plain: true }) : u;
  return {
    id: p.id,
    email: p.email ?? null,
    firstName: p.firstName ?? null,
    lastName: p.lastName ?? null,
  };
}

function serializeShiftHandoverRow(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  const notes = p.notes != null ? String(p.notes) : '';
  return {
    id: p.id,
    windowFrom: p.windowFrom ? new Date(p.windowFrom).toISOString() : null,
    windowTo: p.windowTo ? new Date(p.windowTo).toISOString() : null,
    shiftLabel: p.shiftLabel,
    notes: notes.length > 2500 ? `${notes.slice(0, 2500)}…` : notes,
    linkedEntityType: p.linkedEntityType,
    linkedEntityId: p.linkedEntityId,
    downtimeSnapshot: p.downtimeSnapshot || null,
    scopeKind: p.linkedEntityType === 'PARK_ASSET' && p.linkedEntityId ? 'ASSET' : 'PARK',
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    createdBy: briefUser(p.createdBy),
  };
}

function serializeDowntimeEventRow(row, assetLabelFallback) {
  const p = row.get ? row.get({ plain: true }) : row;
  const asset = p.asset && (p.asset.get ? p.asset.get({ plain: true }) : p.asset);
  return {
    id: p.id,
    assetId: p.assetId,
    assetName: asset?.name || assetLabelFallback || null,
    assetSlug: asset?.slug || null,
    startedAt: p.startedAt ? new Date(p.startedAt).toISOString() : null,
    endedAt: p.endedAt ? new Date(p.endedAt).toISOString() : null,
    planned: Boolean(p.planned),
    reasonCode: p.reasonCode,
    notes: p.notes,
    source: p.source,
    createdBy: briefUser(p.createdBy),
  };
}

function countOpenUnplannedDowntime(rows) {
  let n = 0;
  for (const r of rows) {
    const p = r.get ? r.get({ plain: true }) : r;
    if (!p.planned && !p.endedAt) n += 1;
  }
  return n;
}

class SqdcBoardService {
  async getParkSqdcBoard(contextParkId, urlParkId, date) {
    assertParkMatchesContext(contextParkId, urlParkId);
    const { from, to } = dayBoundsUtc(date);
    const monthB = monthUtcBounds(date);
    const historyFrom = addCalendarDaysIso(date, -29);
    const toneDefs = await loadSqdcToneThresholds();
    const parkRingTones = {
      scoreGreen: toneDefs.park.greenMin,
      scoreAmber: toneDefs.park.amberMin,
      costEurGreenMax: toneDefs.costEurGreenMax,
      costEurAmberMax: toneDefs.costEurAmberMax,
      peopleMoodGreenMin: toneDefs.peopleMoodGreenMin,
      peopleMoodAmberMin: toneDefs.peopleMoodAmberMin,
    };

    const [
      incidentsRes,
      events,
      moods,
      assetSnaps,
      parkSnap,
      assets,
      legacySnaps,
      shiftHandovers,
      downtimeEventsPark,
      monthParkSnapshotRows,
      monthParkMoodRows,
      parkOverallHistoryRows,
    ] = await Promise.all([
      incidentService.listForPark(contextParkId, {
        limit: 200,
        offset: 0,
        createdFrom: from.toISOString(),
        createdTo: to.toISOString(),
      }),
      SqdcEvent.findAll({
        where: { parkId: contextParkId, eventTime: { [Op.between]: [from, to] } },
        order: [['eventTime', 'DESC']],
        limit: 200,
      }),
      SqdcMoodFeedback.findAll({
        where: { parkId: contextParkId, feedbackDate: date, assetId: { [Op.is]: null } },
        order: [['createdAt', 'DESC']],
        limit: 50,
      }),
      SqdcDailySnapshot.findAll({
        where: { parkId: contextParkId, snapshotDate: date, level: 'ASSET' },
      }),
      SqdcDailySnapshot.findOne({
        where: { parkId: contextParkId, snapshotDate: date, level: 'PARK', assetId: { [Op.is]: null } },
      }),
      ParkAsset.findAll({
        where: { parkId: contextParkId },
        attributes: ['assetId', 'name', 'slug', 'assetTypeId'],
        limit: 500,
      }),
      SqdcBoardSnapshot.findAll({
        where: { parkId: contextParkId, businessDate: date },
        attributes: ['assetId', 'deliveryOee5m'],
      }),
      ShiftHandoverEntry.findAll({
        where: {
          parkId: contextParkId,
          windowFrom: { [Op.lt]: to },
          windowTo: { [Op.gt]: from },
        },
        order: [['createdAt', 'DESC']],
        limit: 25,
        include: [{ model: User, as: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'], required: false }],
      }),
      AssetDowntimeEvent.findAll({
        where: {
          parkId: contextParkId,
          startedAt: { [Op.lte]: to },
          [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: from } }],
        },
        include: [
          {
            model: ParkAsset,
            as: 'asset',
            attributes: ['assetId', 'name', 'slug'],
            required: true,
            where: { parkId: contextParkId },
          },
          { model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
        ],
        order: [['startedAt', 'DESC']],
        limit: 40,
      }),
      SqdcDailySnapshot.findAll({
        where: {
          parkId: contextParkId,
          level: 'PARK',
          assetId: { [Op.is]: null },
          snapshotDate: { [Op.between]: [monthB.monthStart, monthB.monthEnd] },
        },
        attributes: ['snapshotDate', 'safetyScore', 'qualityScore', 'deliveryScore', 'customerScore', 'deliveryJson'],
        order: [['snapshotDate', 'ASC']],
      }),
      SqdcMoodFeedback.findAll({
        where: {
          parkId: contextParkId,
          assetId: { [Op.is]: null },
          feedbackDate: { [Op.between]: [monthB.monthStart, monthB.monthEnd] },
        },
        attributes: ['feedbackDate', 'moodScore'],
      }),
      SqdcDailySnapshot.findAll({
        where: {
          parkId: contextParkId,
          level: 'PARK',
          assetId: { [Op.is]: null },
          snapshotDate: { [Op.between]: [historyFrom, date] },
        },
        attributes: ['snapshotDate', 'overallScore'],
        order: [['snapshotDate', 'ASC']],
      }),
    ]);

    const overallScoreHistory = parkOverallHistoryRows.map((r) => {
      const p = r.get({ plain: true });
      const os = p.overallScore != null ? Number(p.overallScore) : null;
      return {
        snapshotDate: p.snapshotDate,
        overallScore: Number.isFinite(os) ? Math.round(os * 100) / 100 : null,
      };
    });

    const incidents = incidentsRes.items || [];
    const moodScores = moods.map((m) => Number(m.moodScore)).filter((n) => Number.isFinite(n));
    const avgMood = moodScores.length ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null;

    const legacyOeeByAsset = new Map(
      legacySnaps.map((r) => {
        const p = r.get({ plain: true });
        return [String(p.assetId), p.deliveryOee5m];
      })
    );
    const dailyByAssetId = new Map(assetSnaps.map((s) => [String(s.assetId), s.get({ plain: true })]));

    const mergedOeePerAsset = [];
    const mergedQueuePerAsset = [];
    const assetIdUnion = new Set([...legacyOeeByAsset.keys(), ...dailyByAssetId.keys()]);
    for (const aid of assetIdUnion) {
      const dailyPlain = dailyByAssetId.get(aid);
      const leg = legacyOeeByAsset.get(aid);
      const oee = mergedOee01(dailyPlain, leg);
      if (oee != null) mergedOeePerAsset.push(oee);
      const qm = mergedQueueMinutes(dailyPlain);
      if (qm != null) mergedQueuePerAsset.push(qm);
    }
    const parkAvgOee01 =
      mergedOeePerAsset.length > 0
        ? mergedOeePerAsset.reduce((a, b) => a + b, 0) / mergedOeePerAsset.length
        : null;
    const parkAvgQueue =
      mergedQueuePerAsset.length > 0
        ? mergedQueuePerAsset.reduce((a, b) => a + b, 0) / mergedQueuePerAsset.length
        : null;

    const scores = computeScores({
      incidents,
      sqdcEvents: events.map((e) => e.get({ plain: true })),
      oee01: parkAvgOee01,
      queueMinutes: parkAvgQueue,
      avgMood1to5: avgMood,
    });

    const openCritical = events.filter(
      (e) => String(e.status).toUpperCase() === 'OPEN' && String(e.severity).toUpperCase() === 'CRITICAL'
    ).length;
    const openUnplannedDowntimePark = countOpenUnplannedDowntime(downtimeEventsPark);

    const ai = buildAiRecommendations({
      scores,
      openCritical,
      queueMinutes: parkAvgQueue,
      oee01: parkAvgOee01,
      avgMood1to5: avgMood,
      openUnplannedDowntime: openUnplannedDowntimePark,
    });

    const assetRows = assetSnaps.map((s) => {
      const p = s.get({ plain: true });
      return {
        assetId: p.assetId,
        deliveryScore: p.deliveryScore != null ? Number(p.deliveryScore) : null,
        safetyScore: p.safetyScore != null ? Number(p.safetyScore) : null,
      };
    });
    const worstAssets = [...assetRows]
      .filter((r) => r.deliveryScore != null)
      .sort((a, b) => (a.deliveryScore || 0) - (b.deliveryScore || 0))
      .slice(0, 8)
      .map((r) => {
        const a = assets.find((x) => String(x.assetId) === String(r.assetId));
        return { assetId: r.assetId, label: a?.name || a?.slug || r.assetId, deliveryScore: r.deliveryScore };
      });

    const withDel = assetRows.filter((r) => r.deliveryScore != null);
    const avgDelivery =
      withDel.length > 0 ? withDel.reduce((s, r) => s + r.deliveryScore, 0) / withDel.length : null;

    const rollup = {
      parkScore: scores.overall,
      assetCount: assets.length,
      openAssetIncidents: incidents.filter((i) => i.linkedEntityId).length,
      criticalAssets: worstAssets.filter(
        (w) => w.deliveryScore != null && w.deliveryScore < toneDefs.asset.amberMin
      ).length,
      averageOee: parkAvgOee01 != null ? Math.round(parkAvgOee01 * 1000) / 1000 : null,
      averageQueueTime: parkAvgQueue != null ? Math.round(parkAvgQueue * 100) / 100 : null,
      worstAssets,
      averageDeliveryFromSnapshots: avgDelivery != null ? Math.round(avgDelivery * 100) / 100 : null,
    };

    const moodByDateParkMonth = aggregateMoodsByDate(monthParkMoodRows);
    const monthRingOverview = buildMonthRingOverview(monthB, monthParkSnapshotRows, moodByDateParkMonth, parkRingTones);
    const parkSnapPlain = parkSnap ? parkSnap.get({ plain: true }) : null;
    const elecPark = electricityFromDeliveryJson(parkSnapPlain);

    return {
      level: 'PARK',
      parkId: contextParkId,
      date,
      lastUpdate: new Date().toISOString(),
      scores: parkSnap
        ? {
            safety: Number(parkSnap.safetyScore),
            quality: Number(parkSnap.qualityScore),
            delivery: Number(parkSnap.deliveryScore),
            customer: Number(parkSnap.customerScore),
            overall: Number(parkSnap.overallScore),
            source: 'STORED_SNAPSHOT',
          }
        : { ...scores, source: 'COMPUTED' },
      kpis: {
        incidentsToday: incidents.length,
        sqdcEventsToday: events.length,
        moodSamples: moods.length,
        storedParkSnapshot: Boolean(parkSnap),
        shiftHandoversOverlappingDay: shiftHandovers.length,
        downtimeEventsOverlappingDay: downtimeEventsPark.length,
        openUnplannedDowntimePark,
      },
      incidents: incidents.slice(0, 50),
      activeEvents: events.slice(0, 40).map((e) => e.get({ plain: true })),
      moodFeedback: moods.map((m) => m.get({ plain: true })),
      shiftHandovers: shiftHandovers.map((r) => serializeShiftHandoverRow(r)),
      downtimeEvents: downtimeEventsPark.map((r) => serializeDowntimeEventRow(r, null)),
      topRiskAssets: worstAssets,
      aiRecommendations:
        parkSnap && parkSnap.aiRecommendationsJson && parkSnap.aiRecommendationsJson.length
          ? parkSnap.aiRecommendationsJson
          : ai,
      rollup,
      monthRingOverview,
      electricityCostEurPerDay: elecPark.electricityCostEurPerDay,
      overallScoreHistory,
      uiThresholds: sqdcUiThresholdsPayload(toneDefs),
    };
  }

  async getAssetSqdcBoard(contextParkId, urlParkId, assetId, date) {
    assertParkMatchesContext(contextParkId, urlParkId);
    const { from, to } = dayBoundsUtc(date);

    const asset = await ParkAsset.findOne({
      where: { parkId: contextParkId, assetId: String(assetId) },
      include: [
        { model: RideMasterData, as: 'rideMaster', required: false },
        { model: ShowMasterData, as: 'showMaster', required: false },
        { model: RestaurantMasterData, as: 'restaurantMaster', required: false },
      ],
    });
    if (!asset) throw new AppError('Asset not found in park', 404, { code: 'ASSET_NOT_FOUND' });

    const historyFrom = addCalendarDaysIso(date, -29);
    const monthB = monthUtcBounds(date);
    const toneDefs = await loadSqdcToneThresholds();
    const assetRingTones = {
      scoreGreen: toneDefs.asset.greenMin,
      scoreAmber: toneDefs.asset.amberMin,
      costEurGreenMax: toneDefs.costEurGreenMax,
      costEurAmberMax: toneDefs.costEurAmberMax,
      peopleMoodGreenMin: toneDefs.peopleMoodGreenMin,
      peopleMoodAmberMin: toneDefs.peopleMoodAmberMin,
    };
    const [
      incidentsRes,
      events,
      moods,
      snap,
      legacySnap,
      shiftHandovers,
      downtimeEventsAsset,
      overallHistoryRows,
      monthSnapshotRows,
      monthMoodRows,
    ] = await Promise.all([
      incidentService.listForPark(contextParkId, {
        limit: 100,
        offset: 0,
        linkedEntityType: 'PARK_ASSET',
        linkedEntityId: String(assetId),
        createdFrom: from.toISOString(),
        createdTo: to.toISOString(),
      }),
      SqdcEvent.findAll({
        where: {
          parkId: contextParkId,
          eventTime: { [Op.between]: [from, to] },
          [Op.or]: [{ assetId: null }, { assetId: String(assetId) }],
        },
        order: [['eventTime', 'DESC']],
        limit: 100,
      }),
      SqdcMoodFeedback.findAll({
        where: { parkId: contextParkId, feedbackDate: date, assetId: String(assetId) },
        order: [['createdAt', 'DESC']],
        limit: 50,
      }),
      SqdcDailySnapshot.findOne({
        where: { parkId: contextParkId, assetId: String(assetId), snapshotDate: date, level: 'ASSET' },
      }),
      SqdcBoardSnapshot.findOne({
        where: { parkId: contextParkId, assetId: String(assetId), businessDate: date },
        attributes: ['deliveryOee5m', 'customerGuestCount'],
      }),
      ShiftHandoverEntry.findAll({
        where: {
          parkId: contextParkId,
          windowFrom: { [Op.lt]: to },
          windowTo: { [Op.gt]: from },
          [Op.or]: [
            { linkedEntityType: 'PARK_ASSET', linkedEntityId: String(assetId) },
            { linkedEntityId: { [Op.is]: null } },
          ],
        },
        order: [['createdAt', 'DESC']],
        limit: 25,
        include: [{ model: User, as: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'], required: false }],
      }),
      AssetDowntimeEvent.findAll({
        where: {
          parkId: contextParkId,
          assetId: String(assetId),
          startedAt: { [Op.lte]: to },
          [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: from } }],
        },
        order: [['startedAt', 'DESC']],
        limit: 50,
        include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }],
      }),
      SqdcDailySnapshot.findAll({
        where: {
          parkId: contextParkId,
          assetId: String(assetId),
          level: 'ASSET',
          snapshotDate: { [Op.between]: [historyFrom, date] },
        },
        attributes: ['snapshotDate', 'overallScore'],
        order: [['snapshotDate', 'ASC']],
      }),
      SqdcDailySnapshot.findAll({
        where: {
          parkId: contextParkId,
          assetId: String(assetId),
          level: 'ASSET',
          snapshotDate: { [Op.between]: [monthB.monthStart, monthB.monthEnd] },
        },
        attributes: ['snapshotDate', 'safetyScore', 'qualityScore', 'deliveryScore', 'customerScore', 'deliveryJson'],
        order: [['snapshotDate', 'ASC']],
      }),
      SqdcMoodFeedback.findAll({
        where: {
          parkId: contextParkId,
          assetId: String(assetId),
          feedbackDate: { [Op.between]: [monthB.monthStart, monthB.monthEnd] },
        },
        attributes: ['feedbackDate', 'moodScore'],
      }),
    ]);

    const incidents = incidentsRes.items || [];
    const moodScores = moods.map((m) => Number(m.moodScore)).filter((n) => Number.isFinite(n));
    const avgMood = moodScores.length ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null;

    const plain = asset.get({ plain: true });
    const snapPlain = snap ? snap.get({ plain: true }) : null;
    const legacyPlain = legacySnap ? legacySnap.get({ plain: true }) : null;
    const cj = snapPlain?.customerJson && typeof snapPlain.customerJson === 'object' ? snapPlain.customerJson : {};

    const oee01 = mergedOee01(snapPlain, legacyPlain?.deliveryOee5m ?? null);
    const queueMinutes = mergedQueueMinutes(snapPlain);
    const guestCountLegacy =
      legacyPlain?.customerGuestCount != null ? Number(legacyPlain.customerGuestCount) : null;
    const guestCountDaily = cj.guestCount != null ? Number(cj.guestCount) : null;
    const guestCount = Number.isFinite(guestCountLegacy)
      ? guestCountLegacy
      : Number.isFinite(guestCountDaily)
        ? guestCountDaily
        : null;

    const overallScoreHistory = overallHistoryRows.map((r) => {
      const p = r.get({ plain: true });
      const os = p.overallScore != null ? Number(p.overallScore) : null;
      return {
        snapshotDate: p.snapshotDate,
        overallScore: Number.isFinite(os) ? Math.round(os * 100) / 100 : null,
      };
    });

    const moodByDate = aggregateMoodsByDate(monthMoodRows);
    const monthRingOverview = buildMonthRingOverview(monthB, monthSnapshotRows, moodByDate, assetRingTones);

    const elec = electricityFromDeliveryJson(snapPlain);
    const deliveryJsonPlain =
      snapPlain?.deliveryJson && typeof snapPlain.deliveryJson === 'object'
        ? { ...snapPlain.deliveryJson }
        : {};

    const scores = computeScores({
      incidents,
      sqdcEvents: events.map((e) => e.get({ plain: true })),
      oee01: Number.isFinite(oee01) ? oee01 : null,
      queueMinutes: Number.isFinite(queueMinutes) ? queueMinutes : null,
      avgMood1to5: avgMood,
    });

    const openUnplannedDowntimeAsset = countOpenUnplannedDowntime(downtimeEventsAsset);
    const ai = buildAiRecommendations({
      scores,
      openCritical: events.filter((e) => e.status === 'OPEN' && e.severity === 'CRITICAL').length,
      queueMinutes: Number.isFinite(queueMinutes) ? queueMinutes : null,
      oee01: Number.isFinite(oee01) ? oee01 : null,
      avgMood1to5: avgMood,
      openUnplannedDowntime: openUnplannedDowntimeAsset,
    });

    return {
      level: 'ASSET',
      parkId: contextParkId,
      assetId: String(assetId),
      date,
      lastUpdate: new Date().toISOString(),
      asset: {
        assetId: plain.assetId,
        name: plain.name,
        slug: plain.slug,
        rideMaster: plain.rideMaster || null,
        showMaster: plain.showMaster || null,
        restaurantMaster: plain.restaurantMaster || null,
      },
      scores: snap
        ? {
            safety: Number(snap.safetyScore),
            quality: Number(snap.qualityScore),
            delivery: Number(snap.deliveryScore),
            customer: Number(snap.customerScore),
            overall: Number(snap.overallScore),
            source: 'STORED_SNAPSHOT',
          }
        : { ...scores, source: 'COMPUTED' },
      delivery: {
        oee01: Number.isFinite(oee01) ? oee01 : null,
        theoreticalCapacityPph: plain.rideMaster?.theoreticalCapacityPph ?? null,
        plannedCapacityPph: plain.rideMaster?.capacityPph ?? null,
        electricityKwhPerDay: elec.electricityKwhPerDay,
        electricityCostEurPerDay: elec.electricityCostEurPerDay,
      },
      deliveryJson: deliveryJsonPlain,
      overallScoreHistory,
      monthRingOverview,
      customer: {
        queueMinutes: Number.isFinite(queueMinutes) ? queueMinutes : null,
        guestCount: Number.isFinite(guestCount) ? guestCount : null,
      },
      deliveryProvenance: {
        oeeFrom:
          snapPlain?.deliveryJson &&
          typeof snapPlain.deliveryJson === 'object' &&
          Number.isFinite(Number(snapPlain.deliveryJson.oee01))
            ? 'DAILY_SNAPSHOT_JSON'
            : legacyPlain?.deliveryOee5m != null && Number.isFinite(Number(legacyPlain.deliveryOee5m))
              ? 'LEGACY_BOARD_SNAPSHOT'
              : null,
      },
      incidents,
      activeEvents: events.map((e) => e.get({ plain: true })),
      moodFeedback: moods.map((m) => m.get({ plain: true })),
      shiftHandovers: shiftHandovers.map((r) => serializeShiftHandoverRow(r)),
      downtimeEvents: downtimeEventsAsset.map((r) => serializeDowntimeEventRow(r, plain.name)),
      operationalKpis: {
        shiftHandoverCount: shiftHandovers.length,
        downtimeEventCount: downtimeEventsAsset.length,
        openUnplannedDowntime: openUnplannedDowntimeAsset,
      },
      aiRecommendations:
        snap && snap.aiRecommendationsJson && snap.aiRecommendationsJson.length ? snap.aiRecommendationsJson : ai,
      uiThresholds: sqdcUiThresholdsPayload(toneDefs),
      integrationHooks: {
        mqttOeeTopicExample: `smartpark/${contextParkId}/asset/${assetId}/delivery/oee`,
        mqttMoodTopicExample: `smartpark/${contextParkId}/asset/${assetId}/mood`,
        mqttSqdcEventTopicExample: `smartpark/${contextParkId}/asset/${assetId}/sqdc/event`,
      },
    };
  }

  async createSqdcEvent(parkId, payload) {
    const row = await SqdcEvent.create({
      parkId,
      assetId: payload.assetId || null,
      eventType: String(payload.eventType).toUpperCase(),
      severity: String(payload.severity || 'MEDIUM').toUpperCase(),
      title: payload.title,
      description: payload.description || null,
      status: String(payload.status || 'OPEN').toUpperCase(),
      source: String(payload.source || 'MANUAL').toUpperCase(),
      eventTime: payload.eventTime ? new Date(payload.eventTime) : new Date(),
      metadataJson: payload.metadataJson && typeof payload.metadataJson === 'object' ? payload.metadataJson : {},
    });
    return row.get({ plain: true });
  }

  async createMoodFeedback(parkId, userId, payload) {
    const score = Number(payload.moodScore);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new AppError('moodScore must be integer 1..5', 422, { code: 'INVALID_MOOD' });
    }
    const row = await SqdcMoodFeedback.create({
      parkId,
      assetId: payload.assetId || null,
      moodScore: score,
      comment: payload.comment || null,
      feedbackDate: payload.feedbackDate,
      createdByUserId: userId || null,
    });
    return row.get({ plain: true });
  }

  async saveDailySnapshot(parkId, payload) {
    const level = String(payload.level || 'ASSET').toUpperCase();
    const assetId = level === 'PARK' ? null : payload.assetId || null;
    if (level === 'ASSET' && !assetId) {
      throw new AppError('assetId required for ASSET level snapshot', 422, { code: 'ASSET_REQUIRED' });
    }
    const date = payload.snapshotDate;

    const where =
      level === 'PARK'
        ? { parkId, snapshotDate: date, level: 'PARK', assetId: { [Op.is]: null } }
        : { parkId, snapshotDate: date, level: 'ASSET', assetId: String(assetId) };

    const body = {
      safetyScore: payload.safetyScore ?? null,
      qualityScore: payload.qualityScore ?? null,
      deliveryScore: payload.deliveryScore ?? null,
      customerScore: payload.customerScore ?? null,
      overallScore: payload.overallScore ?? null,
      safetyJson: payload.safetyJson || {},
      qualityJson: payload.qualityJson || {},
      deliveryJson: payload.deliveryJson || {},
      customerJson: payload.customerJson || {},
      aiRecommendationsJson: Array.isArray(payload.aiRecommendationsJson) ? payload.aiRecommendationsJson : [],
    };

    let row = await SqdcDailySnapshot.findOne({ where });
    if (!row) {
      row = await SqdcDailySnapshot.create({
        parkId,
        assetId,
        snapshotDate: date,
        level,
        ...body,
      });
    } else {
      await row.update(body);
    }
    const fresh = await SqdcDailySnapshot.findByPk(row.id);
    return fresh.get({ plain: true });
  }
}

module.exports = { SqdcBoardService, computeScores, buildAiRecommendations, assertParkMatchesContext };
