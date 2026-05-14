/**
 * Defensive parsing for ML prediction trace JSON payloads (Phase 2 UI).
 */

export function safeRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function safeStringRecord(v: unknown): Record<string, string> {
  const o = safeRecord(v)
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(o)) {
    out[k] = val != null ? String(val) : ''
  }
  return out
}

export function safeStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

export function featureKeyCount(featureVectorJson: unknown): number {
  return Object.keys(safeRecord(featureVectorJson)).length
}

export function missingFeatureCount(missingFeaturesJson: unknown): number {
  return safeStringArray(missingFeaturesJson).length
}

export type FeatureTableRow = {
  name: string
  valueDisplay: string
  source: string
  status: string
  missingLabel: string
}

export function buildFeatureTableRows(
  featureVectorJson: unknown,
  featureSourcesJson: unknown,
  featureStatusJson: unknown,
  missingFeaturesJson: unknown
): FeatureTableRow[] {
  const fv = safeRecord(featureVectorJson)
  const sources = safeStringRecord(featureSourcesJson)
  const statuses = safeStringRecord(featureStatusJson)
  const missingSet = new Set(safeStringArray(missingFeaturesJson))
  const names = Object.keys(fv).length ? Object.keys(fv) : Object.keys({ ...sources, ...statuses })
  const ordered = [...new Set(names)].sort()
  return ordered.map((name) => {
    const raw = fv[name]
    let valueDisplay = '—'
    if (raw != null && typeof raw === 'number' && Number.isFinite(raw)) {
      valueDisplay = String(raw)
    } else if (raw != null && raw !== '') {
      valueDisplay = String(raw)
    }
    const st = statuses[name] || ''
    const missing =
      missingSet.has(name) || st === 'missing' || (raw == null && name in fv && fv[name] === undefined)
    return {
      name,
      valueDisplay,
      source: sources[name] || '—',
      status: st || '—',
      missingLabel: missing ? 'yes' : 'no',
    }
  })
}

export function formatReasonCodes(reasonCodesJson: unknown): string {
  if (!Array.isArray(reasonCodesJson)) return '—'
  if (reasonCodesJson.length === 0) return '—'
  return reasonCodesJson.map((x) => String(x)).join(', ')
}
