/**
 * Seed `visitor_journey_events` with realistic synthetic cases so the
 * `mode=from_log` flow view (and Phase 1+ DFG/variant endpoints) have data
 * before any real ingest or camera worker exists.
 *
 * Each case starts at an entrance-/parking-weighted asset and walks via
 * pressure- and distance-weighted hops, stamping one event per visited asset.
 *
 * Run:
 *   npm run seed:journey-events -- --park europa_park --cases 200 --days 1
 *
 * Args:
 *   --park <slug|uuid>   required
 *   --cases <n>          default 200
 *   --transitions <n>    average events per case (jittered ±25 %); default 7
 *   --days <n>           spread over the last N days; default 1
 *   --max-hop <m>        max neighbour distance for hops; default 420
 *   --seed <n>           RNG seed for reproducibility
 *   --source <s>         `source` column value; default "seed"
 *   --clear              delete previous rows with the same `source` for this park first
 *   --dry-run            compute but do not insert
 */
/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { Op } = require('sequelize');
const { sequelize, Park, ParkAsset, AssetType, VisitorJourneyEvent } = require(path.join(
  __dirname,
  '..',
  'src',
  'models'
));
const { GeoPressureEngineService } = require(path.join(
  __dirname,
  '..',
  'src',
  'services',
  'geo-pressure-engine.service'
));
const { distanceMeters } = require(path.join(
  __dirname,
  '..',
  'src',
  'services',
  'geo-pressure-scoring'
));
const { _flowTesting } = require(path.join(
  __dirname,
  '..',
  'src',
  'services',
  'geo-flow-simulator.service'
));

const { mulberry32, weightedPick } = _flowTesting;

const PARK_PK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Tokenize argv tolerantly: accepts both `--key value` and `--key=value`,
 * and keeps positional values for environments (Windows / PowerShell + npm)
 * where `npm run X -- --flag value` strips the `--flag` prefix and leaves
 * only the values behind. Positional values are then assigned to the next
 * unfilled known key in declared order.
 *
 * @returns {{ flags: Map<string, string|true>, positionals: string[] }}
 */
function tokenize(argv) {
  const flags = new Map();
  const positionals = [];
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (typeof a !== 'string') continue;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 2) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
        continue;
      }
      const key = a.slice(2);
      const peek = argv[i + 1];
      if (peek != null && !String(peek).startsWith('--')) {
        flags.set(key, String(peek));
        i += 1;
      } else {
        flags.set(key, true);
      }
      continue;
    }
    if (a.startsWith('-')) {
      flags.set(a.slice(1), true);
      continue;
    }
    positionals.push(a);
  }
  return { flags, positionals };
}

const POSITIONAL_ORDER = ['park', 'cases', 'transitions', 'days'];
const KNOWN_FLAGS = new Set([
  'park',
  'cases',
  'transitions',
  'days',
  'max-hop',
  'maxHop',
  'seed',
  'source',
  'clear',
  'dry-run',
  'dryRun',
  'help',
  'h',
]);

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(value) || 0));
}

/**
 * Windows / PowerShell + npm fallback: when `--park`, `--cases`, `--days`
 * get stripped, the bare values arrive as positionals. Map them onto the
 * canonical keys in declared order — only ones not already set via flags.
 */
function fillPositionalsAsFlags(flags, positionals) {
  let pi = 0;
  for (const key of POSITIONAL_ORDER) {
    if (pi >= positionals.length) break;
    if (flags.has(key)) continue;
    flags.set(key, positionals[pi]);
    pi += 1;
  }
  for (const extra of positionals.slice(pi)) {
    console.warn(`[warn] unused positional: ${extra}`);
  }
}

function warnUnknownFlags(flags) {
  for (const key of flags.keys()) {
    if (!KNOWN_FLAGS.has(key)) console.warn(`[warn] unknown flag: --${key}`);
  }
}

function getStr(flags, ...keys) {
  for (const k of keys) {
    if (flags.has(k)) return String(flags.get(k));
  }
  return null;
}

function applyFlagsToConfig(out, flags) {
  const park = getStr(flags, 'park');
  if (park) out.park = park.trim();
  const cases = getStr(flags, 'cases');
  if (cases != null) out.cases = clamp(cases, 1, 20000);
  const tr = getStr(flags, 'transitions');
  if (tr != null) out.transitions = clamp(tr, 2, 40);
  const days = getStr(flags, 'days');
  if (days != null) out.days = clamp(days, 0.1, 60);
  const hop = getStr(flags, 'max-hop', 'maxHop');
  if (hop != null) out.maxHop = clamp(hop, 80, 2500);
  const seed = getStr(flags, 'seed');
  if (seed != null) {
    const v = Number(seed);
    out.seed = Number.isFinite(v) ? Math.floor(v) : null;
  }
  const source = getStr(flags, 'source');
  if (source != null) out.source = source.slice(0, 64);
  out.clear = flags.has('clear') && flags.get('clear') !== false;
  out.dryRun =
    (flags.has('dry-run') && flags.get('dry-run') !== false) ||
    (flags.has('dryRun') && flags.get('dryRun') !== false);
}

function parseArgs(argv) {
  const out = {
    park: null,
    cases: 200,
    transitions: 7,
    days: 1,
    maxHop: 420,
    seed: null,
    source: 'seed',
    clear: false,
    dryRun: false,
  };
  const { flags, positionals } = tokenize(argv);
  if (flags.has('help') || flags.has('h')) {
    printHelp();
    process.exit(0);
  }
  fillPositionalsAsFlags(flags, positionals);
  warnUnknownFlags(flags);
  applyFlagsToConfig(out, flags);
  if (!out.park) {
    console.error('Error: park (slug or UUID) is required.');
    console.error(
      'Pass it with --park <value>, --park=<value>, or as the first positional argument.\n'
    );
    printHelp();
    process.exit(2);
  }
  return out;
}

function printHelp() {
  console.log(`Usage (works in bash, cmd, and PowerShell):
  node scripts/seed-visitor-journey-events.js --park=<slug|uuid> [options]

Equivalent forms (any combination works):
  node scripts/seed-visitor-journey-events.js --park <slug|uuid> --cases 200
  node scripts/seed-visitor-journey-events.js <slug|uuid> 200 7 1
  npm run seed:journey-events -- --park=<slug|uuid> --cases=200 --days=1

Note: on Windows + PowerShell, prefer "node scripts/..." or the "--key=value"
form. "npm run X -- --key value" can drop the "--key" tokens.

Options (all optional except park):
  --park=<v>          Park slug or UUID (required)
  --cases=<n>         Number of synthetic cases (default 200)
  --transitions=<n>   Avg events per case (default 7, jittered)
  --days=<n>          Spread over last N days (default 1)
  --max-hop=<m>       Max neighbour distance in meters (default 420)
  --seed=<n>          RNG seed (default: time-based)
  --source=<s>        Provenance tag for inserted rows (default "seed")
  --clear             Delete prior rows with the same --source for this park
  --dry-run           Compute but do not insert
`);
}

async function resolvePark(parkKey) {
  if (PARK_PK_UUID_RE.test(parkKey)) {
    const byId = await Park.findByPk(parkKey, { attributes: ['id', 'slug', 'name'] });
    if (byId) return byId;
  }
  return Park.findOne({ where: { slug: parkKey }, attributes: ['id', 'slug', 'name'] });
}

async function loadAssetsWithCoords(parkId) {
  const rows = await ParkAsset.findAll({
    where: {
      parkId,
      latitude: { [Op.ne]: null },
      longitude: { [Op.ne]: null },
    },
    include: [{ model: AssetType, as: 'assetType', required: false, attributes: ['code'] }],
    attributes: ['assetId', 'slug', 'name', 'latitude', 'longitude'],
  });
  return rows
    .map((r) => {
      const j = r.toJSON ? r.toJSON() : r;
      const lat = Number(j.latitude);
      const lng = Number(j.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return {
          assetId: String(j.assetId),
          slug: String(j.slug || ''),
          name: String(j.name || j.slug || ''),
          entityType: j.assetType?.code == null ? 'UNKNOWN' : String(j.assetType.code).toUpperCase(),
          lat,
          lng,
        };
      }
      return null;
    })
    .filter((x) => x?.slug);
}

async function fetchPressureBySlug(parkId) {
  try {
    const engine = new GeoPressureEngineService();
    const payload = await engine.buildPressurePayload(parkId, { mode: 'live' });
    const map = new Map();
    if (Array.isArray(payload?.entities)) {
      for (const e of payload.entities) {
        if (e?.slug) map.set(String(e.slug), Number(e.pressureScore) || 0);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function startWeight(node) {
  let w = 12 + (node.pressureScore || 0);
  if (node.entityType === 'ENTRANCE') w *= 3.2;
  if (node.entityType === 'PARKING') w *= 1.4;
  return w;
}

function transitionWeight(from, to, recentSlugs, maxHopM) {
  if (from.slug === to.slug) return 0;
  const d = distanceMeters(from.lat, from.lng, to.lat, to.lng);
  if (d > maxHopM) return 0;
  const p = to.pressureScore || 0;
  const spatial = Math.exp(-d / (maxHopM * 0.35));
  let w = (8 + p) * spatial;
  if (recentSlugs.includes(to.slug)) w *= 0.22;
  return w;
}

/**
 * Build synthetic cases with timestamps spread over the time window.
 * Each case stamps one event per visited asset.
 *
 * @param {Array<{assetId:string,slug:string,name:string,entityType:string,lat:number,lng:number,pressureScore:number}>} nodes
 */
function buildCases(nodes, opts) {
  const rng = mulberry32(opts.seed);
  const events = [];
  const sampleCases = [];
  const windowMs = Math.max(1, opts.days) * 24 * 60 * 60 * 1000;
  const windowStart = Date.now() - windowMs;

  for (let i = 0; i < opts.cases; i += 1) {
    const caseId = `seed-${opts.seed.toString(16).padStart(8, '0')}-${String(i).padStart(5, '0')}`;
    const start = new Date(windowStart + Math.floor(rng() * windowMs * 0.85));
    const stepCount = Math.max(
      2,
      Math.round(opts.transitions * (0.75 + rng() * 0.5))
    );

    let cur = weightedPick(rng, nodes, startWeight);
    const recent = [];
    let t = start.getTime();
    const path = [{ slug: cur.slug, name: cur.name }];

    events.push({
      caseId,
      assetId: cur.assetId,
      occurredAt: new Date(t),
      eventType: 'ARRIVAL',
      source: opts.source,
      payload: { synthetic: true, step: 0 },
    });

    for (let s = 1; s < stepCount; s += 1) {
      const candidates = nodes.filter(
        (n) => n.slug !== cur.slug && transitionWeight(cur, n, recent, opts.maxHop) > 0
      );
      if (!candidates.length) break;
      const next = weightedPick(rng, candidates, (n) =>
        transitionWeight(cur, n, recent, opts.maxHop)
      );
      // 4–18 minutes between steps; queue+travel+ride
      const dwellMs = (4 + Math.floor(rng() * 14)) * 60 * 1000;
      t += dwellMs;
      events.push({
        caseId,
        assetId: next.assetId,
        occurredAt: new Date(t),
        eventType: 'ARRIVAL',
        source: opts.source,
        payload: { synthetic: true, step: s },
      });
      recent.push(cur.slug);
      if (recent.length > 4) recent.shift();
      cur = next;
      path.push({ slug: cur.slug, name: cur.name });
    }

    if (sampleCases.length < 6) sampleCases.push(path);
  }

  return { events, sampleCases };
}

async function clearPriorRows(parkId, source) {
  return VisitorJourneyEvent.destroy({ where: { parkId, source } });
}

async function insertInChunks(rows, chunkSize = 1000) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    /* eslint-disable-next-line no-await-in-loop */
    await VisitorJourneyEvent.bulkCreate(chunk);
    inserted += chunk.length;
  }
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.seed == null) args.seed = Math.floor(Date.now() % 2147483647);

  await sequelize.authenticate();

  const park = await resolvePark(args.park);
  if (!park) {
    console.error(`Error: park "${args.park}" not found.`);
    process.exit(1);
  }
  console.log(
    `Park: ${park.name} (slug=${park.slug}, id=${park.id})`
  );

  const nodes = await loadAssetsWithCoords(park.id);
  if (nodes.length < 2) {
    console.error(
      `Error: park has only ${nodes.length} asset(s) with coordinates — need ≥ 2.`
    );
    process.exit(1);
  }
  console.log(`Loaded ${nodes.length} assets with coordinates.`);

  const pressure = await fetchPressureBySlug(park.id);
  for (const n of nodes) n.pressureScore = pressure.get(n.slug) ?? 0;
  console.log(
    `Pressure snapshot: ${pressure.size} of ${nodes.length} assets enriched.`
  );

  const { events, sampleCases } = buildCases(nodes, args);
  console.log(
    `Generated ${events.length} events across ${args.cases} cases (seed=${args.seed}).`
  );
  for (const p of sampleCases) {
    console.log('  · sample case:', p.map((x) => x.slug).join(' → '));
  }

  if (args.dryRun) {
    console.log('Dry run — nothing inserted.');
    await sequelize.close();
    process.exit(0);
  }

  if (args.clear) {
    const removed = await clearPriorRows(park.id, args.source);
    console.log(`Cleared ${removed} prior rows with source="${args.source}".`);
  }

  const rows = events.map((e) => ({
    parkId: park.id,
    caseId: e.caseId,
    assetId: e.assetId,
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    source: e.source,
    payload: e.payload,
  }));

  const inserted = await insertInChunks(rows);
  console.log(`Inserted ${inserted} visitor_journey_events.`);

  await sequelize.close();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
