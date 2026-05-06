import type { SqdcMonthRingDay, SqdcRingTone } from '@/api/client'

export type SqdcMonthRingToneKey = 'safety' | 'quality' | 'delivery' | 'cost' | 'people'

export function toneRank(t: SqdcRingTone): number {
  if (t === 'green') return 3
  if (t === 'amber') return 2
  if (t === 'red') return 1
  return 0
}

/** For `SqdcMonthRingCard` — ring-day tone or neutral (avoids `string` inference from `tone && …`). */
export function monthRingStatusToneFromRingDay(tone: SqdcRingTone | undefined): SqdcRingTone | 'neutral' {
  if (tone === undefined || tone === 'empty') return 'neutral'
  return tone
}

export function findDayRow(days: SqdcMonthRingDay[], dateIso: string): SqdcMonthRingDay | undefined {
  return days.find((d) => d.date === dateIso)
}

export function prevUtcCalendarDayIso(dateIso: string): string | null {
  const parts = dateIso.split('-').map(Number)
  const y = parts[0]
  const m = parts[1]
  const d = parts[2]
  if (!y || !m || !d) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 1)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Compare ring tone on `dateIso` vs previous UTC calendar day (only if both days exist in `days`). */
export function ringToneTrendLabel(
  days: SqdcMonthRingDay[],
  dateIso: string,
  key: SqdcMonthRingToneKey,
  labels: { up: string; down: string; flat: string }
): string | null {
  const cur = findDayRow(days, dateIso)
  const prevIso = prevUtcCalendarDayIso(dateIso)
  if (!cur || !prevIso) return null
  const prev = findDayRow(days, prevIso)
  if (!prev) return null
  const delta = toneRank(cur[key]) - toneRank(prev[key])
  if (delta > 0) return labels.up
  if (delta < 0) return labels.down
  return labels.flat
}

/** Same UTC calendar day as the API uses for month rings (`YYYY-MM-DD`). */
export function utcCalendarTodayIso(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function scoreToRingToneFromScore(
  v: number | null | undefined,
  greenMin: number,
  amberMin: number
): SqdcRingTone | null {
  if (v == null || !Number.isFinite(Number(v))) return null
  const n = Number(v)
  if (n >= greenMin) return 'green'
  if (n >= amberMin) return 'amber'
  return 'red'
}

function costEurToRingTone(
  eur: number | null | undefined,
  greenMax: number,
  amberMax: number
): SqdcRingTone | null {
  if (eur == null || !Number.isFinite(eur) || eur <= 0) return null
  let gMax = greenMax
  let aMax = amberMax
  gMax = Math.max(1, gMax)
  aMax = Math.max(gMax + 1, aMax)
  if (eur <= gMax) return 'green'
  if (eur <= aMax) return 'amber'
  return 'red'
}

function moodAvgToPeopleRingTone(
  avg: number | null | undefined,
  greenMin: number,
  amberMin: number
): SqdcRingTone | null {
  if (avg == null || !Number.isFinite(avg)) return null
  let g = greenMin
  let a = amberMin
  g = Math.min(5, Math.max(1, g))
  a = Math.min(5, Math.max(1, a))
  if (a >= g) a = Math.max(1, g - 0.5)
  if (avg >= g) return 'green'
  if (avg >= a) return 'amber'
  return 'red'
}

export type MergeLiveSqdcRingScoresOpts = {
  utcTodayIso: string
  selectedDateIso: string
  scoreGreenMin: number
  scoreAmberMin: number
  scores: { safety?: number | null; quality?: number | null; delivery?: number | null } | null | undefined
  costEurGreenMax: number
  costEurAmberMax: number
  electricityCostEurPerDay: number | null | undefined
  peopleMoodGreenMin: number
  peopleMoodAmberMin: number
  moodAvgSelectedDay: number | null | undefined
}

/**
 * When the board date is **UTC today** and a ring segment is still `empty` (no daily snapshot yet),
 * fill S/Q/D/C/P from the same live values used by the hero gauges so the ring matches the center.
 */
export function mergeLiveScoresIntoMonthRingDays(
  days: SqdcMonthRingDay[],
  opts: MergeLiveSqdcRingScoresOpts
): SqdcMonthRingDay[] {
  if (!days.length || opts.selectedDateIso !== opts.utcTodayIso) return days

  return days.map((day) => {
    if (day.date !== opts.utcTodayIso) return day
    const next: SqdcMonthRingDay = { ...day }

    const sq = scoreToRingToneFromScore(opts.scores?.safety, opts.scoreGreenMin, opts.scoreAmberMin)
    if (next.safety === 'empty' && sq) next.safety = sq
    const qq = scoreToRingToneFromScore(opts.scores?.quality, opts.scoreGreenMin, opts.scoreAmberMin)
    if (next.quality === 'empty' && qq) next.quality = qq
    const dq = scoreToRingToneFromScore(opts.scores?.delivery, opts.scoreGreenMin, opts.scoreAmberMin)
    if (next.delivery === 'empty' && dq) next.delivery = dq

    const c = costEurToRingTone(opts.electricityCostEurPerDay, opts.costEurGreenMax, opts.costEurAmberMax)
    if (next.cost === 'empty' && c) next.cost = c

    const p = moodAvgToPeopleRingTone(opts.moodAvgSelectedDay, opts.peopleMoodGreenMin, opts.peopleMoodAmberMin)
    if (next.people === 'empty' && p) next.people = p

    return next
  })
}
