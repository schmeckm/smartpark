export type PreviewMeta = {
  truncated: boolean
  rowCount: number | null
  originalBytes: number | null
  fieldCount: number | null
  warning: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

export function extractPreviewMeta(obj: unknown): PreviewMeta {
  if (!isRecord(obj)) {
    return { truncated: false, rowCount: null, originalBytes: null, fieldCount: null, warning: null }
  }
  const truncated = obj._truncated === true || typeof obj._warning === 'string'
  const rowCount = typeof obj._rowCount === 'number' ? obj._rowCount : null
  const originalBytes = typeof obj._originalBytes === 'number' ? obj._originalBytes : null
  const fieldCount = typeof obj._fieldCount === 'number' ? obj._fieldCount : null
  const warning = typeof obj._warning === 'string' ? obj._warning : null
  return { truncated, rowCount, originalBytes, fieldCount, warning }
}

export function isPreviewTruncated(obj: unknown): boolean {
  return extractPreviewMeta(obj).truncated
}

export function formatPreviewJson(obj: unknown): string {
  if (obj === undefined) return ''
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function estimatePayloadBytes(obj: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length
  } catch {
    return null
  }
}
