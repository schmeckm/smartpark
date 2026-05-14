/**
 * Maps UNS Live / MQTT ring-buffer rows to one ride signal capability row (Stammdaten „Signale“).
 * Same rules as `src/utils/uns-mqtt-live-signal-match.mjs` (Node tests) — keep behaviour in sync.
 */
export type CollectMatchingLiveEventsOpts = {
  /** When set, buffer rows must belong to this ride (UNS `/rides/{slug}/…`, Sparkplug segment, or deviceId). */
  rideAssetSlug?: string | null
}

/** When slug is set, the live row must resolve to that ride (avoids homonym metrics across assets). */
export function liveEventMatchesRideAssetSlug(event: object, slugRaw: string | null | undefined): boolean {
  const slug = String(slugRaw ?? '')
    .trim()
    .toLowerCase()
  if (!slug) return true
  const row = event as {
    canonicalUnsTopic?: string | null
    sparkplugTopic?: string | null
    deviceId?: string | null
  }
  const can = row.canonicalUnsTopic != null ? String(row.canonicalUnsTopic).trim().toLowerCase() : ''
  if (can.includes(`/rides/${slug}/`) || can.endsWith(`/rides/${slug}`)) return true
  const st = row.sparkplugTopic != null ? String(row.sparkplugTopic).trim().toLowerCase() : ''
  if (st && st.split('/').filter(Boolean).some((p) => p === slug)) return true
  const dev = row.deviceId != null ? String(row.deviceId).trim().toLowerCase() : ''
  if (dev === slug) return true
  return false
}

export function collectMatchingLiveEvents<T extends object>(
  signal: object,
  events: readonly T[],
  opts?: CollectMatchingLiveEventsOpts
): T[] {
  const s = signal as {
    unsTopicPreview?: string | null
    signalCode?: string
    sparkplugMetricPreview?: string | null
  }
  const preview = s.unsTopicPreview != null ? String(s.unsTopicPreview).trim() : ''
  const code = String(s.signalCode || '').trim()
  const spark = s.sparkplugMetricPreview != null ? String(s.sparkplugMetricPreview).trim() : ''
  const sparkTail = spark ? spark.split('/').pop() || spark : ''
  const slugFilter = opts?.rideAssetSlug != null ? String(opts.rideAssetSlug).trim() : ''

  const candidates = [...events].filter((e) => {
    if (slugFilter && !liveEventMatchesRideAssetSlug(e, slugFilter)) return false
    const row = e as {
      canonicalUnsTopic?: string | null
      sparkplugTopic?: string | null
      metric?: string | null
    }
    const can = row.canonicalUnsTopic != null ? String(row.canonicalUnsTopic).trim() : ''
    const st = row.sparkplugTopic != null ? String(row.sparkplugTopic) : ''
    const m = String(row.metric || '').trim()

    if (preview) {
      if (can && can === preview) return true
      if (sparkTail && st && st.toLowerCase().includes(sparkTail.toLowerCase())) return true
      return false
    }
    if (code && m && m.toLowerCase() === code.toLowerCase()) return true
    if (sparkTail && st && st.toLowerCase().includes(sparkTail.toLowerCase())) return true
    return false
  })
  candidates.sort((a, b) => {
    const ra = (a as { receivedAt?: unknown }).receivedAt
    const rb = (b as { receivedAt?: unknown }).receivedAt
    return Date.parse(String(rb)) - Date.parse(String(ra))
  })
  return candidates
}
