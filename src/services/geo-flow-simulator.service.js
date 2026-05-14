'use strict';

const { Op } = require('sequelize');
const { GeoPressureEngineService } = require('./geo-pressure-engine.service');
const { distanceMeters } = require('./geo-pressure-scoring');

/** @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {() => number} rng
 * @param {T[]} items
 * @param {(t: T) => number} weight
 */
function weightedPick(rng, items, weight) {
  let sum = 0;
  const w = items.map((it) => Math.max(1e-12, weight(it)));
  for (const x of w) sum += x;
  let r = rng() * sum;
  for (let i = 0; i < items.length; i += 1) {
    r -= w[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * @param {Array<{ source: string; target: string; perStep: number[]; sourceName?: string; targetName?: string }>} edgesFull
 * @param {number} transitionCount
 */
function buildCumulativeTicks(edgesFull, transitionCount) {
  const ticks = [];
  for (let s = 0; s < transitionCount; s += 1) {
    const linkAgg = new Map();
    for (const e of edgesFull) {
      let cum = 0;
      for (let i = 0; i <= s; i += 1) cum += e.perStep[i] || 0;
      if (cum > 0) linkAgg.set(`${e.source}→${e.target}`, { source: e.source, target: e.target, value: cum });
    }
    ticks.push({
      step: s,
      label: `Transition ${s + 1} (cumulative)`,
      links: [...linkAgg.values()]
        .filter((l) => l.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 40),
    });
  }
  return ticks;
}

/**
 * @param {import('./geo-pressure-engine.service').GeoPressureEngineService} engine
 * @param {string} parkId
 * @param {{ guestCount?: number, transitionCount?: number, maxHopM?: number, seed?: number|null, assetTypeCode?: string, topEdges?: number }} opts
 */
async function runVisitorFlowSimulation(parkId, opts = {}) {
  const engine = new GeoPressureEngineService();
  const payload = await engine.buildPressurePayload(parkId, {
    mode: 'live',
    assetTypeCode: opts.assetTypeCode,
  });
  if (payload.error) return payload;

  const guestCount = Math.min(8000, Math.max(50, Number(opts.guestCount) || 600));
  const transitionCount = Math.min(25, Math.max(2, Number(opts.transitionCount) || 5));
  const maxHopM = Math.min(1500, Math.max(120, Number(opts.maxHopM) || 420));
  const topEdges = Math.min(80, Math.max(15, Number(opts.topEdges) || 45));
  const seed =
    opts.seed != null && Number.isFinite(Number(opts.seed)) ? Math.floor(Number(opts.seed)) : Math.floor(Date.now() % 2147483647);
  const rng = mulberry32(seed);

  let nodes = payload.entities.filter(
    (e) => e.lat != null && e.lng != null && Number.isFinite(e.lat) && Number.isFinite(e.lng)
  );
  if (nodes.length < 2) {
    return {
      park: payload.park,
      generatedAt: new Date().toISOString(),
      mode: 'synthetic_process_mining',
      parameters: {
        mode: 'synthetic',
        guestCount,
        transitionCount,
        maxHopM,
        seed,
        topEdges,
        assetTypeCode: opts.assetTypeCode || null,
      },
      nodes: nodes.map((n) => ({
        id: n.assetId,
        slug: n.slug,
        name: n.name,
        entityType: n.entityType,
        lat: n.lat,
        lng: n.lng,
        pressureScore: n.pressureScore,
      })),
      edges: [],
      ticks: [],
      sampleCases: [],
      meta: { message: 'Need at least two assets with coordinates for flow simulation.' },
    };
  }

  /** @type {Map<string, { source: string, target: string, sourceName: string, targetName: string, perStep: number[] }>} */
  const edgeMap = new Map();
  const keyOf = (a, b) => `${a}→${b}`;

  function addEdge(from, to, stepIndex) {
    const k = keyOf(from.slug, to.slug);
    let row = edgeMap.get(k);
    if (!row) {
      row = {
        source: from.slug,
        target: to.slug,
        sourceName: from.name,
        targetName: to.name,
        perStep: Array(transitionCount).fill(0),
      };
      edgeMap.set(k, row);
    }
    row.perStep[stepIndex] += 1;
  }

  function startWeight(n) {
    let w = 12 + Number(n.pressureScore || 0);
    if (String(n.entityType).toUpperCase() === 'ENTRANCE') w *= 3.2;
    if (String(n.entityType).toUpperCase() === 'PARKING') w *= 1.4;
    return w;
  }

  function transitionWeight(from, to, recentSlugs) {
    if (from.slug === to.slug) return 0;
    const d = distanceMeters(from.lat, from.lng, to.lat, to.lng);
    if (d > maxHopM) return 0;
    const p = Number(to.pressureScore || 0);
    const spatial = Math.exp(-d / (maxHopM * 0.35));
    let w = (8 + p) * spatial;
    if (recentSlugs.includes(to.slug)) w *= 0.22;
    return w;
  }

  /** @type {Array<Array<{ slug: string, name: string }>>} */
  const sampleCases = [];

  for (let g = 0; g < guestCount; g += 1) {
    let cur = weightedPick(rng, nodes, startWeight);
    const recent = [];
    const path = [{ slug: cur.slug, name: cur.name }];
    for (let t = 0; t < transitionCount; t += 1) {
      const candidates = nodes.filter((n) => n.slug !== cur.slug && transitionWeight(cur, n, recent) > 0);
      if (!candidates.length) break;
      const next = weightedPick(rng, candidates, (n) => transitionWeight(cur, n, recent));
      addEdge(cur, next, t);
      recent.push(cur.slug);
      if (recent.length > 4) recent.shift();
      cur = next;
      path.push({ slug: cur.slug, name: cur.name });
    }
    if (sampleCases.length < 18) sampleCases.push(path);
  }

  const perStepTotals = Array(transitionCount).fill(0);
  for (const row of edgeMap.values()) {
    for (let s = 0; s < transitionCount; s += 1) perStepTotals[s] += row.perStep[s];
  }

  const edgesFull = [...edgeMap.values()].map((row) => ({
    source: row.source,
    target: row.target,
    sourceName: row.sourceName,
    targetName: row.targetName,
    value: row.perStep.reduce((a, b) => a + b, 0),
    perStep: row.perStep,
  }));
  edgesFull.sort((a, b) => b.value - a.value);
  const edgesTop = edgesFull.slice(0, topEdges);

  const ticks = buildCumulativeTicks(edgesFull, transitionCount);

  /** Ticks aggregate over `edgesFull`; include coords for every slug that can appear in replay, not only `edgesTop`. */
  const nodeSet = new Set();
  for (const e of edgesFull) {
    nodeSet.add(e.source);
    nodeSet.add(e.target);
  }

  return {
    park: payload.park,
    generatedAt: new Date().toISOString(),
    mode: 'synthetic_process_mining',
    parameters: {
      mode: 'synthetic',
      guestCount,
      transitionCount,
      maxHopM,
      seed,
      topEdges,
      assetTypeCode: opts.assetTypeCode || null,
    },
    nodes: nodes
      .filter((n) => nodeSet.has(n.slug))
      .map((n) => ({
        id: n.assetId,
        slug: n.slug,
        name: n.name,
        entityType: n.entityType,
        lat: n.lat,
        lng: n.lng,
        pressureScore: n.pressureScore,
      })),
    edges: edgesTop.map(({ source, target, sourceName, targetName, value }) => ({
      source,
      target,
      sourceName,
      targetName,
      value,
    })),
    ticks,
    sampleCases,
    meta: {
      totalEdges: edgeMap.size,
      edgesReturned: edgesTop.length,
      transitionsSimulated: transitionCount,
      guestsSimulated: guestCount,
    },
  };
}

/**
 * @param {string} parkId
 * @param {{ from?: string|Date, to?: string|Date, topEdges?: number }} opts
 */
async function runVisitorFlowFromLog(parkId, opts = {}) {
  const { VisitorJourneyEvent, ParkAsset, Park, AssetType } = require('../models');
  const topEdges = Math.min(80, Math.max(15, Number(opts.topEdges) || 45));

  /**
   * Live geo-pressure snapshot, keyed by slug. Gives from-log nodes the same
   * operational context (ride load, stress) as synthetic nodes — without it
   * the flow view would render with `pressureScore: 0` everywhere and any
   * Phase 1 visualization that colours by pressure would look broken.
   * Failure here MUST NOT fail the whole call, since pressure is enrichment.
   */
  let pressureBySlug = new Map();
  try {
    const engine = new GeoPressureEngineService();
    const pressurePayload = await engine.buildPressurePayload(parkId, { mode: 'live' });
    if (Array.isArray(pressurePayload?.entities)) {
      for (const e of pressurePayload.entities) {
        if (e?.slug) {
          pressureBySlug.set(String(e.slug), Number(e.pressureScore) || 0);
        }
      }
    }
  } catch {
    pressureBySlug = new Map();
  }

  const to = opts.to != null ? new Date(opts.to) : new Date();
  const from = opts.from != null ? new Date(opts.from) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return {
      error: 'INVALID_RANGE',
      message: 'Invalid from/to time range',
    };
  }

  const park = await Park.findByPk(parkId, {
    attributes: ['id', 'name', 'slug', 'latitude', 'longitude', 'externalEntityId'],
  });
  if (!park) return { error: 'PARK_NOT_FOUND' };

  const rows = await VisitorJourneyEvent.findAll({
    where: { parkId, occurredAt: { [Op.between]: [from, to] } },
    include: [
      {
        model: ParkAsset,
        as: 'asset',
        required: true,
        attributes: ['assetId', 'slug', 'name', 'latitude', 'longitude'],
        include: [{ model: AssetType, as: 'assetType', required: false, attributes: ['code'] }],
      },
    ],
    order: [['occurredAt', 'ASC']],
    limit: 80000,
  });

  /** @type {Map<string, { source: string; target: string; sourceName: string; targetName: string; perStep: number[] }>} */
  const edgeMap = new Map();
  const byCase = new Map();
  for (const row of rows) {
    const cid = String(row.caseId);
    if (!byCase.has(cid)) byCase.set(cid, []);
    byCase.get(cid).push(row);
  }

  let maxStep = 0;
  let casesWithPath = 0;
  /** @type {Array<Array<{ slug: string; name: string }>>} */
  const sampleCases = [];

  for (const arr of byCase.values()) {
    arr.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const seq = [];
    for (const r of arr) {
      const a = r.asset;
      if (!a) continue;
      const slug = String(a.slug || '').trim();
      if (!slug) continue;
      const name = String(a.name || slug).trim();
      if (seq.length && seq[seq.length - 1].slug === slug) continue;
      seq.push({ slug, name });
    }
    if (seq.length < 2) continue;
    casesWithPath += 1;
    if (sampleCases.length < 18) sampleCases.push(seq);
    for (let i = 1; i < seq.length; i += 1) {
      const stepIdx = i - 1;
      const fromN = seq[i - 1];
      const toN = seq[i];
      const k = `${fromN.slug}→${toN.slug}`;
      if (!edgeMap.has(k)) {
        edgeMap.set(k, {
          source: fromN.slug,
          target: toN.slug,
          sourceName: fromN.name,
          targetName: toN.name,
          perStep: [],
        });
      }
      const rowE = edgeMap.get(k);
      while (rowE.perStep.length <= stepIdx) rowE.perStep.push(0);
      rowE.perStep[stepIdx] += 1;
      maxStep = Math.max(maxStep, stepIdx);
    }
  }

  const transitionCount = Math.min(25, Math.max(1, maxStep + 1));
  for (const rowE of edgeMap.values()) {
    while (rowE.perStep.length < transitionCount) rowE.perStep.push(0);
  }

  if (!edgeMap.size) {
    const plain = park.get({ plain: true });
    return {
      park: {
        id: plain.id,
        slug: plain.slug,
        name: plain.name,
        latitude: plain.latitude ?? null,
        longitude: plain.longitude ?? null,
        externalEntityId:
          plain.externalEntityId != null && String(plain.externalEntityId).trim() !== ''
            ? String(plain.externalEntityId).trim()
            : null,
      },
      generatedAt: new Date().toISOString(),
      mode: 'from_log',
      parameters: {
        mode: 'from_log',
        from: from.toISOString(),
        to: to.toISOString(),
        topEdges,
        transitionCount,
        assetTypeCode: null,
      },
      nodes: [],
      edges: [],
      ticks: [],
      sampleCases,
      meta: {
        code: 'LOG_NO_TRANSITIONS',
        message:
          'No journey transitions in this window. Ingest events with POST /api/v1/parks/{parkId}/geo/flow/events/batch (journey steps per caseId), or call GET /api/v1/parks/{parkId}/geo/flow/simulation without mode=from_log for synthetic demo flow.',
        eventsInWindow: rows.length,
        casesInWindow: byCase.size,
        casesWithPath,
      },
    };
  }

  const edgesFull = [...edgeMap.values()].map((row) => ({
    source: row.source,
    target: row.target,
    sourceName: row.sourceName,
    targetName: row.targetName,
    value: row.perStep.reduce((a, b) => a + b, 0),
    perStep: row.perStep,
  }));
  edgesFull.sort((a, b) => b.value - a.value);
  const edgesTop = edgesFull.slice(0, topEdges);
  const ticks = buildCumulativeTicks(edgesFull, transitionCount);

  /** Same as synthetic: replay uses full edge set, so load coordinates for all involved slugs. */
  const slugSet = new Set();
  for (const e of edgesFull) {
    slugSet.add(e.source);
    slugSet.add(e.target);
  }
  const assets = await ParkAsset.findAll({
    where: { parkId, slug: { [Op.in]: [...slugSet] } },
    include: [{ model: AssetType, as: 'assetType', required: false, attributes: ['code'] }],
  });
  const plain = park.get({ plain: true });
  const nodes = assets.map((a) => {
    const j = a.toJSON ? a.toJSON() : a;
    const code = j.assetType?.code != null ? String(j.assetType.code).toUpperCase() : 'UNKNOWN';
    return {
      id: j.assetId,
      slug: j.slug,
      name: j.name,
      entityType: code,
      lat: j.latitude != null ? Number(j.latitude) : null,
      lng: j.longitude != null ? Number(j.longitude) : null,
      pressureScore: pressureBySlug.get(String(j.slug)) ?? 0,
    };
  });

  return {
    park: {
      id: plain.id,
      slug: plain.slug,
      name: plain.name,
      latitude: plain.latitude ?? null,
      longitude: plain.longitude ?? null,
      externalEntityId:
        plain.externalEntityId != null && String(plain.externalEntityId).trim() !== ''
          ? String(plain.externalEntityId).trim()
          : null,
    },
    generatedAt: new Date().toISOString(),
    mode: 'from_log',
    parameters: {
      mode: 'from_log',
      from: from.toISOString(),
      to: to.toISOString(),
      topEdges,
      transitionCount,
      assetTypeCode: null,
    },
    nodes,
    edges: edgesTop.map(({ source, target, sourceName, targetName, value }) => ({
      source,
      target,
      sourceName,
      targetName,
      value,
    })),
    ticks,
    sampleCases,
    meta: {
      totalEdges: edgeMap.size,
      edgesReturned: edgesTop.length,
      transitionsSimulated: transitionCount,
      guestsSimulated: byCase.size,
      eventsInWindow: rows.length,
      casesInWindow: byCase.size,
      casesWithPath,
    },
  };
}

/**
 * @param {string} parkId
 * @param {Array<{ caseId: string; assetId: string; occurredAt: Date|string; eventType?: string; source?: string; payload?: object }>} events
 */
async function appendVisitorJourneyEvents(parkId, events) {
  const { VisitorJourneyEvent, ParkAsset } = require('../models');
  const ids = [...new Set(events.map((e) => String(e.assetId)).filter(Boolean))];
  if (!ids.length) return { inserted: 0 };
  const found = await ParkAsset.findAll({
    where: { parkId, assetId: { [Op.in]: ids } },
    attributes: ['assetId'],
  });
  const ok = new Set(found.map((f) => String(f.assetId)));
  const rows = [];
  for (const ev of events) {
    if (!ok.has(String(ev.assetId))) {
      return { error: 'ASSET_NOT_IN_PARK', assetId: ev.assetId };
    }
    rows.push({
      parkId,
      caseId: String(ev.caseId).slice(0, 160),
      assetId: ev.assetId,
      eventType: ev.eventType != null ? String(ev.eventType).slice(0, 40) : 'ARRIVAL',
      occurredAt: ev.occurredAt instanceof Date ? ev.occurredAt : new Date(ev.occurredAt),
      source: ev.source != null ? String(ev.source).slice(0, 64) : 'ingest',
      payload: ev.payload && typeof ev.payload === 'object' ? ev.payload : {},
    });
  }
  await VisitorJourneyEvent.bulkCreate(rows);
  return { inserted: rows.length };
}

module.exports = {
  GeoFlowSimulatorService: class GeoFlowSimulatorService {
    async run(parkId, opts) {
      const mode = opts && String(opts.mode || '').toLowerCase() === 'from_log' ? 'from_log' : 'synthetic';
      if (mode === 'from_log') return runVisitorFlowFromLog(parkId, opts);
      return runVisitorFlowSimulation(parkId, opts);
    }

    appendEvents(parkId, events) {
      return appendVisitorJourneyEvents(parkId, events);
    }
  },
  _flowTesting: { mulberry32, weightedPick },
};
