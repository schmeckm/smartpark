const { Op } = require('sequelize');
const { SqdcMoodRating, SqdcSafetyEvent, SqdcBoardSnapshot, User } = require('../models');
const { IncidentService } = require('./incident.service');
const { SQDC_MOODS } = require('../models/sqdc-mood-rating.model');
const { SQDC_SAFETY_KINDS } = require('../models/sqdc-safety-event.model');

const incidentService = new IncidentService();

function dayBoundsUtc(businessDate) {
  const from = new Date(`${businessDate}T00:00:00.000Z`);
  const to = new Date(`${businessDate}T23:59:59.999Z`);
  return { from, to };
}

function moodScore(m) {
  const map = { great: 5, good: 4, neutral: 3, low: 2, bad: 1 };
  return map[String(m || '').toLowerCase()] ?? null;
}

function serializeUserBrief(u) {
  if (!u) return null;
  const p = u.get ? u.get({ plain: true }) : u;
  return {
    id: p.id,
    displayName: p.displayName ?? null,
    firstName: p.firstName,
    lastName: p.lastName,
  };
}

function serializeMood(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    parkId: p.parkId,
    assetId: p.assetId,
    userId: p.userId,
    businessDate: p.businessDate,
    mood: p.mood,
    user: p.user ? serializeUserBrief(p.user) : null,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  };
}

function serializeSafety(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    parkId: p.parkId,
    assetId: p.assetId,
    kind: p.kind,
    title: p.title,
    description: p.description,
    occurredAt: p.occurredAt ? new Date(p.occurredAt).toISOString() : null,
    createdBy: p.createdBy ? serializeUserBrief(p.createdBy) : null,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
  };
}

function serializeSnapshot(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  return {
    id: p.id,
    parkId: p.parkId,
    assetId: p.assetId,
    businessDate: p.businessDate,
    deliveryOee5m: p.deliveryOee5m != null ? Number(p.deliveryOee5m) : null,
    customerGuestCount: p.customerGuestCount,
    leadTechnicianName: p.leadTechnicianName,
    notes: p.notes,
    capturedByUserId: p.capturedByUserId,
    capturedBy: p.capturedBy ? serializeUserBrief(p.capturedBy) : null,
    updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
  };
}

function moodSummaryFromRows(rows) {
  const counts = { great: 0, good: 0, neutral: 0, low: 0, bad: 0 };
  const scores = [];
  for (const r of rows) {
    const m = String(r.mood || '').toLowerCase();
    if (counts[m] !== undefined) counts[m] += 1;
    const s = moodScore(m);
    if (s != null) scores.push(s);
  }
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { counts, averageScore: avg != null ? Math.round(avg * 100) / 100 : null, total: rows.length };
}

class SqdcService {
  async getBoard(parkId, { businessDate, assetId }) {
    const { from, to } = dayBoundsUtc(businessDate);
    const incidentOpts = {
      limit: 100,
      offset: 0,
      createdFrom: from.toISOString(),
      createdTo: to.toISOString(),
    };
    if (assetId) {
      incidentOpts.linkedEntityType = 'PARK_ASSET';
      incidentOpts.linkedEntityId = String(assetId);
    }
    const incidentsRes = await incidentService.listForPark(parkId, incidentOpts);

    const moods = await SqdcMoodRating.findAll({
      where: { parkId, businessDate },
      include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: true }],
      order: [['createdAt', 'DESC']],
    });

    const safetyWhere = {
      parkId,
      occurredAt: { [Op.between]: [from, to] },
    };
    if (assetId) {
      safetyWhere[Op.or] = [{ assetId: null }, { assetId: String(assetId) }];
    }
    const safetyRows = await SqdcSafetyEvent.findAll({
      where: safetyWhere,
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: true }],
      order: [['occurredAt', 'DESC']],
      limit: 200,
    });

    let snapshot = null;
    if (assetId) {
      const snap = await SqdcBoardSnapshot.findOne({
        where: { parkId, assetId: String(assetId), businessDate },
        include: [{ model: User, as: 'capturedBy', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: false }],
      });
      if (snap) snapshot = serializeSnapshot(snap);
    }

    return {
      businessDate,
      assetId: assetId || null,
      meta: { moods: SQDC_MOODS, safetyKinds: SQDC_SAFETY_KINDS },
      safety: {
        moodSummary: moodSummaryFromRows(moods),
        moodRatings: moods.map(serializeMood),
        events: safetyRows.map(serializeSafety),
      },
      quality: { incidents: incidentsRes.items, incidentTotal: incidentsRes.total },
      delivery: {
        oee5m: snapshot?.deliveryOee5m ?? null,
        leadTechnicianName: snapshot?.leadTechnicianName ?? null,
        snapshot,
      },
      customer: { guestCount: snapshot?.customerGuestCount ?? null },
    };
  }

  async getHistory(parkId, { assetId, days }) {
    const d0 = new Date();
    d0.setUTCHours(0, 0, 0, 0);
    const dates = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(d0);
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const snapshots = await SqdcBoardSnapshot.findAll({
      where: { parkId, assetId: String(assetId), businessDate: { [Op.in]: dates } },
      order: [['businessDate', 'ASC']],
    });

    const moodByDay = await SqdcMoodRating.findAll({
      where: { parkId, businessDate: { [Op.in]: dates } },
      attributes: ['businessDate', 'mood'],
      raw: true,
    });
    const moodAgg = {};
    for (const dt of dates) moodAgg[dt] = { counts: { great: 0, good: 0, neutral: 0, low: 0, bad: 0 }, averageScore: null };
    const scoresByDay = {};
    for (const dt of dates) scoresByDay[dt] = [];
    for (const row of moodByDay) {
      const day = row.businessDate;
      if (!moodAgg[day]) continue;
      const m = String(row.mood || '').toLowerCase();
      if (moodAgg[day].counts[m] !== undefined) moodAgg[day].counts[m] += 1;
      const s = moodScore(m);
      if (s != null) scoresByDay[day].push(s);
    }
    for (const dt of dates) {
      const arr = scoresByDay[dt];
      moodAgg[dt].averageScore = arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;
    }

    const snapMap = new Map(snapshots.map((s) => [String(s.businessDate), s]));
    const series = dates.map((dt) => {
      const s = snapMap.get(dt);
      return {
        businessDate: dt,
        deliveryOee5m: s && s.deliveryOee5m != null ? Number(s.deliveryOee5m) : null,
        customerGuestCount: s ? s.customerGuestCount : null,
        leadTechnicianName: s ? s.leadTechnicianName : null,
        mood: moodAgg[dt] || { counts: {}, averageScore: null },
        hasSnapshot: Boolean(s),
      };
    });

    return { assetId: String(assetId), days, series };
  }

  async upsertMood(parkId, userId, { businessDate, assetId, mood }) {
    const aid = assetId && String(assetId).trim() ? String(assetId) : null;
    const existing = await SqdcMoodRating.findOne({
      where: { parkId, userId, businessDate },
    });
    if (existing) {
      await existing.update({ mood, assetId: aid });
      const full = await SqdcMoodRating.findByPk(existing.id, {
        include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: true }],
      });
      return serializeMood(full);
    }
    const row = await SqdcMoodRating.create({
      parkId,
      userId,
      businessDate,
      mood,
      assetId: aid,
    });
    const full = await SqdcMoodRating.findByPk(row.id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: true }],
    });
    return serializeMood(full);
  }

  async createSafetyEvent(parkId, userId, { assetId, kind, title, description, occurredAt }) {
    const when = occurredAt ? new Date(occurredAt) : new Date();
    const aid = assetId && String(assetId).trim() ? String(assetId) : null;
    const row = await SqdcSafetyEvent.create({
      parkId,
      assetId: aid,
      kind,
      title,
      description: description || null,
      occurredAt: when,
      createdByUserId: userId,
    });
    const full = await SqdcSafetyEvent.findByPk(row.id, {
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: true }],
    });
    return serializeSafety(full);
  }

  async upsertSnapshot(parkId, userId, body) {
    const {
      assetId,
      businessDate,
      deliveryOee5m,
      customerGuestCount,
      leadTechnicianName,
      notes,
    } = body;
    const [row, created] = await SqdcBoardSnapshot.findOrCreate({
      where: { parkId, assetId: String(assetId), businessDate },
      defaults: {
        parkId,
        assetId: String(assetId),
        businessDate,
        deliveryOee5m: deliveryOee5m ?? null,
        customerGuestCount: customerGuestCount ?? null,
        leadTechnicianName: leadTechnicianName || null,
        notes: notes || null,
        capturedByUserId: userId,
      },
    });
    if (!created) {
      await row.update({
        deliveryOee5m: deliveryOee5m ?? row.deliveryOee5m,
        customerGuestCount: customerGuestCount ?? row.customerGuestCount,
        leadTechnicianName: leadTechnicianName != null ? leadTechnicianName : row.leadTechnicianName,
        notes: notes != null ? notes : row.notes,
        capturedByUserId: userId,
      });
    }
    const full = await SqdcBoardSnapshot.findByPk(row.id, {
      include: [{ model: User, as: 'capturedBy', attributes: ['id', 'displayName', 'firstName', 'lastName'], required: false }],
    });
    return serializeSnapshot(full);
  }
}

module.exports = { SqdcService };
