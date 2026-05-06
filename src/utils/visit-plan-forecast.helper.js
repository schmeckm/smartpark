const { FIXED_ROW_IDS, allDatesInYear } = require('./visit-plan-spreadsheet.helper');

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Same calendar month/day in `sourceYear` (clamp day if that month is shorter,
 * e.g. target Feb 29 → Feb 28 when source year is non-leap).
 */
function mapToSourceYearSameCalendarDay(targetIso, sourceYear) {
  const parts = targetIso.split('-');
  if (parts.length !== 3) return null;
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) return null;
  const dim = daysInMonth(sourceYear, m);
  const dClamped = Math.min(d, dim);
  return `${sourceYear}-${String(m).padStart(2, '0')}-${String(dClamped).padStart(2, '0')}`;
}

function rowIdsForPayload(payload) {
  const ids = [...FIXED_ROW_IDS];
  for (const h of payload.hotels || []) {
    if (h && typeof h.id === 'string' && h.id.length > 0) ids.push(h.id);
  }
  return ids;
}

/**
 * Rule-based forecast: copy Ist values from `sourceYear` by matching calendar month/day
 * into `planYear` cells (per planning row id).
 */
function applyPriorYearActualsForecast(basePayload, planYear, sourceGuestCounts, sourceYear, opts = {}) {
  const scale =
    typeof opts.scale === 'number' && Number.isFinite(opts.scale) ? Math.max(0, opts.scale) : 1;
  const emptyOnly = opts.emptyOnly !== false;

  const payload = JSON.parse(JSON.stringify(basePayload));
  payload.guestCounts = { ...(payload.guestCounts || {}) };

  const rowIds = rowIdsForPayload(payload);
  const dates = allDatesInYear(planYear);
  let cellsFilled = 0;
  let cellsSkippedExisting = 0;
  let cellsSkippedNoSource = 0;

  for (const rowId of rowIds) {
    for (const targetIso of dates) {
      const keyT = `${rowId}::${targetIso}`;
      if (emptyOnly && typeof payload.guestCounts[keyT] === 'number') {
        cellsSkippedExisting += 1;
        continue;
      }
      const srcIso = mapToSourceYearSameCalendarDay(targetIso, sourceYear);
      if (!srcIso) continue;
      const keyS = `${rowId}::${srcIso}`;
      const raw = sourceGuestCounts[keyS];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        cellsSkippedNoSource += 1;
        continue;
      }
      payload.guestCounts[keyT] = Math.min(1_000_000_000, Math.max(0, Math.round(raw * scale)));
      cellsFilled += 1;
    }
  }

  return {
    payload,
    summary: { cellsFilled, cellsSkippedExisting, cellsSkippedNoSource },
  };
}

module.exports = {
  applyPriorYearActualsForecast,
  mapToSourceYearSameCalendarDay,
  rowIdsForPayload,
};
