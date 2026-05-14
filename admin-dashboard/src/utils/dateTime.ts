/**
 * Central date/time helpers: API instants are UTC ISO; formatting uses RegionalPrefs (user + fallbacks).
 */

export type DateFormatId = 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY'
export type TimeFormatId = '24h' | '12h'

export interface RegionalPrefs {
  timeZone: string
  locale: string
  dateFormat: DateFormatId
  timeFormat: TimeFormatId
}

const LANG_DEFAULT_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
}

export function browserDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function defaultLocaleForLanguage(languageCode: string | null | undefined): string {
  const c = (languageCode || 'en').slice(0, 2).toLowerCase()
  return LANG_DEFAULT_LOCALE[c] || 'en-US'
}

export function resolveRegionalPrefs(partial: {
  timezone?: string | null
  dateFormat?: string | null
  timeFormat?: string | null
  locale?: string | null
  languageCode?: string | null
}): RegionalPrefs {
  const timeZone =
    partial.timezone && String(partial.timezone).trim()
      ? String(partial.timezone).trim()
      : browserDefaultTimeZone()
  const dateFormat = (partial.dateFormat as DateFormatId) || 'YYYY-MM-DD'
  const timeFormat = partial.timeFormat === '12h' ? '12h' : '24h'
  const locale =
    partial.locale && String(partial.locale).trim()
      ? String(partial.locale).trim()
      : defaultLocaleForLanguage(partial.languageCode)
  return {
    timeZone,
    locale,
    dateFormat: ['DD.MM.YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'].includes(dateFormat)
      ? dateFormat
      : 'YYYY-MM-DD',
    timeFormat,
  }
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function zonedYmdParts(d: Date, timeZone: string): { y: number; m: number; day: number } {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  ) as Record<string, string>
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
  }
}

function zonedHmParts(d: Date, timeZone: string): { h: number; mi: number; s: number } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  ) as Record<string, string>
  return {
    h: Number(parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second),
  }
}

/** Find UTC instant where wall clock in `timeZone` equals y-mo-d h:mi:s (±36h search from noon UTC anchor). */
export function utcInstantForZonedWallClock(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string
): Date | null {
  const anchor = Date.UTC(y, mo - 1, d, 12, 0, 0)
  for (let deltaMin = -36 * 60; deltaMin <= 36 * 60; deltaMin++) {
    const t = anchor + deltaMin * 60_000
    const zd = zonedYmdParts(new Date(t), timeZone)
    const zh = zonedHmParts(new Date(t), timeZone)
    if (zd.y === y && zd.m === mo && zd.day === d && zh.h === h && zh.mi === mi && zh.s === s) return new Date(t)
  }
  return null
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export function formatDateInPrefs(value: string | number | Date | null | undefined, prefs: RegionalPrefs): string {
  const d = toDate(value)
  if (!d) return '—'
  const { y, m, day } = zonedYmdParts(d, prefs.timeZone)
  switch (prefs.dateFormat) {
    case 'DD.MM.YYYY':
      return `${pad2(day)}.${pad2(m)}.${y}`
    case 'MM/DD/YYYY':
      return `${pad2(m)}/${pad2(day)}/${y}`
    default:
      return `${y}-${pad2(m)}-${pad2(day)}`
  }
}

export function formatTimeInPrefs(value: string | number | Date | null | undefined, prefs: RegionalPrefs): string {
  const d = toDate(value)
  if (!d) return '—'
  return new Intl.DateTimeFormat(prefs.locale, {
    timeZone: prefs.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: prefs.timeFormat === '12h',
  }).format(d)
}

export function formatDateTimeInPrefs(value: string | number | Date | null | undefined, prefs: RegionalPrefs): string {
  const d = toDate(value)
  if (!d) return '—'
  return `${formatDateInPrefs(d, prefs)}, ${formatTimeInPrefs(d, prefs)}`
}

/**
 * UTC instant → components for HTML date/time inputs, interpreted in the user's timezone (RegionalPrefs).
 */
export function wallDateTimePartsForPrefs(
  value: string | number | Date | null | undefined,
  prefs: RegionalPrefs
): { date: string; time: string } {
  const d = toDate(value)
  if (!d) return { date: '', time: '' }
  const { y, m, day } = zonedYmdParts(d, prefs.timeZone)
  const { h, mi } = zonedHmParts(d, prefs.timeZone)
  return {
    date: `${y}-${pad2(m)}-${pad2(day)}`,
    time: `${pad2(h)}:${pad2(mi)}`,
  }
}

export function formatRelativeTimeInPrefs(
  value: string | number | Date | null | undefined,
  prefs: RegionalPrefs,
  now: Date = new Date()
): string {
  const d = toDate(value)
  if (!d) return '—'
  let sec = Math.round((d.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(sec)
  const rtf = new Intl.RelativeTimeFormat(prefs.locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(-Math.round((now.getTime() - d.getTime()) / 1000), 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day')
  return formatDateTimeInPrefs(d, prefs)
}

/**
 * Wall calendar date (YYYY-MM-DD) and optional time (HH:mm) interpreted in prefs.timeZone → UTC ISO.
 */
export function toUtcIsoFromUserLocal(
  wallDate: string,
  prefs: RegionalPrefs,
  wallTime?: string
): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wallDate.trim())
  if (!dm) return null
  const y = Number(dm[1])
  const mo = Number(dm[2])
  const d = Number(dm[3])
  let h = 0
  let mi = 0
  let s = 0
  if (wallTime) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(wallTime.trim())
    if (!tm) return null
    h = Number(tm[1])
    mi = Number(tm[2])
    s = tm[3] != null ? Number(tm[3]) : 0
  }
  const inst = utcInstantForZonedWallClock(y, mo, d, h, mi, s, prefs.timeZone)
  return inst ? inst.toISOString() : null
}

export function getTimezoneLabel(timeZone: string, locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: 'long',
    }).formatToParts(new Date())
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    return name || timeZone
  } catch {
    return timeZone
  }
}

export function chartFootnoteLine(prefs: RegionalPrefs): string {
  const tzLabel = getTimezoneLabel(prefs.timeZone, prefs.locale)
  const mode = prefs.timeFormat === '12h' ? '12h' : '24h'
  return `${tzLabel} (${mode})`
}

/** Filename stamp: always UTC for stable cross-platform names. */
export function utcDateStampForFilename(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

/** UTC date+time compact for export filenames (not user-local). */
export function utcCompactTimestampForFilename(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace(/[:T]/g, '-')
}
