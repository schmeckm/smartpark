import type { PlatformOperationalContext } from '@/types/api'
import { utcInstantForZonedWallClock, zonedYmdParts } from '@/utils/dateTime'

/** Start of the next local calendar day after (y, mo, day) in `tz` (midnight of that next day). */
export function startOfNextLocalDayMs(tz: string, y: number, mo: number, day: number): number | null {
  const cur0 = utcInstantForZonedWallClock(y, mo, day, 0, 0, 0, tz)
  if (!cur0) return null
  let t = cur0.getTime() + 3600000
  for (let i = 0; i < 48; i++) {
    const p = zonedYmdParts(new Date(t), tz)
    if (p.y !== y || p.m !== mo || p.day !== day) {
      const n0 = utcInstantForZonedWallClock(p.y, p.m, p.day, 0, 0, 0, tz)
      return n0?.getTime() ?? null
    }
    t += 3600000
  }
  return null
}

export function collectParkLocalDateKeys(tz: string, tStartMs: number, tEndMs: number): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  let t = tStartMs
  const step = 3 * 3600000
  while (t <= tEndMs + step) {
    const p = zonedYmdParts(new Date(t), tz)
    const k = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
    if (!seen.has(k)) {
      seen.add(k)
      keys.push(k)
    }
    t += step
    if (seen.size > 120) break
  }
  return keys
}

export function parseHmToMinutes(raw: string | null | undefined): number | null {
  const s = raw != null ? String(raw).trim() : ''
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return h * 60 + mi
}

function clipRange(lo: number, hi: number, tMinMs: number, tMaxMs: number): [number, number] | null {
  const a = Math.max(lo, tMinMs)
  const b = Math.min(hi, tMaxMs)
  return a < b ? [a, b] : null
}

function ymdPartsFromKey(ymd: string): { y: number; m: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) }
}

export function noonIsoForParkLocalYmd(tz: string, ymd: string): string {
  const p = ymdPartsFromKey(ymd)
  if (!p) return new Date().toISOString()
  const inst = utcInstantForZonedWallClock(p.y, p.m, p.day, 12, 0, 0, tz)
  return (inst ?? new Date()).toISOString()
}

/**
 * Closed (non-operating) wall-clock intervals from per-day operational-context snapshots,
 * clipped to the chart window. Same-calendar-day open/close only (no overnight close).
 */
export function closedRangesFromOperationalDays(
  tz: string,
  tMinMs: number,
  tMaxMs: number,
  contextsByYmd: Map<string, PlatformOperationalContext>
): { start: number; end: number }[] {
  const raw: { start: number; end: number }[] = []
  for (const [ymd, ctx] of contextsByYmd) {
    const p = ymdPartsFromKey(ymd)
    if (!p) continue
    const { y, m, day } = p
    const dayStart = utcInstantForZonedWallClock(y, m, day, 0, 0, 0, tz)?.getTime()
    const dayEnd = startOfNextLocalDayMs(tz, y, m, day)
    if (dayStart == null || dayEnd == null) continue

    const sum = ctx.operatingHours.summary
    const row = ctx.operatingHours.scheduleRow as { type?: string } | null
    const typ = String(sum?.type ?? row?.type ?? 'OPERATING').toUpperCase()
    if (typ !== 'OPERATING') {
      const seg = clipRange(dayStart, dayEnd, tMinMs, tMaxMs)
      if (seg) raw.push({ start: seg[0], end: seg[1] })
      continue
    }
    const openMin = parseHmToMinutes(sum?.openingTime ?? null)
    const closeMin = parseHmToMinutes(sum?.closingTime ?? null)
    if (openMin == null || closeMin == null) continue
    if (closeMin <= openMin) continue
    const oH = Math.floor(openMin / 60)
    const oMi = openMin % 60
    const cH = Math.floor(closeMin / 60)
    const cMi = closeMin % 60
    const openMs = utcInstantForZonedWallClock(y, m, day, oH, oMi, 0, tz)?.getTime()
    const closeMs = utcInstantForZonedWallClock(y, m, day, cH, cMi, 0, tz)?.getTime()
    if (openMs == null || closeMs == null || closeMs <= openMs) continue
    const before = clipRange(dayStart, openMs, tMinMs, tMaxMs)
    if (before) raw.push({ start: before[0], end: before[1] })
    const after = clipRange(closeMs, dayEnd, tMinMs, tMaxMs)
    if (after) raw.push({ start: after[0], end: after[1] })
  }
  raw.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const seg of raw) {
    const prev = merged.length ? merged[merged.length - 1] : undefined
    if (prev && seg.start <= prev.end) prev.end = Math.max(prev.end, seg.end)
    else merged.push({ ...seg })
  }
  return merged
}

export function markAreaPairsFromClosedRanges(
  ranges: { start: number; end: number }[]
): [Record<string, unknown>, Record<string, unknown>][] {
  return ranges.map((r) => [
    { xAxis: r.start, yAxis: 'min' as const, yAxisIndex: 0 },
    { xAxis: r.end, yAxis: 'max' as const, yAxisIndex: 0 },
  ])
}
