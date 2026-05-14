/**
 * Aggregates park-level operational view: calendar, scheduled hours, latest feature snapshot.
 */
const { AppError } = require('../utils/app-error');
const { Park, ParkCalendarContext, ParkFeatureSnapshot } = require('../models');
const { ParkOperatingSnapshotRepository } = require('../repositories/park-operating-snapshot.repository');
const { localCalendarParts } = require('./ai-snapshot-x-context.service');
const { evaluateScheduledOperatingHours } = require('../utils/operating-hours-eval.util');
const { syntheticScheduleFromParkEnrichment } = require('../utils/master-operating-hours.util');
const { seasonIndicatorFromCode } = require('../utils/season-indicator.util');
const { normalizeScheduleDateString } = require('../utils/schedule-date.util');

function bucket5m(dateValue) {
  const ts = new Date(dateValue).getTime();
  const floored = Math.floor(ts / (5 * 60 * 1000)) * 5 * 60 * 1000;
  return new Date(floored);
}

function externalParkKeyForSnapshots(park) {
  if (!park) return null;
  const ext =
    park.externalEntityId != null && String(park.externalEntityId).trim() !== ''
      ? String(park.externalEntityId).trim()
      : String(park.slug || '').trim();
  return ext || null;
}

/**
 * Kurztext für UI aus PARK_OPERATING_HOURS_UPDATED-Payload.
 * @param {object|null} scheduleRow
 */
function openingHoursSummary(scheduleRow) {
  if (!scheduleRow || typeof scheduleRow !== 'object') return null;
  const date =
    normalizeScheduleDateString(scheduleRow.date ?? scheduleRow.day ?? scheduleRow.scheduleDate) ??
    (scheduleRow.date != null ? String(scheduleRow.date).trim() : null);
  const typ = String(scheduleRow.type || 'OPERATING').toUpperCase();
  const open = scheduleRow.openingTime != null ? String(scheduleRow.openingTime).trim() : '';
  const close = scheduleRow.closingTime != null ? String(scheduleRow.closingTime).trim() : '';
  if (typ !== 'OPERATING') {
    return {
      date,
      type: typ,
      summaryDe: 'Geschlossen (laut Plan)',
      openingTime: open || null,
      closingTime: close || null,
    };
  }
  if (!open || !close) {
    return {
      date,
      type: typ,
      summaryDe: null,
      openingTime: open || null,
      closingTime: close || null,
    };
  }
  return {
    date,
    type: typ,
    summaryDe: `${open} – ${close} Uhr`,
    openingTime: open,
    closingTime: close,
  };
}

function normalizeMonthDay(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[2]}-${iso[3]}`;
  const md = s.match(/^(\d{2})-(\d{2})$/);
  if (md) return `${md[1]}-${md[2]}`;
  return null;
}

function localDateToMonthDay(localDate) {
  const m = String(localDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[2]}-${m[3]}`;
}

function isMonthDayInRange(md, fromMd, untilMd) {
  if (!md || !fromMd || !untilMd) return false;
  if (fromMd <= untilMd) return md >= fromMd && md <= untilMd;
  return md >= fromMd || md <= untilMd;
}

function scheduleFromLevel0Annual(masterProfile, localDate) {
  const mp = masterProfile && typeof masterProfile === 'object' ? masterProfile : {};
  const level0 = mp.level0 && typeof mp.level0 === 'object' ? mp.level0 : {};
  const from = normalizeMonthDay(level0.annualOpenFrom);
  const until = normalizeMonthDay(level0.annualOpenUntil);
  const todayMd = localDateToMonthDay(localDate);
  if (!isMonthDayInRange(todayMd, from, until)) return null;
  const openingTime =
    level0.baselineOpenTime != null && String(level0.baselineOpenTime).trim() !== ''
      ? String(level0.baselineOpenTime).trim()
      : '09:00';
  const closingTime =
    level0.baselineCloseTime != null && String(level0.baselineCloseTime).trim() !== ''
      ? String(level0.baselineCloseTime).trim()
      : '18:00';
  return { date: localDate, type: 'OPERATING', openingTime, closingTime };
}

class OperationalContextService {
  constructor() {
    this.operatingRepo = new ParkOperatingSnapshotRepository();
  }

  /**
   * @param {string} internalParkId - UUID
   * @param {{ at?: Date|string }} [opts]
   */
  async getOperationalContext(internalParkId, opts = {}) {
    const at = opts.at === undefined || opts.at === null ? new Date() : new Date(opts.at);
    if (Number.isNaN(at.getTime())) {
      throw new AppError('Invalid at', 400, { code: 'INVALID_QUERY_AT' });
    }

    const park = await Park.findByPk(internalParkId, {
      attributes: ['id', 'name', 'slug', 'timezone', 'externalEntityId', 'enrichment', 'masterProfile', 'updatedAt'],
    });
    if (!park) {
      throw new AppError('Park not found', 404, { code: 'PARK_NOT_FOUND' });
    }

    const plain = park.get({ plain: true });
    const tz = plain.timezone || 'UTC';
    const localParts = localCalendarParts(at, tz);
    const externalParkId = externalParkKeyForSnapshots(plain);
    const externalParkIdCandidates = [
      ...new Set(
        [externalParkId, plain.externalEntityId, plain.slug]
          .filter((x) => x != null && String(x).trim() !== '')
          .map((x) => String(x).trim())
      ),
    ];

    const calendarRow = await ParkCalendarContext.findOne({
      where: { parkId: plain.id, contextDate: localParts.localDate },
    });

    let scheduleRow = syntheticScheduleFromParkEnrichment(plain.enrichment, localParts.localDate);
    let scheduleSampledAt = null;
    let scheduleProvider = null;

    if (scheduleRow) {
      scheduleProvider = 'MASTER_DATA';
      scheduleSampledAt = plain.updatedAt ? new Date(plain.updatedAt) : null;
    } else if (externalParkIdCandidates.length) {
      const opRow = await this.operatingRepo.findLatestOpeningRowForLocalDateFirstMatching(
        'themeparks_wiki',
        externalParkIdCandidates,
        localParts.localDate
      );
      if (opRow) {
        scheduleRow = opRow.openingTimes;
        scheduleSampledAt = opRow.sampledAt;
        scheduleProvider = opRow.scheduleProvider ?? null;
      }
    }

    const scheduleType = String(scheduleRow?.type || 'OPERATING').toUpperCase();
    const level0Annual = scheduleFromLevel0Annual(plain.masterProfile, localParts.localDate);
    if (level0Annual && (!scheduleRow || scheduleType !== 'OPERATING')) {
      scheduleRow = level0Annual;
      scheduleProvider = 'LEVEL0_ANNUAL';
      scheduleSampledAt = plain.updatedAt ? new Date(plain.updatedAt) : null;
    }

    const bucket = bucket5m(at);
    const evalResult = evaluateScheduledOperatingHours(scheduleRow, bucket, tz);

    let latestSnap = null;
    for (const ext of externalParkIdCandidates) {
      // eslint-disable-next-line no-await-in-loop
      const row = await ParkFeatureSnapshot.findOne({
        where: { internalParkId: plain.id, provider: 'themeparks_wiki', externalParkId: ext },
        order: [['snapshotAt', 'DESC']],
      });
      if (row) {
        latestSnap = row;
        break;
      }
    }

    const snapPlain = latestSnap ? latestSnap.get({ plain: true }) : null;

    const season = seasonIndicatorFromCode(localParts.season);
    const openingHours = openingHoursSummary(scheduleRow);

    return {
      park: {
        id: plain.id,
        name: plain.name,
        slug: plain.slug,
        timezone: plain.timezone,
        externalParkKey: externalParkId,
      },
      at: at.toISOString(),
      bucketAt: bucket.toISOString(),
      localDate: localParts.localDate,
      localHour: localParts.localHour,
      /** Meteorologische Saison im Park-Kalender (Feature-Store-Codes 1–4). */
      season,
      calendar: calendarRow ? calendarRow.get({ plain: true }) : null,
      operatingHours: {
        scheduleProvider,
        scheduleRow,
        summary: openingHours,
        scheduleSampledAt: scheduleSampledAt ? new Date(scheduleSampledAt).toISOString() : null,
        withinScheduledOperatingHours: evalResult.within,
        interpretation: evalResult.interpretation,
      },
      latestFeatureSnapshot: snapPlain,
    };
  }
}

module.exports = {
  OperationalContextService,
  externalParkKeyForSnapshots,
  bucket5m,
  openingHoursSummary,
};
