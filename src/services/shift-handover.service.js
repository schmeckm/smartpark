/**
 * Schichtübergabe: dokumentiert Betrachtungsfenster + Freitext;
 * optional Snapshot aus Stillständen (OEE) und Vorfällen (Incidents).
 */
const { Op } = require('sequelize');
const { ShiftHandoverEntry, AssetDowntimeEvent, Incident, Park, ParkAsset } = require('../models');
const { AppError } = require('../utils/app-error');

const DEFAULT_REMINDER_DELAY_MIN = 60;

function parseIso(d) {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

function asPlain(row) {
  return row.get({ plain: true });
}

function buildReminderDueAt(windowTo, reminderDelayMin) {
  const delay = Number.isFinite(Number(reminderDelayMin)) ? Math.max(0, Number(reminderDelayMin)) : DEFAULT_REMINDER_DELAY_MIN;
  return new Date(windowTo.getTime() + delay * 60000);
}

function sanitizeTaskStatus(raw) {
  const status = String(raw || '').toUpperCase();
  if (status === 'DONE' || status === 'CANCELLED') return status;
  return 'OPEN';
}

function normalizeTasks(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      id: item?.id ? String(item.id).slice(0, 80) : `task-${Math.random().toString(36).slice(2, 12)}`,
      title: item?.title ? String(item.title).trim().slice(0, 280) : '',
      ownerUserId: item?.ownerUserId ? String(item.ownerUserId) : null,
      dueAt: item?.dueAt ? parseIso(String(item.dueAt))?.toISOString() || null : null,
      status: sanitizeTaskStatus(item?.status),
      doneAt: item?.doneAt ? parseIso(String(item.doneAt))?.toISOString() || null : null,
      createdAt: item?.createdAt ? parseIso(String(item.createdAt))?.toISOString() || new Date().toISOString() : new Date().toISOString(),
    }))
    .filter((t) => t.title);
}

function extractIncidentPart(snapshot) {
  return snapshot && typeof snapshot === 'object' && snapshot.incidents ? snapshot.incidents : null;
}

function extractDowntimePart(snapshot) {
  return snapshot && typeof snapshot === 'object' ? snapshot : null;
}

function buildDiffSnapshot(previous, currentSnapshot, fromD, toD) {
  if (!previous || !previous.downtimeSnapshot || !currentSnapshot) return null;
  const prevDowntime = extractDowntimePart(previous.downtimeSnapshot);
  const currDowntime = extractDowntimePart(currentSnapshot);
  const prevInc = extractIncidentPart(previous.downtimeSnapshot);
  const currInc = extractIncidentPart(currentSnapshot);
  return {
    previousEntryId: previous.id,
    previousWindowFrom: previous.windowFrom ? new Date(previous.windowFrom).toISOString() : null,
    previousWindowTo: previous.windowTo ? new Date(previous.windowTo).toISOString() : null,
    currentWindowFrom: fromD.toISOString(),
    currentWindowTo: toD.toISOString(),
    delta: {
      downtimeEventCount:
        (currDowntime?.downtimeEventCount ?? 0) - (prevDowntime?.downtimeEventCount ?? 0),
      openDowntimeCount:
        (currDowntime?.openDowntimeCount ?? 0) - (prevDowntime?.openDowntimeCount ?? 0),
      plannedDowntimeMinutes:
        (currDowntime?.plannedDowntimeMinutes ?? 0) - (prevDowntime?.plannedDowntimeMinutes ?? 0),
      unplannedDowntimeMinutes:
        (currDowntime?.unplannedDowntimeMinutes ?? 0) - (prevDowntime?.unplannedDowntimeMinutes ?? 0),
      incidentsCreatedInWindow:
        (currInc?.createdInWindow ?? 0) - (prevInc?.createdInWindow ?? 0),
      incidentsOpenActiveTotal:
        (currInc?.openActiveTotal ?? 0) - (prevInc?.openActiveTotal ?? 0),
      incidentsOpenHighOrCritical:
        (currInc?.openActiveHighOrCritical ?? 0) - (prevInc?.openActiveHighOrCritical ?? 0),
    },
  };
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
      include: [
        { association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
        { association: 'acknowledgedBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
      ],
    });
    return rows.map(asPlain);
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
    const followUpTasks = normalizeTasks(body.followUpTasks);

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

    const prev = await ShiftHandoverEntry.findOne({
      where: {
        parkId,
        ...(linkedEntityId
          ? { linkedEntityType: 'PARK_ASSET', linkedEntityId }
          : { linkedEntityId: null }),
      },
      order: [['createdAt', 'DESC']],
    });

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
    const diffSnapshot = buildDiffSnapshot(prev ? asPlain(prev) : null, snapshot, fromD, toD);

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
      followUpTasks,
      diffSnapshot,
      reminderDueAt: buildReminderDueAt(toD, body.reminderDelayMin),
    });

    const fresh = await ShiftHandoverEntry.findByPk(row.id, {
      include: [
        { association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
        { association: 'acknowledgedBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
      ],
    });
    return asPlain(fresh);
  }

  async acknowledge(parkId, handoverId, body, { userId, parkScopeId }) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);
    const row = await ShiftHandoverEntry.findOne({ where: { id: handoverId, parkId } });
    if (!row) throw new AppError('Shift handover not found', 404, { code: 'NOT_FOUND' });
    row.acknowledgedAt = new Date();
    row.acknowledgedByUserId = userId || null;
    row.acknowledgementNote = body?.note ? String(body.note).slice(0, 4000) : null;
    await row.save();
    const fresh = await ShiftHandoverEntry.findByPk(row.id, {
      include: [
        { association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
        { association: 'acknowledgedBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
      ],
    });
    return asPlain(fresh);
  }

  async patchTasks(parkId, handoverId, body, parkScopeId) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);
    const row = await ShiftHandoverEntry.findOne({ where: { id: handoverId, parkId } });
    if (!row) throw new AppError('Shift handover not found', 404, { code: 'NOT_FOUND' });
    row.followUpTasks = normalizeTasks(body?.tasks);
    await row.save();
    return asPlain(row);
  }

  async listDueReminders(parkId, { limit = 30 } = {}, parkScopeId) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);
    const lim = Math.min(200, Math.max(1, Number(limit) || 30));
    const now = new Date();
    const rows = await ShiftHandoverEntry.findAll({
      where: {
        parkId,
        acknowledgedAt: null,
        reminderDueAt: { [Op.lte]: now },
        reminderSentAt: null,
      },
      order: [['reminderDueAt', 'ASC']],
      limit: lim,
    });
    return rows.map(asPlain);
  }

  async markReminderSent(parkId, handoverId, parkScopeId) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);
    const row = await ShiftHandoverEntry.findOne({ where: { id: handoverId, parkId } });
    if (!row) throw new AppError('Shift handover not found', 404, { code: 'NOT_FOUND' });
    row.reminderSentAt = new Date();
    await row.save();
    return asPlain(row);
  }

  async getPdfPayload(parkId, handoverId, parkScopeId) {
    await this.assertParkExists(parkId);
    this.assertParkScoped(parkId, parkScopeId);
    const row = await ShiftHandoverEntry.findOne({
      where: { id: handoverId, parkId },
      include: [
        { association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
        { association: 'acknowledgedBy', attributes: ['id', 'email', 'firstName', 'lastName'] },
      ],
    });
    if (!row) throw new AppError('Shift handover not found', 404, { code: 'NOT_FOUND' });
    const plain = asPlain(row);
    const esc = (v) =>
      String(v ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const notes = esc(plain.notes || '').replaceAll('\n', '<br />');
    const tasks = Array.isArray(plain.followUpTasks) ? plain.followUpTasks : [];
    const taskHtml = tasks.length
      ? `<ul>${tasks
          .map((t) => `<li>${esc(t.title)} (${esc(t.status)})${t.dueAt ? ` bis ${esc(new Date(t.dueAt).toISOString())}` : ''}</li>`)
          .join('')}</ul>`
      : '<p>Keine Aufgaben</p>';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Shift Handover</title></head><body><h1>Schichtuebergabe</h1><p><strong>Label:</strong> ${esc(plain.shiftLabel || '-')}</p><p><strong>Fenster:</strong> ${esc(new Date(plain.windowFrom).toISOString())} - ${esc(new Date(plain.windowTo).toISOString())}</p><h2>Notiz</h2><p>${notes || '-'}</p><h2>Aufgaben</h2>${taskHtml}</body></html>`;
    return {
      fileName: `shift-handover-${handoverId}.html`,
      mimeType: 'text/html; charset=utf-8',
      content: html,
      handover: plain,
    };
  }
}

module.exports = {
  ShiftHandoverService,
  buildOperationalSnapshot,
  computeDowntimeMetrics,
  computeIncidentMetrics,
};
