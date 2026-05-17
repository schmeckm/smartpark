/**
 * MVP OEE / Verfügbarkeit: Stillstandsereignisse pro Asset (geplant vs. ungeplant).
 */
const { Op } = require('sequelize');
const { AssetDowntimeEvent, ParkAsset, AssetTarget } = require('../models');
const { AppError } = require('../utils/app-error');
const { OEE_REASON_CODES } = require('../constants/oee-reason-codes');
const { operatingIntervalsForPark } = require('./park-operating-window.service');
const {
  sumDowntimeMsInIntervals,
  availabilityPctFromDowntime,
} = require('../utils/downtime-interval-aggregate.util');

function parseIso(d) {
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

function assertReason(code) {
  if (!OEE_REASON_CODES.includes(code)) {
    throw new AppError('Invalid reason_code', 400, { code: 'INVALID_REASON_CODE' });
  }
}

class AssetDowntimeService {
  async assertAssetScoped(assetId, parkScopeId) {
    const asset = await ParkAsset.findByPk(assetId, { attributes: ['assetId', 'parkId'] });
    if (!asset) throw new AppError('Asset not found', 404, { code: 'NOT_FOUND' });
    if (parkScopeId && String(asset.parkId) !== String(parkScopeId)) {
      throw new AppError('Asset not in scoped park', 400, { code: 'PARK_SCOPE_MISMATCH' });
    }
    return asset;
  }

  /**
   * Overlap if interval [startedAt, endedAtOrInfinity) intersects existing rows.
   */
  /**
   * @param {string|null} [excludeEventId] — skip this row (PATCH self)
   */
  async assertNoOverlap(assetId, startedAt, endedAt, excludeEventId = null) {
    const rangeEnd = endedAt || new Date('2099-12-31T23:59:59.999Z');
    const where = {
      assetId,
      [Op.and]: [
        { startedAt: { [Op.lt]: rangeEnd } },
        {
          [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: startedAt } }],
        },
      ],
    };
    if (excludeEventId) {
      where.id = { [Op.ne]: excludeEventId };
    }
    const existing = await AssetDowntimeEvent.findOne({ where });
    if (existing) {
      const p = existing.get({ plain: true });
      const toIso = (d) => (d instanceof Date ? d.toISOString() : d);
      throw new AppError('Overlapping downtime event exists for this asset', 409, {
        code: 'DOWNTIME_OVERLAP',
        details: {
          conflictingEvent: {
            id: p.id,
            startedAt: toIso(p.startedAt),
            endedAt: p.endedAt != null ? toIso(p.endedAt) : null,
            planned: Boolean(p.planned),
            reasonCode: p.reasonCode,
          },
        },
      });
    }
  }

  async list(assetId, { from, to, limit = 100 }, parkScopeId) {
    await this.assertAssetScoped(assetId, parkScopeId);
    const fromD = parseIso(from);
    const toD = parseIso(to);
    if (!fromD || !toD) throw new AppError('from and to required (ISO-8601)', 400, { code: 'INVALID_RANGE' });
    if (fromD >= toD) throw new AppError('from must be before to', 400, { code: 'INVALID_RANGE' });

    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    /** Inklusives Fenster [from, to]: auch Start genau um „Bis“ oder Ende genau um „Von“. */
    const rows = await AssetDowntimeEvent.findAll({
      where: {
        assetId,
        startedAt: { [Op.lte]: toD },
        [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: fromD } }],
      },
      order: [['startedAt', 'DESC']],
      limit: lim,
      include: [{ association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] }],
    });
    return rows.map((r) => r.get({ plain: true }));
  }

  async create(assetId, body, { userId, parkScopeId }) {
    await this.assertAssetScoped(assetId, parkScopeId);
    assertReason(body.reasonCode);

    const startedAt = parseIso(body.startedAt);
    const endedAt = body.endedAt != null && body.endedAt !== '' ? parseIso(body.endedAt) : null;
    if (!startedAt) throw new AppError('startedAt required', 400, { code: 'INVALID_STARTED' });
    if (endedAt && endedAt <= startedAt) throw new AppError('endedAt must be after startedAt', 400);

    const asset = await ParkAsset.findByPk(assetId, { attributes: ['parkId'] });
    await this.assertNoOverlap(assetId, startedAt, endedAt);

    const row = await AssetDowntimeEvent.create({
      assetId,
      parkId: asset.parkId,
      startedAt,
      endedAt,
      planned: Boolean(body.planned),
      reasonCode: body.reasonCode,
      notes: body.notes || null,
      source: body.source && String(body.source).trim() ? String(body.source).trim().slice(0, 32) : 'manual',
      createdByUserId: userId || null,
    });
    return row.get({ plain: true });
  }

  async patch(eventId, assetId, body, { parkScopeId }) {
    await this.assertAssetScoped(assetId, parkScopeId);
    const row = await AssetDowntimeEvent.findOne({ where: { id: eventId, assetId } });
    if (!row) throw new AppError('Event not found', 404, { code: 'NOT_FOUND' });

    let nextStarted = new Date(row.startedAt);
    let nextEnded = row.endedAt ? new Date(row.endedAt) : null;
    let nextPlanned = Boolean(row.planned);
    let nextReason = row.reasonCode;

    if (body.startedAt !== undefined) {
      const s = parseIso(body.startedAt);
      if (!s) throw new AppError('Invalid startedAt', 400, { code: 'INVALID_STARTED' });
      nextStarted = s;
    }
    if (body.endedAt !== undefined) {
      if (body.endedAt === null || body.endedAt === '') {
        nextEnded = null;
      } else {
        const e = parseIso(body.endedAt);
        if (!e) throw new AppError('Invalid endedAt', 400, { code: 'INVALID_ENDED' });
        nextEnded = e;
      }
    }
    if (body.planned !== undefined) nextPlanned = Boolean(body.planned);
    if (body.reasonCode !== undefined) {
      assertReason(body.reasonCode);
      nextReason = body.reasonCode;
    }

    const reasonOk =
      (nextPlanned && String(nextReason).startsWith('PLANNED_')) ||
      (!nextPlanned && String(nextReason).startsWith('UNPLANNED_'));
    if (!reasonOk) {
      throw new AppError('reasonCode must match planned flag', 400, { code: 'REASON_PLANNED_MISMATCH' });
    }

    if (nextEnded && nextEnded <= nextStarted) {
      throw new AppError('endedAt must be after startedAt', 400, { code: 'INVALID_ENDED' });
    }

    if (body.startedAt !== undefined || body.endedAt !== undefined) {
      await this.assertNoOverlap(assetId, nextStarted, nextEnded, eventId);
    }

    const patch = {};
    if (body.startedAt !== undefined) patch.startedAt = nextStarted;
    if (body.endedAt !== undefined) patch.endedAt = nextEnded;
    if (body.planned !== undefined) patch.planned = nextPlanned;
    if (body.reasonCode !== undefined) patch.reasonCode = nextReason;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (Object.keys(patch).length === 0) {
      throw new AppError('No valid fields to update', 400, { code: 'EMPTY_PATCH' });
    }
    await row.update(patch);
    const fresh = await AssetDowntimeEvent.findByPk(row.id, {
      include: [{ association: 'createdBy', attributes: ['id', 'email', 'firstName', 'lastName'] }],
    });
    return fresh.get({ plain: true });
  }

  async delete(eventId, assetId, parkScopeId) {
    await this.assertAssetScoped(assetId, parkScopeId);
    const n = await AssetDowntimeEvent.destroy({ where: { id: eventId, assetId } });
    if (!n) throw new AppError('Event not found', 404, { code: 'NOT_FOUND' });
  }

  async availabilitySummary(assetId, { from, to }, parkScopeId) {
    const asset = await this.assertAssetScoped(assetId, parkScopeId);
    const fromD = parseIso(from);
    const toD = parseIso(to);
    if (!fromD || !toD || fromD >= toD) throw new AppError('Invalid range', 400, { code: 'INVALID_RANGE' });

    const windowMs = toD.getTime() - fromD.getTime();
    const now = new Date();
    const rows = await AssetDowntimeEvent.findAll({
      where: {
        assetId,
        startedAt: { [Op.lte]: toD },
        [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: fromD } }],
      },
    });

    let plannedMs = 0;
    let unplannedMs = 0;

    for (const r of rows) {
      const s = new Date(r.startedAt);
      const eCap = r.endedAt ? new Date(r.endedAt) : now;
      const e = eCap > toD ? toD : eCap;
      const ss = s < fromD ? fromD : s;
      if (e <= ss) continue;
      const dur = e.getTime() - ss.getTime();
      if (r.planned) plannedMs += dur;
      else unplannedMs += dur;
    }

    const availabilityPct =
      windowMs > 0 ? Math.max(0, Math.min(100, ((windowMs - unplannedMs) / windowMs) * 100)) : null;

    const target = await AssetTarget.findByPk(assetId, { attributes: ['targetAvailabilityPct', 'targetOeePct'] });
    const targetAvail = target?.targetAvailabilityPct != null ? Number(target.targetAvailabilityPct) : null;

    let duringParkHours = null;
    try {
      const opWin = await operatingIntervalsForPark(asset.parkId, fromD, toD);
      const { plannedMs: pOp, unplannedMs: uOp } = sumDowntimeMsInIntervals(rows, opWin.intervals, toD);
      const opMs = opWin.operatingWindowMs;
      const availOp = availabilityPctFromDowntime(opMs, uOp);
      const firstIv = opWin.intervals[0];
      const lastIv = opWin.intervals.length ? opWin.intervals[opWin.intervals.length - 1] : null;
      duringParkHours = {
        available: opMs > 0,
        operatingWindowMinutes: Math.round(opMs / 60000),
        plannedDowntimeMinutes: Math.round(pOp / 60000),
        unplannedDowntimeMinutes: Math.round(uOp / 60000),
        availabilityPct: availOp != null ? Math.round(availOp * 100) / 100 : null,
        labelDe: opWin.labelDe,
        scheduleProvider: opWin.scheduleProvider,
        scheduleProviderLabelDe: opWin.scheduleProviderLabelDe,
        timezone: opWin.timezone,
        localDates: opWin.localDates,
        window:
          firstIv && lastIv
            ? { from: new Date(firstIv.startMs).toISOString(), to: new Date(lastIv.endMs).toISOString() }
            : null,
        methodology:
          opMs > 0
            ? 'Verfügbarkeit während geplanter Parköffnung ≈ (Betriebsfenster − ungeplante Stillstände) / Betriebsfenster. Nur Schnittmenge mit Öffnungszeiten (Stammdaten oder Kalender).'
            : 'Kein Betriebsfenster im gewählten Zeitraum (Park zu oder keine Öffnungszeiten hinterlegt).',
      };
    } catch {
      duringParkHours = {
        available: false,
        operatingWindowMinutes: 0,
        plannedDowntimeMinutes: 0,
        unplannedDowntimeMinutes: 0,
        availabilityPct: null,
        labelDe: null,
        scheduleProvider: null,
        scheduleProviderLabelDe: null,
        timezone: null,
        localDates: [],
        window: null,
        methodology: 'Parköffnungszeiten konnten nicht aufgelöst werden.',
      };
    }

    const primaryAvail =
      duringParkHours?.available && duringParkHours.availabilityPct != null
        ? duringParkHours.availabilityPct
        : availabilityPct;

    return {
      assetId,
      window: { from: fromD.toISOString(), to: toD.toISOString() },
      windowMinutes: Math.round(windowMs / 60000),
      plannedDowntimeMinutes: Math.round(plannedMs / 60000),
      unplannedDowntimeMinutes: Math.round(unplannedMs / 60000),
      availabilityPct: availabilityPct != null ? Math.round(availabilityPct * 100) / 100 : null,
      duringParkHours,
      /** Bevorzugt Verfügbarkeit in Parköffnungszeit, sonst volles Abfragefenster. */
      effectiveAvailabilityPct: primaryAvail != null ? Math.round(primaryAvail * 100) / 100 : null,
      targetAvailabilityPct: targetAvail,
      deltaVsTargetPct:
        primaryAvail != null && targetAvail != null
          ? Math.round((primaryAvail - targetAvail) * 100) / 100
          : null,
      methodology:
        duringParkHours?.available
          ? `${duringParkHours.methodology} Zusätzlich: Gesamtfenster ${Math.round(windowMs / 60000)} min (ungeplant ${Math.round(unplannedMs / 60000)} min).`
          : 'MVP: Verfügbarkeit ≈ (Fenster − ungeplante Stillstandszeit) / Fenster. Geplante Stopps werden separat ausgewiesen. Parköffnung im Zeitraum nicht ermittelbar — nur Gesamtfenster.',
    };
  }

  /**
   * Pareto: downtime duration inside [from,to] aggregated by reason_code (window clipping wie availabilitySummary).
   * @param {'all'|'planned'|'unplanned'} [plannedScope]
   */
  async paretoByReason(assetId, { from, to, plannedScope = 'all' }, parkScopeId) {
    await this.assertAssetScoped(assetId, parkScopeId);
    const fromD = parseIso(from);
    const toD = parseIso(to);
    if (!fromD || !toD || fromD >= toD) throw new AppError('Invalid range', 400, { code: 'INVALID_RANGE' });

    const scope =
      plannedScope === 'planned' ? 'planned' : plannedScope === 'unplanned' ? 'unplanned' : 'all';

    const rows = await AssetDowntimeEvent.findAll({
      where: {
        assetId,
        startedAt: { [Op.lte]: toD },
        [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gte]: fromD } }],
      },
    });

    const byReason = new Map();
    const now = new Date();

    for (const r of rows) {
      if (scope === 'planned' && !r.planned) continue;
      if (scope === 'unplanned' && r.planned) continue;

      const s = new Date(r.startedAt);
      const eCap = r.endedAt ? new Date(r.endedAt) : now;
      const e = eCap > toD ? toD : eCap;
      const ss = s < fromD ? fromD : s;
      if (e <= ss) continue;
      const ms = e.getTime() - ss.getTime();
      const code = r.reasonCode || 'UNKNOWN';
      byReason.set(code, (byReason.get(code) || 0) + ms);
    }

    const totalMs = [...byReason.values()].reduce((a, b) => a + b, 0);
    const sorted = [...byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reasonCode, durationMs]) => ({
        reasonCode,
        durationMs,
        durationMinutes: Math.round(durationMs / 60000),
        sharePct: totalMs > 0 ? Math.round((durationMs / totalMs) * 10000) / 100 : 0,
      }));

    let cumMs = 0;
    const items = sorted.map((row) => {
      cumMs += row.durationMs;
      return {
        ...row,
        cumulativeSharePct: totalMs > 0 ? Math.round((cumMs / totalMs) * 10000) / 100 : 0,
      };
    });

    return {
      assetId,
      window: { from: fromD.toISOString(), to: toD.toISOString() },
      plannedScope: scope,
      totalDowntimeMinutes: Math.round(totalMs / 60000),
      items,
    };
  }
}

module.exports = { AssetDowntimeService };
