const { randomUUID } = require('crypto');
const { VisitPlanVersion, VisitActualYearly } = require('../models');
const {
  buildVisitPlanXlsxBuffer,
  parseVisitPlanXlsx,
  mergePayloadFromImport,
  FIXED_ROW_IDS,
} = require('../utils/visit-plan-spreadsheet.helper');
const { applyPriorYearActualsForecast } = require('../utils/visit-plan-forecast.helper');

function defaultPayload() {
  return {
    schemaVersion: 2,
    hotels: [
      { id: randomUUID(), name: 'Hotel 1' },
      { id: randomUUID(), name: 'Hotel 2' },
    ],
    guestCounts: {},
  };
}

function assertPayloadMatchesYear(payload, planYear) {
  const y = String(planYear);
  const { guestCounts } = payload;
  if (!guestCounts || typeof guestCounts !== 'object') return;
  for (const k of Object.keys(guestCounts)) {
    const parts = k.split('::');
    if (parts.length !== 2) {
      throw new Error(`INVALID_PAYLOAD_DATE_KEY:${k}`);
    }
    const iso = parts[1];
    if (!iso.startsWith(`${y}-`)) {
      throw new Error(`GUEST_COUNT_DATE_OUTSIDE_PLAN_YEAR:${iso}`);
    }
  }
}

class VisitPlanService {
  async listForPark(parkId, year) {
    const rows = await VisitPlanVersion.findAll({
      where: { parkId, planYear: year },
      order: [['updated_at', 'DESC']],
      attributes: ['id', 'name', 'planYear', 'created_at', 'updated_at'],
    });
    return rows.map((r) => {
      const plain = r.get({ plain: true });
      return {
        id: plain.id,
        name: plain.name,
        planYear: plain.planYear,
        createdAt: plain.created_at?.toISOString?.() ?? plain.created_at,
        updatedAt: plain.updated_at?.toISOString?.() ?? plain.updated_at,
      };
    });
  }

  async getByIdForPark(id, parkId) {
    const row = await VisitPlanVersion.findOne({
      where: { id, parkId },
    });
    if (!row) return null;
    const plain = row.get({ plain: true });
    return {
      id: plain.id,
      name: plain.name,
      planYear: plain.planYear,
      payload: plain.payload,
      createdAt: plain.created_at?.toISOString?.() ?? plain.created_at,
      updatedAt: plain.updated_at?.toISOString?.() ?? plain.updated_at,
    };
  }

  async create(parkId, user, body) {
    const payload = body.payload ?? defaultPayload();
    assertPayloadMatchesYear(payload, body.planYear);
    const row = await VisitPlanVersion.create({
      parkId,
      planYear: body.planYear,
      name: body.name,
      payload,
      createdByUserId: user?.id ?? null,
    });
    return this.getByIdForPark(row.id, parkId);
  }

  async patch(id, parkId, body) {
    const row = await VisitPlanVersion.findOne({ where: { id, parkId } });
    if (!row) return null;
    if (body.name != null) {
      row.name = body.name;
    }
    if (body.payload != null) {
      assertPayloadMatchesYear(body.payload, row.planYear);
      row.payload = body.payload;
    }
    await row.save();
    return this.getByIdForPark(id, parkId);
  }

  async delete(id, parkId) {
    const n = await VisitPlanVersion.destroy({ where: { id, parkId } });
    return n > 0;
  }

  async exportXlsxBuffer(id, parkId) {
    const detail = await this.getByIdForPark(id, parkId);
    if (!detail) return null;
    const buffer = buildVisitPlanXlsxBuffer(detail);
    const safe = String(detail.name || 'plan')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'plan';
    const filename = `visit-plan-${detail.planYear}-${safe}.xlsx`;
    return { buffer, filename };
  }

  async importXlsx(id, parkId, buffer) {
    const row = await VisitPlanVersion.findOne({ where: { id, parkId } });
    if (!row) return null;
    const plain = row.get({ plain: true });
    const basePayload = plain.payload || { schemaVersion: 2, hotels: [], guestCounts: {} };
    const allowedKeys = new Set(FIXED_ROW_IDS);
    for (const h of basePayload.hotels || []) allowedKeys.add(h.id);

    const parsed = parseVisitPlanXlsx(buffer, plain.planYear, allowedKeys);
    const merged = mergePayloadFromImport(parsed, basePayload, plain.planYear);
    row.payload = merged;
    await row.save();

    const cellsWritten = Object.keys(parsed.guestCountsPatch).length;
    const cellsCleared = parsed.clears.length;

    return {
      detail: await this.getByIdForPark(id, parkId),
      summary: {
        cellsWritten,
        cellsCleared,
        unknownRowKeys: parsed.unknownRowKeys,
        ignoredColumns: parsed.ignoredColumns,
      },
    };
  }

  /**
   * Rule-based forecast into this plan version (persisted).
   * @param {{ method?: string, sourceYear: number, scale?: number, emptyOnly?: boolean }} body
   */
  async applyForecast(id, parkId, body) {
    const row = await VisitPlanVersion.findOne({ where: { id, parkId } });
    if (!row) return null;
    const method = body.method || 'prior_year_actuals';
    if (method !== 'prior_year_actuals') {
      throw new Error('UNSUPPORTED_FORECAST_METHOD');
    }
    const sourceYear = body.sourceYear;
    const actualRow = await VisitActualYearly.findOne({
      where: { parkId, actualYear: sourceYear },
    });
    const sourceCounts =
      actualRow?.guestCounts && typeof actualRow.guestCounts === 'object'
        ? actualRow.guestCounts
        : {};
    if (Object.keys(sourceCounts).length === 0) {
      throw new Error('NO_ACTUALS_FOR_SOURCE_YEAR');
    }

    const plain = row.get({ plain: true });
    const planYear = plain.planYear;
    const { payload, summary } = applyPriorYearActualsForecast(
      plain.payload,
      planYear,
      sourceCounts,
      sourceYear,
      { scale: body.scale, emptyOnly: body.emptyOnly }
    );
    assertPayloadMatchesYear(payload, planYear);
    row.payload = payload;
    await row.save();

    return {
      detail: await this.getByIdForPark(id, parkId),
      forecastSummary: summary,
    };
  }
}

module.exports = { VisitPlanService, defaultPayload };
