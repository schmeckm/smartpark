const XLSX = require('xlsx');
const { AppError } = require('./app-error');

const SHEET_NAME = 'VisitPlan';

/** Stable channel row ids (must match admin UI). */
const FIXED_ROWS = [
  { id: 'sp:ch:kasse', label: 'Kasse (box office)' },
  { id: 'sp:ch:vorverkauf', label: 'Vorverkauf (advance sales)' },
  { id: 'sp:ch:freikarten', label: 'Freikarten (complimentary)' },
];

const FIXED_ROW_IDS = FIXED_ROWS.map((r) => r.id);

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function allDatesInYear(year) {
  const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const pad = String(m).padStart(2, '0');
    for (let d = 1; d <= dim[m - 1]; d++) {
      out.push(`${year}-${pad}-${String(d).padStart(2, '0')}`);
    }
  }
  return out;
}

function normalizeHeader(cell) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function assertPayloadDatesInYear(payload, planYear) {
  const y = String(planYear);
  const { guestCounts } = payload;
  if (!guestCounts || typeof guestCounts !== 'object') return;
  for (const key of Object.keys(guestCounts)) {
    const parts = key.split('::');
    if (parts.length !== 2) throw new Error(`INVALID_PAYLOAD_DATE_KEY:${key}`);
    const iso = parts[1];
    if (!iso.startsWith(`${y}-`)) throw new Error(`GUEST_COUNT_DATE_OUTSIDE_PLAN_YEAR:${iso}`);
  }
}

/**
 * @param {{ id: string, name: string, planYear: number, payload: { schemaVersion: number, hotels: Array<{id:string,name:string}>, guestCounts: Record<string, number> } }} detail
 */
function buildVisitPlanXlsxBuffer(detail) {
  const { planYear, payload, name } = detail;
  const dates = allDatesInYear(planYear);
  const header = ['row_key', 'row_label', ...dates];
  const dataRows = [];

  for (const f of FIXED_ROWS) {
    const line = [f.id, f.label];
    for (const d of dates) {
      const k = `${f.id}::${d}`;
      const v = payload.guestCounts?.[k];
      line.push(typeof v === 'number' && v >= 0 ? v : '');
    }
    dataRows.push(line);
  }
  for (const h of payload.hotels || []) {
    const line = [h.id, h.name ?? ''];
    for (const d of dates) {
      const k = `${h.id}::${d}`;
      const v = payload.guestCounts?.[k];
      line.push(typeof v === 'number' && v >= 0 ? v : '');
    }
    dataRows.push(line);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);

  const readme = XLSX.utils.aoa_to_sheet([
    ['Smart Park OS — Visit plan (Excel)'],
    [`Version: ${String(name ?? '')}`, `Plan year: ${planYear}`],
    [''],
    ['Sheet "' + SHEET_NAME + '": first column row_key must stay unchanged for fixed channels (sp:ch:*).'],
    ['Hotel rows: row_key is UUID; you may edit row_label (name updates on import).'],
    ['Date columns: YYYY-MM-DD for the plan year only. Integers = expected guests; empty cell clears.'],
    ['Import: Admin UI → Besucherplanung → Excel upload (multipart field "file").'],
  ]);
  XLSX.utils.book_append_sheet(wb, readme, 'Readme');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function parseCellNumber(raw) {
  if (raw === '' || raw === undefined || raw === null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    return n < 0 ? 0 : n;
  }
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, n);
}

/**
 * @param {Buffer} buffer
 * @param {number} planYear
 * @param {Set<string>} allowedRowKeys
 */
function parseVisitPlanXlsx(buffer, planYear, allowedRowKeys) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames.includes(SHEET_NAME) ? SHEET_NAME : wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new AppError('Excel workbook has no usable sheet', 400, { code: 'VISIT_PLAN_XLSX_EMPTY' });
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (!rows.length) {
    throw new AppError('Excel sheet is empty', 400, { code: 'VISIT_PLAN_XLSX_EMPTY' });
  }
  const rawHeader = rows[0];
  const headerRow = rawHeader.map(normalizeHeader);
  const idxKey = headerRow.indexOf('row_key');
  if (idxKey < 0) {
    throw new AppError('Excel must include a row_key column', 400, { code: 'VISIT_PLAN_XLSX_HEADERS' });
  }
  const idxLabel = headerRow.indexOf('row_label');
  const yPrefix = `${planYear}-`;
  const dateColIndices = [];
  const ignoredColumns = [];
  for (let c = 0; c < rawHeader.length; c++) {
    if (c === idxKey || c === idxLabel) continue;
    const raw = String(rawHeader[c] ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      if (raw.startsWith(yPrefix)) dateColIndices.push({ col: c, date: raw });
      else ignoredColumns.push(raw);
    }
  }
  if (!dateColIndices.length) {
    throw new AppError(
      `Excel must include date columns YYYY-MM-DD within plan year ${planYear}`,
      400,
      { code: 'VISIT_PLAN_XLSX_DATES' }
    );
  }

  const guestCountsPatch = {};
  const clears = [];
  const hotelNames = {};
  const unknownRowKeysSet = new Set();

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    if (!line) continue;
    const rowKey = String(line[idxKey] ?? '').trim();
    if (!rowKey) continue;

    if (!allowedRowKeys.has(rowKey)) {
      unknownRowKeysSet.add(rowKey);
      continue;
    }

    if (idxLabel >= 0 && line[idxLabel] !== undefined && String(line[idxLabel]).trim() !== '') {
      const lbl = String(line[idxLabel]).trim().slice(0, 200);
      if (!rowKey.startsWith('sp:ch:')) {
        hotelNames[rowKey] = lbl;
      }
    }

    for (const { col, date } of dateColIndices) {
      const k = `${rowKey}::${date}`;
      const num = parseCellNumber(line[col]);
      if (num === null) clears.push(k);
      else guestCountsPatch[k] = num;
    }
  }

  return {
    guestCountsPatch,
    clears,
    hotelNames,
    unknownRowKeys: [...unknownRowKeysSet],
    ignoredColumns,
  };
}

function mergePayloadFromImport(parsed, basePayload, planYear) {
  const payload = {
    schemaVersion: 2,
    hotels: (basePayload.hotels || []).map((h) => ({ ...h })),
    guestCounts: { ...(basePayload.guestCounts || {}) },
  };

  for (const [hid, nm] of Object.entries(parsed.hotelNames)) {
    const hi = payload.hotels.findIndex((h) => h.id === hid);
    if (hi >= 0) payload.hotels[hi] = { ...payload.hotels[hi], name: nm };
  }

  for (const k of parsed.clears) {
    delete payload.guestCounts[k];
  }
  for (const [k, v] of Object.entries(parsed.guestCountsPatch)) {
    payload.guestCounts[k] = v;
  }

  assertPayloadDatesInYear(payload, planYear);
  return payload;
}

module.exports = {
  buildVisitPlanXlsxBuffer,
  parseVisitPlanXlsx,
  mergePayloadFromImport,
  FIXED_ROW_IDS,
  allDatesInYear,
};
