const XLSX = require('xlsx');
const { AppError } = require('./app-error');
const { STAFF_ROLES } = require('../models/staff.model');

const SHEET_NAME = 'Staff';
const HEADERS = [
  'id',
  'employee_number',
  'first_name',
  'last_name',
  'role',
  'current_zone_id',
  'supervisor_id',
  'available',
  'skill_level',
];

function parseBool(v) {
  if (v === true || v === false) return v;
  if (v === '' || v === undefined || v === null) return true;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return true;
}

function parseSkill(v) {
  if (v === '' || v === undefined || v === null) return 1;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function normalizeHeader(cell) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * @param {Buffer} buffer
 * @returns {Array<Record<string, unknown>>}
 */
function parseStaffXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const name = wb.SheetNames.includes(SHEET_NAME) ? SHEET_NAME : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (!rows.length) return [];
  const headerRow = rows[0].map(normalizeHeader);
  const idx = {};
  for (const h of HEADERS) {
    const i = headerRow.indexOf(h);
    if (i >= 0) idx[h] = i;
  }
  if (idx.first_name === undefined || idx.last_name === undefined || idx.role === undefined) {
    throw new AppError(
      'Excel sheet must include columns: first_name, last_name, role (and optionally id, employee_number, current_zone_id, supervisor_id, available, skill_level).',
      400,
      { code: 'STAFF_XLSX_HEADERS' }
    );
  }
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const line = rows[r];
    if (!line || !line.some((c) => String(c ?? '').trim() !== '')) continue;
    const id = idx.id !== undefined ? String(line[idx.id] ?? '').trim() : '';
    const employee_number =
      idx.employee_number !== undefined ? String(line[idx.employee_number] ?? '').trim() : '';
    const first_name = String(line[idx.first_name] ?? '').trim();
    const last_name = String(line[idx.last_name] ?? '').trim();
    const role = String(line[idx.role] ?? '').trim();
    const zoneRaw =
      idx.current_zone_id !== undefined ? String(line[idx.current_zone_id] ?? '').trim() : '';
    const supervisorRaw =
      idx.supervisor_id !== undefined ? String(line[idx.supervisor_id] ?? '').trim() : '';
    const available = idx.available !== undefined ? parseBool(line[idx.available]) : true;
    const skill_level = idx.skill_level !== undefined ? parseSkill(line[idx.skill_level]) : 1;
    if (!first_name && !last_name && !role && !id && !employee_number) continue;
    const row = {
      id: id || undefined,
      employeeNumber: employee_number || null,
      firstName: first_name,
      lastName: last_name,
      role,
      currentZoneId: zoneRaw || null,
      ...(idx.supervisor_id !== undefined ? { supervisorId: supervisorRaw || null } : {}),
      available,
      skillLevel: skill_level,
    };
    out.push(row);
  }
  return out;
}

/**
 * @param {Array<import('sequelize').Model>} staffRows — Sequelize instances with get()
 */
function buildStaffXlsxBuffer(staffRows) {
  const aoa = [HEADERS];
  for (const m of staffRows) {
    const p = m.get ? m.get({ plain: true }) : m;
    aoa.push([
      p.id ?? '',
      p.employeeNumber ?? '',
      p.firstName ?? '',
      p.lastName ?? '',
      p.role ?? '',
      p.currentZoneId ?? '',
      p.supervisorId ?? '',
      p.available === false ? false : true,
      p.skillLevel ?? 1,
    ]);
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  const readme = XLSX.utils.aoa_to_sheet([
    ['Staff roster export'],
    [''],
    ['role must be one of:'],
    ...STAFF_ROLES.map((r) => [r]),
    [''],
    ['Leave id empty to create a new row on import. employee_number must be unique when set.'],
    ['supervisor_id: UUID of another staff row (People Manager / Supervisor); leave empty for none.'],
  ]);
  XLSX.utils.book_append_sheet(wb, readme, 'Readme');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  parseStaffXlsx,
  buildStaffXlsxBuffer,
  STAFF_SHEET_HEADERS: HEADERS,
};
