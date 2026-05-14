/** Cell key: `${rowId}::YYYY-MM-DD` */

/** Fixed row ids for ticket channels (must match backend / planning grid). */
export const VISIT_PLAN_TICKET_CHANNEL_ROW_IDS = ['sp:ch:kasse', 'sp:ch:vorverkauf', 'sp:ch:freikarten'] as const

export function cellKey(rowId: string, dateIso: string) {
  return `${rowId}::${dateIso}`
}

export function datesInMonth(year: number, month1to12: number): string[] {
  const last = new Date(year, month1to12, 0).getDate()
  const padM = String(month1to12).padStart(2, '0')
  const out: string[] = []
  for (let d = 1; d <= last; d++) {
    out.push(`${year}-${padM}-${String(d).padStart(2, '0')}`)
  }
  return out
}

/**
 * Consecutive calendar months within `year`, starting at `startMonth1to12`.
 * Stops at December (no spill into the next calendar year).
 */
export function datesFromMonthHorizon(
  year: number,
  startMonth1to12: number,
  horizonMonths: number
): string[] {
  const span = Math.max(1, Math.min(12, Math.floor(horizonMonths)))
  const start = Math.min(12, Math.max(1, Math.floor(startMonth1to12)))
  const out: string[] = []
  for (let i = 0; i < span; i++) {
    const m = start + i
    if (m > 12) break
    out.push(...datesInMonth(year, m))
  }
  return out
}

function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function allDatesInYear(year: number): string[] {
  const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const out: string[] = []
  for (let m = 1; m <= 12; m++) {
    const pad = String(m).padStart(2, '0')
    for (let d = 1; d <= dim[m - 1]; d++) {
      out.push(`${year}-${pad}-${String(d).padStart(2, '0')}`)
    }
  }
  return out
}

/** Keep only keys whose date belongs to `year`. */
export function pruneGuestCountsForYear(
  gc: Record<string, number>,
  year: number
): Record<string, number> {
  const prefix = `${year}-`
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(gc)) {
    const parts = k.split('::')
    if (parts.length !== 2) continue
    if (!parts[1].startsWith(prefix)) continue
    if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) out[k] = Math.round(v)
  }
  return out
}

/** Local calendar weekday (0 = Sunday … 6 = Saturday) for `YYYY-MM-DD`. */
export function weekdayIndexLocal(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

export function dailyVisitTotal(
  guestCounts: Record<string, number>,
  rowIds: readonly string[],
  dateIso: string
): number {
  let s = 0
  for (const rid of rowIds) {
    const k = cellKey(rid, dateIso)
    const v = guestCounts[k]
    if (typeof v === 'number' && v >= 0) s += v
  }
  return s
}

export function yearVisitGrandTotal(
  guestCounts: Record<string, number>,
  rowIds: readonly string[],
  year: number
): number {
  return allDatesInYear(year).reduce((acc, d) => acc + dailyVisitTotal(guestCounts, rowIds, d), 0)
}

export function monthlyVisitTotals(
  guestCounts: Record<string, number>,
  rowIds: readonly string[],
  year: number,
  locale: string
): { month: number; label: string; total: number }[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'short' })
  const out: { month: number; label: string; total: number }[] = []
  for (let month = 1; month <= 12; month++) {
    let total = 0
    for (const d of datesInMonth(year, month)) {
      total += dailyVisitTotal(guestCounts, rowIds, d)
    }
    out.push({
      month,
      label: fmt.format(new Date(year, month - 1, 1)),
      total,
    })
  }
  return out
}

export function weekdayVisitAverages(
  guestCounts: Record<string, number>,
  rowIds: readonly string[],
  year: number,
  locale: string
): { dow: number; label: string; avg: number | null }[] {
  const dates = allDatesInYear(year)
  const sums = [0, 0, 0, 0, 0, 0, 0]
  const counts = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dates) {
    const dow = weekdayIndexLocal(d)
    sums[dow] += dailyVisitTotal(guestCounts, rowIds, d)
    counts[dow] += 1
  }
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    const refSunday = new Date(2026, 0, 4)
    const label = fmt.format(new Date(refSunday.getFullYear(), refSunday.getMonth(), refSunday.getDate() + dow))
    const c = counts[dow]
    const avg = sums[dow] === 0 ? null : Math.round(sums[dow] / c)
    return { dow, label, avg }
  })
}

/**
 * Fill empty cells per row using the row’s own weekday mean over the plan year (rule-based projection).
 * Does not overwrite existing values.
 */
export function fillEmptyByWeekdayMean(
  guestCounts: Record<string, number>,
  rowIds: readonly string[],
  year: number
): Record<string, number> {
  const dates = allDatesInYear(year)
  const next: Record<string, number> = { ...guestCounts }
  for (const rowId of rowIds) {
    const buckets: number[][] = [[], [], [], [], [], [], []]
    for (const d of dates) {
      const k = cellKey(rowId, d)
      const v = next[k]
      if (typeof v === 'number' && v >= 0) {
        buckets[weekdayIndexLocal(d)].push(v)
      }
    }
    const means = buckets.map((arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : Number.NaN
    )
    for (const d of dates) {
      const k = cellKey(rowId, d)
      if (typeof next[k] === 'number') continue
      const dow = weekdayIndexLocal(d)
      const m = means[dow]
      if (Number.isFinite(m)) next[k] = Math.max(0, Math.round(m))
    }
  }
  return next
}
