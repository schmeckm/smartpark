/**
 * Attraction OEE MQTT simulator — Sparkplug B JSON-on-wire MVP.
 * Reuses buildSparkplugTopic, slugifyName, publishMqtt; does not open a second MQTT client.
 *
 * Contract mirrors canonicalToSparkplugPublisher payloads so a PLC/OPC-UA edge can replace this 1:1.
 */

'use strict';

const env = require('../config/env');
const { publishMqtt } = require('./mqtt-connector.service');
const { buildSparkplugTopic } = require('../modules/uns/sparkplug-topic-builder.service');
const { slugifyName } = require('../modules/uns/uns-topic-generator.service');
const { registerThemeParksDeviceDomain } = require('../modules/uns/theme-parks-entity-domain.service');
const { Op } = require('sequelize');
const { OEE_REASON_CODES } = require('../constants/oee-reason-codes');
const { logger } = require('../utils/logger');
const { emitSimulatorOeeQueueAlert } = require('../sockets');

let Park;
let ParkAsset;
let RideMasterData;
try {
  ({ Park, ParkAsset, RideMasterData } = require('../models'));
} catch {
  /* tests may omit models */
}

const STATES = Object.freeze([
  'OFF',
  'STARTING',
  'READY',
  'LOADING',
  'DISPATCHED',
  'RUNNING',
  'UNLOADING',
  'STOPPED',
  'FAULT',
  'MAINTENANCE',
  'WEATHER_HOLD',
  'NIGHT_SHUTDOWN',
]);

const SCENARIOS = Object.freeze([
  'NORMAL_OPERATION',
  'HIGH_DEMAND',
  'LOW_STAFF',
  'TRAIN_REMOVED',
  'TECHNICAL_STOP',
  'WEATHER_DELAY',
  'SLOW_LOADING',
  'FAST_DISPATCH',
  'PARK_OPENING',
  'PARK_CLOSING',
  'NIGHT_MODE',
]);

const RUNTIME_STATES = new Set(['STARTING', 'READY', 'LOADING', 'DISPATCHED', 'RUNNING', 'UNLOADING']);
const DOWNTIME_STATES = new Set(['STOPPED', 'FAULT', 'MAINTENANCE', 'WEATHER_HOLD', 'OFF', 'NIGHT_SHUTDOWN']);

const SPARKPLUG_TAGS = Object.freeze({
  source: 'attraction_oee_simulator',
  source_system: 'SIMULATOR',
  quality: 'SIMULATED',
});

/** @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sparkplugRouting(parkSlug, edgeOverride) {
  const groupId = env.sparkplugGroupId || slugifyName(parkSlug);
  const edgeNodeId = edgeOverride || env.sparkplugEdgeNode || 'park_gateway';
  return { groupId, edgeNodeId };
}

function pickFaultReason(rng) {
  const mechanical = ['UNPLANNED_MECHANICAL', 'UNPLANNED_ELECTRICAL', 'UNPLANNED_CONTROLS'];
  const idx = Math.floor(rng() * mechanical.length);
  return mechanical[idx];
}

/**
 * @param {Record<string, number>} profile
 */
function scenarioProfile(name) {
  const n = String(name || 'NORMAL_OPERATION').toUpperCase();
  const base = {
    faultRate: 0.003,
    dispatchScale: 1,
    guestScale: 1,
    trainScale: 1,
    staffScale: 1,
    queueScale: 1,
    loadScale: 1,
    downtimeBias: 1,
    energyScale: 1,
  };
  const map = {
    NORMAL_OPERATION: {},
    HIGH_DEMAND: { guestScale: 1.45, queueScale: 1.6, dispatchScale: 0.88, faultRate: 0.002 },
    LOW_STAFF: { staffScale: 0.65, dispatchScale: 1.25, faultRate: 0.004 },
    TRAIN_REMOVED: { trainScale: 0.75, dispatchScale: 1.15, faultRate: 0.0025 },
    TECHNICAL_STOP: { faultRate: 0.02, downtimeBias: 2.5, dispatchScale: 1.4 },
    WEATHER_DELAY: { faultRate: 0.008, downtimeBias: 2, queueScale: 1.2 },
    SLOW_LOADING: { loadScale: 1.8, dispatchScale: 1.05, guestScale: 0.9 },
    FAST_DISPATCH: { dispatchScale: 0.72, loadScale: 0.85, guestScale: 1.1 },
    PARK_OPENING: { faultRate: 0.001, dispatchScale: 1.2, guestScale: 0.6 },
    PARK_CLOSING: { faultRate: 0.001, guestScale: 0.4, dispatchScale: 0.9 },
    NIGHT_MODE: { faultRate: 0, guestScale: 0, trainScale: 0.5, staffScale: 0.3 },
  };
  return { ...base, ...(map[n] || {}) };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {Array<{ t: number; runtimeMs: number; downtimeMs: number; planned: number; actual: number; good: number; bad: number }>} hist
 * @param {number} windowMs
 * @param {number} now
 */
/**
 * Resolve platform asset UUIDs to slugs for the active park (MD-driven simulator selection).
 * @param {{ parkId?: string | null; parkSlug: string; assetIds: string[] }} p
 * @returns {Promise<string[]>}
 */
async function resolveAssetIdsToSlugs({ parkId, parkSlug, assetIds }) {
  if (!Park || !ParkAsset || !Array.isArray(assetIds) || !assetIds.length) return [];
  let pid = parkId || null;
  if (!pid && parkSlug) {
    const park = await Park.findOne({ where: { slug: parkSlug } });
    pid = park?.id || null;
  }
  if (!pid) return [];
  const rows = await ParkAsset.findAll({
    where: { parkId: pid, assetId: { [Op.in]: assetIds } },
    attributes: ['assetId', 'slug'],
  });
  const order = new Map(assetIds.map((id, i) => [String(id), i]));
  return rows
    .map((r) => ({ slug: r.slug, ord: order.get(String(r.assetId)) ?? 999 }))
    .sort((a, b) => a.ord - b.ord)
    .map((x) => slugifyName(x.slug))
    .filter(Boolean);
}

function aggregateOeeWindow(hist, windowMs, now) {
  const from = now - windowMs;
  let runtimeMs = 0;
  let downtimeMs = 0;
  let plannedSum = 0;
  let actualSum = 0;
  let good = 0;
  let bad = 0;
  let n = 0;
  for (const row of hist) {
    if (row.t < from) continue;
    runtimeMs += row.runtimeMs;
    downtimeMs += row.downtimeMs;
    plannedSum += row.planned;
    actualSum += row.actual;
    good += row.good;
    bad += row.bad;
    n += 1;
  }
  const denom = runtimeMs + downtimeMs;
  const A = denom > 0 ? runtimeMs / denom : 0;
  const plannedAvg = n > 0 ? plannedSum / n : 0;
  const actualAvg = n > 0 ? actualSum / n : 0;
  const P = plannedAvg > 0 ? clamp(actualAvg / plannedAvg, 0, 1.2) : 0;
  const Q = good + bad > 0 ? good / (good + bad) : 1;
  const oee = clamp(A, 0, 1) * clamp(P, 0, 1) * clamp(Q, 0, 1);
  return {
    availability: A * 100,
    performance: clamp(P, 0, 1) * 100,
    quality: clamp(Q, 0, 1) * 100,
    oee: oee * 100,
    samples: n,
  };
}

class AttractionSite {
  /**
   * @param {{
   *   slug: string;
   *   displayName: string;
   *   assetId?: string | null;
   *   plannedCapacityPph: number;
   *   dispatchIntervalSec: number;
   *   configuredTrains: number;
   *   requiredOperators: number;
   *   seatsPerCycle?: number;
   *   cycleTimeSec?: number | null;
   *   plannedCycleTimeSec?: number | null;
   *   opcReferenceCycleTimeSec?: number | null;
   *   maxQueueGuests?: number | null;
   *   virtualLineEnabled?: boolean;
   * }} p
   */
  constructor(p) {
    this.slug = p.slug;
    this.displayName = p.displayName;
    this.assetId = p.assetId != null ? String(p.assetId) : null;
    this.plannedCapacityPph = p.plannedCapacityPph;
    this.dispatchIntervalSec = p.dispatchIntervalSec;
    this.configuredTrains = p.configuredTrains;
    this.requiredOperators = p.requiredOperators;
    this.seatsPerCycle = p.seatsPerCycle != null && Number.isFinite(Number(p.seatsPerCycle)) ? Number(p.seatsPerCycle) : 4;
    this.cycleTimeSec = p.cycleTimeSec != null && Number.isFinite(Number(p.cycleTimeSec)) ? Number(p.cycleTimeSec) : null;
    this.plannedCycleTimeSec =
      p.plannedCycleTimeSec != null && Number.isFinite(Number(p.plannedCycleTimeSec)) ? Number(p.plannedCycleTimeSec) : null;
    this.opcReferenceCycleTimeSec =
      p.opcReferenceCycleTimeSec != null && Number.isFinite(Number(p.opcReferenceCycleTimeSec))
        ? Number(p.opcReferenceCycleTimeSec)
        : null;
    this.maxQueueGuests =
      p.maxQueueGuests != null && Number.isFinite(Number(p.maxQueueGuests)) ? Number(p.maxQueueGuests) : null;
    this.virtualLineEnabled = Boolean(p.virtualLineEnabled);
    this.state = 'OFF';
    this.stateUntil = 0;
    this.scenario = 'NORMAL_OPERATION';
    this.trainDispatchCounter = 0;
    this.trainReturnCounter = 0;
    this.guestsInCounter = 0;
    this.guestsOutCounter = 0;
    this.cycleStartTs = null;
    this.cycleEndTs = null;
    this.downtimeReasonCode = null;
    this.downtimeStartedAt = null;
    this.abortedCycles = 0;
    this.completedCycles = 0;
    this.lastGuestMismatch = 0;
    /** @type {Array<{ t: number; runtimeMs: number; downtimeMs: number; planned: number; actual: number; good: number; bad: number }>} */
    this.history = [];
    this._lastHistoryPush = 0;
    this._lastQueueWarnAt = 0;
    /** @type {{ depth: number; cap: number; warn: boolean } | null} */
    this._lastQueueSnapshot = null;
  }

  /** MD: explicit cap, else heuristic from seats × trains (waiting area proxy). */
  queueCapacityLimit() {
    if (this.maxQueueGuests != null && this.maxQueueGuests > 0) return this.maxQueueGuests;
    return Math.max(50, Math.ceil(this.seatsPerCycle * Math.max(1, this.configuredTrains) * 10));
  }

  queueDepth() {
    return Math.max(0, this.guestsInCounter - this.guestsOutCounter);
  }

  /** OPC snapshot (s) wins over planned MD, else legacy cycleTimeSec, else default. */
  baseRideDurationSec() {
    if (this.opcReferenceCycleTimeSec != null && this.opcReferenceCycleTimeSec > 0) return this.opcReferenceCycleTimeSec;
    if (this.plannedCycleTimeSec != null && this.plannedCycleTimeSec > 0) return this.plannedCycleTimeSec;
    if (this.cycleTimeSec != null && this.cycleTimeSec > 0) return this.cycleTimeSec;
    return 90;
  }

  /**
   * @param {number} now
   * @param {string} parkSlug
   * @param {string} groupId
   */
  emitQueueOvercapacityIfNeeded(now, parkSlug, groupId) {
    const snap = this._lastQueueSnapshot;
    if (!snap?.warn) return;
    if (now - this._lastQueueWarnAt < 25000) return;
    this._lastQueueWarnAt = now;
    emitSimulatorOeeQueueAlert({
      type: 'QUEUE_OVERCAPACITY',
      parkSlug,
      groupId,
      assetSlug: this.slug,
      assetId: this.assetId,
      queueOccupancy: snap.depth,
      queueCapacityLimit: snap.cap,
      message: `Queue over capacity: ${this.slug} (${snap.depth} > ${snap.cap})`,
      at: new Date(now).toISOString(),
    });
  }

  /**
   * @param {number} intervalMs
   * @param {number} now
   * @param {() => number} rng
   * @param {Record<string, number>} prof
   */
  step(intervalMs, now, rng, prof) {
    const dispatchBase = Math.max(8000, (this.dispatchIntervalSec * 1000) / prof.dispatchScale);
    const loadMs = clamp(4000 * prof.loadScale * (0.85 + rng() * 0.35), 2500, 45000);
    const baseRideSec = this.baseRideDurationSec();
    const rideMs = clamp(baseRideSec * 1000 * (0.92 + rng() * 0.16), 8000, 600000);
    const unloadMs = clamp(5000 * (0.85 + rng() * 0.3), 3000, 20000);
    const startingMs = 5000 + rng() * 4000;
    const dispatchedMs = 2000 + rng() * 3000;

    const faultP = 1 - (1 - prof.faultRate) ** (intervalMs / 60000);
    const closingPressure = this.scenario === 'PARK_CLOSING' && RUNTIME_STATES.has(this.state) ? 0.12 : 0;

    if (now < this.stateUntil && !(closingPressure && rng() < closingPressure && this.state === 'READY')) {
      this._pushHistory(intervalMs, now, prof);
      return;
    }

    const goFault = () => {
      this.state = 'FAULT';
      this.downtimeReasonCode = pickFaultReason(rng);
      this.downtimeStartedAt = new Date(now).toISOString();
      this.stateUntil = now + (180000 + rng() * 240000) * prof.downtimeBias;
      this.abortedCycles += 1;
      this.cycleEndTs = new Date(now).toISOString();
    };

    switch (this.state) {
      case 'OFF':
        if (this.scenario === 'NIGHT_MODE') {
          this.stateUntil = now + intervalMs;
          break;
        }
        this.state = 'STARTING';
        this.stateUntil = now + startingMs;
        break;
      case 'STARTING':
        this.state = 'READY';
        this.stateUntil = now + dispatchBase * (0.7 + rng() * 0.6);
        break;
      case 'READY':
        if (rng() < faultP * 1.2) {
          if (rng() < 0.33) {
            this.state = 'WEATHER_HOLD';
            this.downtimeReasonCode = 'UNPLANNED_WEATHER';
            this.downtimeStartedAt = new Date(now).toISOString();
            this.stateUntil = now + (120000 + rng() * 300000) * prof.downtimeBias;
          } else if (rng() < 0.5) {
            this.state = 'STOPPED';
            this.downtimeReasonCode = 'UNPLANNED_OTHER';
            this.downtimeStartedAt = new Date(now).toISOString();
            this.stateUntil = now + (60000 + rng() * 120000) * prof.downtimeBias;
          } else {
            this.state = 'MAINTENANCE';
            this.downtimeReasonCode = 'PLANNED_MAINTENANCE';
            this.downtimeStartedAt = new Date(now).toISOString();
            this.stateUntil = now + (300000 + rng() * 600000) * prof.downtimeBias;
          }
        } else if (closingPressure && rng() < closingPressure) {
          this.state = 'NIGHT_SHUTDOWN';
          this.stateUntil = now + 20000 + rng() * 15000;
        } else {
          this.state = 'LOADING';
          this.stateUntil = now + loadMs;
        }
        break;
      case 'LOADING': {
        const batch = Math.max(4, Math.floor(24 * prof.guestScale * (0.7 + rng() * 0.5)));
        this.guestsInCounter += batch;
        this.state = 'DISPATCHED';
        this.stateUntil = now + dispatchedMs;
        break;
      }
      case 'DISPATCHED':
        this.trainDispatchCounter += 1;
        this.state = 'RUNNING';
        this.cycleStartTs = new Date(now).toISOString();
        this.stateUntil = now + rideMs;
        break;
      case 'RUNNING':
        if (rng() < faultP * 0.9) {
          goFault();
        } else {
          this.cycleEndTs = new Date(now).toISOString();
          this.completedCycles += 1;
          this.state = 'UNLOADING';
          this.stateUntil = now + unloadMs;
        }
        break;
      case 'UNLOADING': {
        const pending = Math.max(0, this.guestsInCounter - this.guestsOutCounter);
        const outBatch = Math.max(
          4,
          Math.floor(this.guestsInCounter * 0.02 * prof.guestScale * (0.85 + rng() * 0.25))
        );
        this.guestsOutCounter += Math.min(pending, outBatch);
        if (rng() < 0.08) this.lastGuestMismatch += Math.floor(rng() * 4);
        this.trainReturnCounter += 1;
        this.state = 'READY';
        this.stateUntil = now + dispatchBase * (0.65 + rng() * 0.55);
        break;
      }
      case 'STOPPED':
      case 'WEATHER_HOLD':
      case 'MAINTENANCE':
        this.downtimeReasonCode = null;
        this.downtimeStartedAt = null;
        this.state = 'READY';
        this.stateUntil = now + dispatchBase * (0.5 + rng() * 0.4);
        break;
      case 'FAULT':
        this.downtimeReasonCode = null;
        this.downtimeStartedAt = null;
        this.state = 'READY';
        this.stateUntil = now + dispatchBase * (0.8 + rng() * 0.5);
        break;
      case 'NIGHT_SHUTDOWN':
        this.state = 'OFF';
        this.stateUntil = now + 60000 + rng() * 120000;
        break;
      default:
        this.stateUntil = now + intervalMs;
    }
    this._pushHistory(intervalMs, now, prof);
  }

  /**
   * @param {number} intervalMs
   * @param {number} now
   * @param {Record<string, number>} prof
   */
  _pushHistory(intervalMs, now, prof) {
    if (now - this._lastHistoryPush < intervalMs * 0.5) return;
    this._lastHistoryPush = now;
    const rt = RUNTIME_STATES.has(this.state) ? intervalMs : 0;
    const dt = DOWNTIME_STATES.has(this.state) ? intervalMs : 0;
    const trains = this.availableTrains(prof);
    const theoretical = this.theoreticalPph(trains);
    const actual = this.actualPphEstimate(prof);
    const bad = this.state === 'FAULT' ? 1 : 0;
    const good = this.state === 'UNLOADING' ? 1 : 0;
    this.history.push({
      t: now,
      runtimeMs: rt,
      downtimeMs: dt,
      planned: theoretical,
      actual,
      good,
      bad,
    });
    if (this.history.length > 12000) this.history.splice(0, this.history.length - 12000);
  }

  availableTrains(prof) {
    const n = Math.max(1, Math.round(this.configuredTrains * prof.trainScale));
    return this.scenario === 'TRAIN_REMOVED' ? Math.max(1, n - 1) : n;
  }

  theoreticalPph(trains) {
    const di = Math.max(1, this.dispatchIntervalSec);
    const perTrain = (3600 / di) * 24 * trains;
    return Math.min(this.plannedCapacityPph, Math.floor(perTrain));
  }

  actualPphEstimate(prof) {
    const tr = this.availableTrains(prof);
    const base = this.theoreticalPph(tr) * (0.82 + prof.guestScale * 0.08);
    if (this.state === 'FAULT' || this.state === 'MAINTENANCE') return Math.floor(base * 0.05);
    if (RUNTIME_STATES.has(this.state)) return Math.floor(base * (this.state === 'RUNNING' ? 1.05 : 0.95));
    return Math.floor(base * 0.35);
  }

  oeeSnapshot(now) {
    return {
      oee5m: aggregateOeeWindow(this.history, 5 * 60 * 1000, now),
      oee15m: aggregateOeeWindow(this.history, 15 * 60 * 1000, now),
      shift: aggregateOeeWindow(this.history, 8 * 60 * 60 * 1000, now),
      daily: aggregateOeeWindow(this.history, 24 * 60 * 60 * 1000, now),
    };
  }

  /**
   * @param {Record<string, number>} prof
   * @param {() => number} rng
   */
  buildMetrics(now, prof, rng) {
    const trains = this.availableTrains(prof);
    const planned = this.plannedCapacityPph;
    const actual = this.actualPphEstimate(prof);
    const qDepth = this.queueDepth();
    const qCap = this.queueCapacityLimit();
    const qWarn = qDepth > qCap;
    this._lastQueueSnapshot = { depth: qDepth, cap: qCap, warn: qWarn };
    const opReq = Math.max(1, Math.ceil(this.requiredOperators));
    const opCount = clamp(Math.round(opReq * prof.staffScale + rng() * 1.2 - 0.4), 0, opReq + 4);
    const queueMin = clamp(
      (actual > 0 ? planned / Math.max(1, actual) - 1 : 0.5) * 12 * prof.queueScale,
      0,
      180
    );
    const downtimeActive = DOWNTIME_STATES.has(this.state) && this.state !== 'OFF';
    const durSec =
      this.downtimeStartedAt && downtimeActive
        ? Math.floor((now - new Date(this.downtimeStartedAt).getTime()) / 1000)
        : 0;
    const energy = 40 + trains * 18 + (this.state === 'RUNNING' ? 120 : 30) * prof.energyScale;
    const rideCycleActive = ['DISPATCHED', 'RUNNING'].includes(this.state);
    const oee5 = aggregateOeeWindow(this.history, 5 * 60 * 1000, now);

    return [
      { name: 'asset_state', value: this.state },
      { name: 'ride_cycle_active', value: rideCycleActive },
      { name: 'cycle_start_ts', value: this.cycleStartTs },
      { name: 'cycle_end_ts', value: this.cycleEndTs },
      { name: 'train_dispatch_counter', value: this.trainDispatchCounter },
      { name: 'train_return_counter', value: this.trainReturnCounter },
      { name: 'guests_in_counter', value: this.guestsInCounter },
      { name: 'guests_out_counter', value: this.guestsOutCounter },
      { name: 'planned_capacity_pph', value: planned },
      { name: 'actual_capacity_pph', value: actual },
      { name: 'available_trains', value: trains },
      { name: 'configured_trains', value: this.configuredTrains },
      { name: 'operator_count', value: opCount },
      { name: 'required_operator_count', value: opReq },
      { name: 'queue_estimated_minutes', value: Math.round(queueMin * 10) / 10 },
      { name: 'queue_time', value: Math.round(queueMin * 10) / 10 },
      { name: 'downtime_active', value: downtimeActive },
      {
        name: 'downtime_reason_code',
        value: this.downtimeReasonCode && OEE_REASON_CODES.includes(this.downtimeReasonCode) ? this.downtimeReasonCode : null,
      },
      { name: 'downtime_duration_sec', value: durSec },
      { name: 'dispatch_interval_sec', value: this.dispatchIntervalSec },
      { name: 'planned_cycle_time_sec', value: this.plannedCycleTimeSec },
      { name: 'opc_reference_cycle_time_sec', value: this.opcReferenceCycleTimeSec },
      { name: 'cycle_time_sec', value: this.cycleTimeSec },
      { name: 'max_queue_guests', value: this.maxQueueGuests },
      { name: 'queue_occupancy', value: qDepth },
      { name: 'queue_capacity_limit', value: qCap },
      { name: 'queue_overcapacity_warning', value: qWarn },
      { name: 'virtual_line_enabled', value: this.virtualLineEnabled ? 1 : 0 },
      { name: 'scenario', value: this.scenario },
      { name: 'oee_5m', value: Math.round(oee5.oee * 10) / 10 },
      { name: 'oee_availability_5m', value: Math.round(oee5.availability * 10) / 10 },
      { name: 'oee_performance_5m', value: Math.round(oee5.performance * 10) / 10 },
      { name: 'oee_quality_5m', value: Math.round(oee5.quality * 10) / 10 },
      { name: 'energy_kw', value: Math.round(energy * 10) / 10 },
      { name: 'source_system', value: 'SIMULATOR' },
      { name: 'quality', value: 'SIMULATED' },
      { name: 'aborted_cycles', value: this.abortedCycles },
      { name: 'completed_cycles', value: this.completedCycles },
      { name: 'guest_flow_mismatch', value: this.lastGuestMismatch },
    ];
  }
}

class AttractionOeeSimulator {
  /**
   * @param {{ publishMqtt?: typeof publishMqtt }} deps
   */
  constructor(deps = {}) {
    /** @type {typeof publishMqtt} */
    this._publishMqtt = deps.publishMqtt || publishMqtt;
    /** @type {Map<string, AttractionSite>} */
    this.sites = new Map();
    this.running = false;
    this.timer = null;
    /** @type {ReturnType<typeof mulberry32>|null} */
    this.rng = null;
    this.config = {
      parkSlug: 'europa_park',
      edgeNodeId: null,
      publishMs: 3000,
      scenario: 'NORMAL_OPERATION',
      randomSeed: 42,
    };
    this._nbirthSent = false;
    this._groupId = '';
    this._edgeNodeId = '';
  }

  resolveConfig(overrides = {}) {
    const e = env;
    const parkSlug = String(overrides.parkSlug || e.simOeeParkSlug || e.simParkId || 'europa_park').trim();
    const parkId = overrides.parkId != null && String(overrides.parkId).trim() !== '' ? String(overrides.parkId).trim() : null;
    const edgeNodeId = overrides.edgeNodeId || e.simOeeEdgeNode || e.simEdgeNode || null;
    const publishMs = Math.max(500, Number(overrides.publishMs || e.simOeePublishMs || e.simPublishMs) || 3000);
    const scenario = String(overrides.scenario || e.simOeeScenario || e.simScenario || 'NORMAL_OPERATION');
    const randomSeed = Number(overrides.randomSeed ?? e.simOeeRandomSeed ?? e.simRandomSeed ?? 42);
    let rawAttr = overrides.attractions ?? e.simOeeAttractions ?? e.simAttractions ?? 'blue_fire,silver_star';
    if (Array.isArray(rawAttr)) rawAttr = rawAttr.join(',');
    const attractions = String(rawAttr)
      .split(',')
      .map((s) => slugifyName(s))
      .filter(Boolean);
    const assetIds = Array.isArray(overrides.assetIds)
      ? overrides.assetIds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    return { parkSlug, parkId, edgeNodeId, publishMs, scenario, randomSeed, attractions, assetIds };
  }

  async loadSitesFromMasterData(cfg) {
    const defaults = (slug) => ({
      slug,
      displayName: slug.replace(/_/g, ' '),
      assetId: null,
      plannedCapacityPph: 1200,
      dispatchIntervalSec: 90,
      configuredTrains: 3,
      requiredOperators: 3,
      seatsPerCycle: 4,
      cycleTimeSec: null,
      plannedCycleTimeSec: null,
      opcReferenceCycleTimeSec: null,
      maxQueueGuests: null,
      virtualLineEnabled: false,
    });
    if (!Park || !ParkAsset || !RideMasterData) {
      return cfg.attractions.map((slug) => new AttractionSite(defaults(slug)));
    }
    try {
      const park = await Park.findOne({ where: { slug: cfg.parkSlug } });
      if (!park) {
        return cfg.attractions.map((slug) => new AttractionSite(defaults(slug)));
      }
      const assets = await ParkAsset.findAll({
        where: { parkId: park.id, slug: { [Op.in]: cfg.attractions } },
      });
      const bySlug = new Map(assets.map((a) => [a.slug, a]));
      const out = [];
      for (const slug of cfg.attractions) {
        const row = bySlug.get(slug);
        if (!row) {
          out.push(new AttractionSite(defaults(slug)));
          continue;
        }
        const rm = await RideMasterData.findByPk(row.assetId);
        const cap =
          rm?.theoreticalCapacityPph != null
            ? Number(rm.theoreticalCapacityPph)
            : rm?.capacityPph != null
              ? Number(rm.capacityPph)
              : 1200;
        const di = rm?.dispatchIntervalSec != null ? Number(rm.dispatchIntervalSec) : 90;
        const trains = rm?.trainsCount != null ? Number(rm.trainsCount) : 3;
        const seats = rm?.seatsPerCycle != null ? Number(rm.seatsPerCycle) : 4;
        const cyc = rm?.cycleTimeSec != null ? Number(rm.cycleTimeSec) : null;
        const plannedCyc = rm?.plannedCycleTimeSec != null ? Number(rm.plannedCycleTimeSec) : null;
        const opcCyc = rm?.opcReferenceCycleTimeSec != null ? Number(rm.opcReferenceCycleTimeSec) : null;
        const maxQ = rm?.maxQueueGuests != null ? Number(rm.maxQueueGuests) : null;
        const vl = rm?.virtualLineEnabled === true || rm?.virtualLineEnabled === 1;
        out.push(
          new AttractionSite({
            slug,
            assetId: row.assetId,
            displayName: row.name || slug,
            plannedCapacityPph: Number.isFinite(cap) ? cap : 1200,
            dispatchIntervalSec: Number.isFinite(di) ? di : 90,
            configuredTrains: Number.isFinite(trains) ? trains : 3,
            requiredOperators: rm?.normalStaff != null ? Number(rm.normalStaff) : 3,
            seatsPerCycle: Number.isFinite(seats) ? seats : 4,
            cycleTimeSec: Number.isFinite(cyc) ? cyc : null,
            plannedCycleTimeSec: Number.isFinite(plannedCyc) ? plannedCyc : null,
            opcReferenceCycleTimeSec: Number.isFinite(opcCyc) ? opcCyc : null,
            maxQueueGuests: Number.isFinite(maxQ) ? maxQ : null,
            virtualLineEnabled: vl,
          })
        );
      }
      return out;
    } catch (err) {
      logger.warn({ err: err.message }, 'attraction OEE sim: master data load failed, using defaults');
      return cfg.attractions.map((slug) => new AttractionSite(defaults(slug)));
    }
  }

  async start(overrides = {}) {
    if (this.running) {
      return { ok: true, alreadyRunning: true, config: this.getStatus().config };
    }
    const ov = { ...(overrides || {}) };
    if (Array.isArray(ov.assetIds) && ov.assetIds.length) {
      const slugs = await resolveAssetIdsToSlugs({
        parkId: ov.parkId || null,
        parkSlug: String(ov.parkSlug || env.simOeeParkSlug || env.simParkId || 'europa_park').trim(),
        assetIds: ov.assetIds,
      });
      if (!slugs.length) {
        return { ok: false, error: 'asset_ids_not_found' };
      }
      ov.attractions = slugs;
    }
    const cfg = this.resolveConfig(ov);
    if (!cfg.attractions.length) {
      return { ok: false, error: 'no_attractions' };
    }
    const { groupId, edgeNodeId } = sparkplugRouting(cfg.parkSlug, cfg.edgeNodeId);
    this._groupId = groupId;
    this._edgeNodeId = edgeNodeId;
    this.config = { ...cfg, groupId, edgeNodeId, parkId: cfg.parkId || null };
    this.rng = mulberry32(cfg.randomSeed);
    const sites = await this.loadSitesFromMasterData(cfg);
    this.sites = new Map(sites.map((s) => [s.slug, s]));
    for (const s of this.sites.values()) {
      s.scenario = cfg.scenario;
      s.state = cfg.scenario === 'NIGHT_MODE' ? 'OFF' : 'OFF';
      s.stateUntil = 0;
    }
    await this._ensureNbirth();
    for (const s of this.sites.values()) {
      await this._publishDbirth(s);
    }
    this.running = true;
    const intervalMs = cfg.publishMs;
    this.timer = setInterval(() => {
      this.tick(intervalMs).catch((e) => logger.warn({ err: e.message }, 'attraction OEE sim tick'));
    }, intervalMs);
    logger.info({ attractions: [...this.sites.keys()], groupId, edgeNodeId }, 'attraction OEE simulator started');
    return { ok: true, config: this.getStatus().config };
  }

  async _ensureNbirth() {
    if (this._nbirthSent) return;
    const topic = buildSparkplugTopic({
      groupId: this._groupId,
      messageType: 'NBIRTH',
      edgeNodeId: this._edgeNodeId,
    });
    const payload = {
      timestamp: new Date().toISOString(),
      metrics: [{ name: 'node_role', value: 'smart_park_attraction_oee_sim' }],
      tags: { ...SPARKPLUG_TAGS },
    };
    await this._sendMqtt(topic, payload);
    this._nbirthSent = true;
  }

  async _publishDbirth(site) {
    const topic = buildSparkplugTopic({
      groupId: this._groupId,
      messageType: 'DBIRTH',
      edgeNodeId: this._edgeNodeId,
      deviceId: site.slug,
    });
    const payload = {
      timestamp: new Date().toISOString(),
      metrics: [
        { name: 'entity_type', value: 'rides' },
        { name: 'display_name', value: site.displayName },
        { name: 'source_system', value: 'SIMULATOR' },
        { name: 'theoretical_capacity', value: site.plannedCapacityPph },
      ],
      tags: { ...SPARKPLUG_TAGS },
    };
    await this._sendMqtt(topic, payload);
    registerThemeParksDeviceDomain({
      groupId: this._groupId,
      deviceId: site.slug,
      domain: 'rides',
      entityType: 'RIDE',
    });
  }

  async _publishDdata(site, metrics) {
    const topic = buildSparkplugTopic({
      groupId: this._groupId,
      messageType: 'DDATA',
      edgeNodeId: this._edgeNodeId,
      deviceId: site.slug,
    });
    const payload = {
      timestamp: new Date().toISOString(),
      metrics,
      tags: { ...SPARKPLUG_TAGS },
    };
    await this._sendMqtt(topic, payload);
  }

  async _sendMqtt(topic, payload) {
    await this._publishMqtt(topic, payload);
  }

  async tick(intervalMs) {
    if (!this.running || !this.rng) return;
    const now = Date.now();
    const prof = scenarioProfile(this.config.scenario);
    const rng = this.rng;
    for (const site of this.sites.values()) {
      site.scenario = this.config.scenario;
      if (this.config.scenario === 'TECHNICAL_STOP' && site.state === 'RUNNING' && rng() < 0.15) {
        site.state = 'FAULT';
        site.downtimeReasonCode = 'UNPLANNED_CONTROLS';
        site.downtimeStartedAt = new Date(now).toISOString();
        site.stateUntil = now + 120000 + rng() * 180000;
        site.abortedCycles += 1;
      } else {
        site.step(intervalMs, now, rng, prof);
      }
      const metrics = site.buildMetrics(now, prof, rng);
      await this._publishDdata(site, metrics);
      site.emitQueueOvercapacityIfNeeded(now, this.config.parkSlug, this._groupId);
    }
  }

  getStatus() {
    const now = Date.now();
    const attractions = [...this.sites.values()].map((s) => {
      const downtimeT = s.downtimeStartedAt ? new Date(s.downtimeStartedAt).getTime() : 0;
      const unplannedDisturbance = ['FAULT', 'MAINTENANCE', 'WEATHER_HOLD'].includes(s.state);
      const downtimeSec =
        downtimeT > 0 && unplannedDisturbance && Number.isFinite(now - downtimeT)
          ? Math.floor((now - downtimeT) / 1000)
          : null;
      return {
        assetId: s.assetId,
        slug: s.slug,
        displayName: s.displayName,
        state: s.state,
        scenario: s.scenario,
        metricsPreview: {
          dispatches: s.trainDispatchCounter,
          guestsIn: s.guestsInCounter,
          guestsOut: s.guestsOutCounter,
          virtualLineEnabled: s.virtualLineEnabled,
          downtimeReasonCode: s.downtimeReasonCode,
          downtimeSec,
          disturbanceActive: unplannedDisturbance,
        },
        queue: s._lastQueueSnapshot
          ? {
              occupancy: s._lastQueueSnapshot.depth,
              capacityLimit: s._lastQueueSnapshot.cap,
              overcapacity: s._lastQueueSnapshot.warn,
            }
          : null,
        oee: s.oeeSnapshot(now),
      };
    });
    return {
      running: this.running,
      config: {
        parkSlug: this.config.parkSlug,
        parkId: this.config.parkId || null,
        groupId: this._groupId,
        edgeNodeId: this._edgeNodeId,
        publishMs: this.config.publishMs,
        scenario: this.config.scenario,
        randomSeed: this.config.randomSeed,
        attractions: this.config.attractions,
      },
      attractions,
    };
  }

  setScenario(name) {
    const n = String(name || '').toUpperCase();
    if (!SCENARIOS.includes(n)) return { ok: false, error: 'unknown_scenario' };
    this.config.scenario = n;
    for (const s of this.sites.values()) s.scenario = n;
    return { ok: true, scenario: n };
  }

  async stop() {
    if (!this.running) {
      return { ok: true, stopped: false };
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    const ts = new Date().toISOString();
    for (const site of this.sites.values()) {
      const topicD = buildSparkplugTopic({
        groupId: this._groupId,
        messageType: 'DDEATH',
        edgeNodeId: this._edgeNodeId,
        deviceId: site.slug,
      });
      await this._sendMqtt(topicD, {
        timestamp: ts,
        metrics: [{ name: 'source_system', value: 'SIMULATOR' }],
        tags: { ...SPARKPLUG_TAGS },
      });
    }
    if (this._nbirthSent) {
      const topicN = buildSparkplugTopic({
        groupId: this._groupId,
        messageType: 'NDEATH',
        edgeNodeId: this._edgeNodeId,
      });
      await this._sendMqtt(topicN, {
        timestamp: ts,
        metrics: [{ name: 'source_system', value: 'SIMULATOR' }],
        tags: { ...SPARKPLUG_TAGS },
      });
      this._nbirthSent = false;
    }
    this.sites.clear();
    this.rng = null;
    this._groupId = '';
    this._edgeNodeId = '';
    logger.info('attraction OEE simulator stopped');
    return { ok: true, stopped: true };
  }
}

let singleton = new AttractionOeeSimulator();

function startAttractionOeeSimulator(overrides) {
  return singleton.start(overrides);
}

function stopAttractionOeeSimulator() {
  return singleton.stop();
}

function setAttractionOeeScenario(name) {
  return singleton.setScenario(name);
}

function getAttractionOeeSimulatorStatus() {
  return singleton.getStatus();
}

function createAttractionOeeSimulatorForTests(deps) {
  return new AttractionOeeSimulator(deps);
}

module.exports = {
  STATES,
  SCENARIOS,
  AttractionSite,
  AttractionOeeSimulator,
  scenarioProfile,
  aggregateOeeWindow,
  startAttractionOeeSimulator,
  stopAttractionOeeSimulator,
  setAttractionOeeScenario,
  getAttractionOeeSimulatorStatus,
  createAttractionOeeSimulatorForTests,
};