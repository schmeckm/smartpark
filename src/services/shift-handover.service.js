/**
 * Schichtübergabe: dokumentiert Betrachtungsfenster + Freitext;
 * optional Snapshot aus Stillständen (OEE) und Vorfällen (Incidents).
 */
const { Op } = require('sequelize');
const { ShiftHandoverEntry, AssetDowntimeEvent, Incident, Park, ParkAsset } = require('../models');
const { AppError } = require('../utils/app-error');

function parseIso(d) {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

/** Gleiche Kappung wie OEE-Auswertung: Anteil der Ausfallzeit innerhalb [fromD, toD]. */
function clipDowntimeMs(startedAt, endedAt, fromD, toD, now) {
  const s = new Date(startedAt);
  const eCap = endedAt ? new Date(endedAt) : now;
  const e = eCap > toD ? toD : eCap;
  const ss = s < fromD ? fromD : s;
  if (e <= ss) return 0;
  return e.getTime() - ss.getTime();
}

/**
 * Park über park_assets.park_id filtern (zuverlässiger als nur asset_downtime_events.park_id).
 * Schnittmenge wie Listen-OEE: Fenster [from, to] inklusiv an den Grenzen.
 */
async function computeDowntimeMetrics(parkId, fromD, toD, parkAssetId = null) {
  const where = {
    startedAt: { [Op.lte]: toD },
    [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: fromD } }],
  };
  if (parkAssetId) where.assetId = parkAssetId;

  const rows = await AssetDowntimeEvent.findAll({
    where,
    include: [
      {
        association: 'asset',
        attributes: [],
        where: { parkId },
        required: true,
      },
    ],
    attributes: ['planned', 'endedAt', 'startedAt'],
  });

  const now = new Date();
  let planned = 0;
  let unplanned = 0;
  let openEnded = 0;
  let plannedMs = 0;
  let unplannedMs = 0;
  for (const r of rows) {
    if (r.planned) planned += 1;
    else unplanned += 1;
    if (!r.endedAt) openEnded += 1;
    const ms = clipDowntimeMs(r.startedAt, r.endedAt, fromD, toD, now);
    if (ms <= 0) continue;
    if (r.planned) plannedMs += ms;
    else unplannedMs += ms;
  }
  return {
    downtimeEventCount: rows.length,
    openDowntimeCount: openEnded,
    plannedEventsInWindow: planned,
    unplannedEventsInWindow: unplanned,
    plannedDowntimeMinutes: Math.round(plannedMs / 60000),
    unplannedDowntimeMinutes: Math.round(unplannedMs / 60000),
  };
}

async function computeIncidentMetrics(parkId, fromD, toD, parkAssetId = null) {
  const assetWhere = parkAssetId
    ? { linkedEntityType: 'PARK_ASSET', linkedEntityId: String(parkAssetId) }
    : {};

  const createdInWindow = await Incident.count({
    where: {
      parkId,
      createdAt: { [Op.gte]: fromD, [Op.lte]: toD },
      ...assetWhere,
    },
  });

  const openActiveTotal = await Incident.count({
    where: {
      parkId,
      status: { [Op.in]: ['OPEN', 'IN_PROGRESS'] },
      ...assetWhere,
    },
  });

  const openActiveHighOrCritical = await Incident.count({
    where: {
      parkId,
      status: { [Op.in]: ['OPEN', 'IN_PROGRESS'] },
      severity: { [Op.in]: ['HIGH', 'CRITICAL'] },
      ...assetWhere,
    },
  });

  return {
    createdInWindow,
    openActiveTotal,
    openActiveHighOrCritical,
  };
}

/**
 * @param {{ downtime: boolean; incidents: boolean }} parts
 * @param {{ parkAssetId?: string | null; scopeLabel?: string | null }} scopeMeta
 */
async function buildOperationalSnapshot(parkId, fromD, toD, parts, scopeMeta = {}) {
  const parkAssetId = scopeMeta.parkAssetId || null;
  const snap = {
    window: { from: fromD.toISOString(), to: toD.toISOString() },
  };
  if (parkAssetId) {
    snap.scope = {
      kind: 'PARK_ASSET',
      assetId: parkAssetId,
      label: scopeMeta.scopeLabel || null,
    };
  } else {
    snap.scope = { kind: 'PARK' };
  }
  if (parts.downtime) {
    Object.assign(snap, await computeDowntimeMetrics(parkId, fromD, toD, parkAssetId));
  }
  if (parts.incidents) {
    snap.incidents = await computeIncidentMetrics(parkId, fromD, toD, parkAssetId);
  }
  return snap;
}

class ShiftHandoverService {
  async assertParkExists(parkId) {
    const p = await Park.findByPk(parkId, { attributes: ['id'] });
    if (!p) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
  }

  /**
   * @param {string|null} parkScopeId - req.parkContext.id
   */
  assertParkScoped(parkId, parkScopeId) {
    if (parkScopeId && String(parkId) !== String(parkScopeId)) {
      throw new AppError('Park id must match X-Park-Id', 400, { code: 'PARK_SCOPE_MISMATCH' });
    }
  }

  async list(parkId, { from, to, q: searchQ, scope = 'all', linkedAssetId, limit = 50 }, parkScopeId) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);

    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const where = { parkId };

    const fromD = from ? parseIso(from) : null;
    const toD = to ? parseIso(to) : null;
    if ((fromD && !toD) || (!fromD && toD)) {
      throw new AppError('from and to both required when filtering', 400, { code: 'INVALID_RANGE' });
    }
    if (fromD && toD) {
      if (fromD >= toD) throw new AppError('from must be before to', 400, { code: 'INVALID_RANGE' });
      Object.assign(where, {
        windowFrom: { [Op.lt]: toD },
        windowTo: { [Op.gt]: fromD },
      });
    }

    const rawQ = searchQ != null ? String(searchQ).trim().slice(0, 200) : '';
    const safeLike = rawQ.replace(/[%_\\]/g, '');
    if (safeLike) {
      Object.assign(where, {
        [Op.or]: [{ notes: { [Op.iLike]: `%${safeLike}%` } }, { shiftLabel: { [Op.iLike]: `%${safeLike}%` } }],
      });
    }

    const scopeNorm = String(scope || 'all').toLowerCase();
    if (scopeNorm === 'park') {
      where.linkedEntityId = null;
    } else if (scopeNorm === 'asset') {
      const aid = linkedAssetId != null ? String(linkedAssetId).trim() : '';
      if (!aid) {
        throw new AppError('linkedAssetId required when scope=asset', 400, { code: 'INVALID_SCOPE' });
      }
      where.linkedEntityId = aid;
      where.linkedEntityType = 'PARK_ASSET';
    }

    const rows = await ShiftHandoverEntry.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: lim,
      include: [{ association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] }],
    });
    return rows.map((r) => r.get({ plain: true }));
  }

  async create(parkId, body, { userId, parkScopeId }) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);

    const fromD = parseIso(body.windowFrom);
    const toD = parseIso(body.windowTo);
    if (!fromD || !toD || fromD >= toD) {
      throw new AppError('windowFrom and windowTo required (ISO-8601), from before to', 400, {
        code: 'INVALID_WINDOW',
      });
    }

    const wantDowntime = body.includeDowntimeSnapshot !== false;
    const wantIncidents = body.includeIncidentSnapshot !== false;

    let linkedEntityType = null;
    let linkedEntityId = null;
    let scopeLabel = null;
    const rawAsset = body.linkedParkAssetId != null ? String(body.linkedParkAssetId).trim() : '';
    if (rawAsset) {
      const assetRow = await ParkAsset.findOne({
        where: { parkId, assetId: rawAsset },
        attributes: ['assetId', 'name'],
      });
      if (!assetRow) {
        throw new AppError('Park object not found in this park', 404, { code: 'NOT_FOUND' });
      }
      linkedEntityType = 'PARK_ASSET';
      linkedEntityId = rawAsset;
      scopeLabel = assetRow.name ? String(assetRow.name) : null;
    }

    let snapshot = null;
    if (wantDowntime || wantIncidents) {
      snapshot = await buildOperationalSnapshot(
        parkId,
        fromD,
        toD,
        {
          downtime: wantDowntime,
          incidents: wantIncidents,
        },
        { parkAssetId: linkedEntityId, scopeLabel }
      );
    }

    const label =
      body.shiftLabel != null && String(body.shiftLabel).trim()
        ? String(body.shiftLabel).trim().slice(0, 64)
        : null;
    const notes = body.notes == null ? '' : String(body.notes);

    const row = await ShiftHandoverEntry.create({
      parkId,
      windowFrom: fromD,
      windowTo: toD,
      shiftLabel: label,
      downtimeSnapshot: snapshot,
      notes,
      createdByUserId: userId || null,
      linkedEntityType,
      linkedEntityId,
    });

    const fresh = await ShiftHandoverEntry.findByPk(row.id, {
      include: [{ association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] }],
    });
    return fresh.get({ plain: true });
  }
}

module.exports = {
  ShiftHandoverService,
  buildOperationalSnapshot,
  computeDowntimeMetrics,
  computeIncidentMetrics,
};
