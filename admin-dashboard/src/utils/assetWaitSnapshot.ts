import type { PlatformAsset } from '@/types/api'

/** Minutes from last synced ThemeParks queue.STANDBY.waitTime when present. */
export function waitMinutesFromAssetSnapshot(a: PlatformAsset): number | null {
  const asFinite = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return null
  }

  const snap = a.providerSnapshot as Record<string, unknown> | undefined
  if (!snap || typeof snap !== 'object') return null
  const last = snap.lastEntity as Record<string, unknown> | undefined
  if (!last || typeof last !== 'object') return null

  const direct = asFinite(last.waitTime)
  if (direct != null) return Math.max(0, Math.round(direct))

  const queue = last.queue as Record<string, unknown> | undefined
  if (!queue || typeof queue !== 'object') return null

  const queueDirect = asFinite(queue.waitTime)
  if (queueDirect != null) return Math.max(0, Math.round(queueDirect))

  const standby = queue.STANDBY as Record<string, unknown> | undefined
  if (!standby || typeof standby !== 'object') return null
  const w = asFinite(standby.waitTime)
  if (w == null) return null
  return Math.max(0, Math.round(w))
}
