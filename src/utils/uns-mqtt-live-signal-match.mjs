/** Dashboard port: `admin-dashboard/src/utils/unsMqttLiveSignalMatch.ts` — keep matching logic aligned. */

export function liveEventMatchesRideAssetSlug(event, slugRaw) {
  const slug = String(slugRaw ?? '')
    .trim()
    .toLowerCase();
  if (!slug) return true;
  const can = event.canonicalUnsTopic != null ? String(event.canonicalUnsTopic).trim().toLowerCase() : '';
  if (can.includes(`/rides/${slug}/`) || can.endsWith(`/rides/${slug}`)) return true;
  const st = event.sparkplugTopic != null ? String(event.sparkplugTopic).trim().toLowerCase() : '';
  if (st && st.split('/').filter(Boolean).some((p) => p === slug)) return true;
  const dev = event.deviceId != null ? String(event.deviceId).trim().toLowerCase() : '';
  if (dev === slug) return true;
  return false;
}

/**
 * Maps UNS Live / MQTT ring-buffer rows to one ride signal capability row (Stammdaten „Signale“).
 *
 * Same rules as the admin-dashboard telemetry drawer (`RideSignalCapabilitiesPanel` → `collectMatchingLiveEvents`).
 * If `unsTopicPreview` is set, only canonical-topic equality or Sparkplug-path tail match apply (avoids homonym metrics on other rides).
 *
 * @param {object} signal
 * @param {string|null|undefined} signal.unsTopicPreview
 * @param {string} signal.signalCode
 * @param {string|null|undefined} signal.sparkplugMetricPreview
 * @param {ReadonlyArray<object>} events UNS Live flattened rows (`canonicalUnsTopic`, `metric`, `sparkplugTopic`, `receivedAt`, …)
 * @param {{ rideAssetSlug?: string|null }} [opts]
 * @returns {object[]} Copy of matching events, newest `receivedAt` first
 */
export function collectMatchingLiveEvents(signal, events, opts) {
  const preview = signal.unsTopicPreview != null ? String(signal.unsTopicPreview).trim() : '';
  const code = String(signal.signalCode || '').trim();
  const spark = signal.sparkplugMetricPreview != null ? String(signal.sparkplugMetricPreview).trim() : '';
  const sparkTail = spark ? spark.split('/').pop() || spark : '';
  const slugFilter = opts?.rideAssetSlug != null ? String(opts.rideAssetSlug).trim() : '';

  const candidates = [...events].filter((e) => {
    if (slugFilter && !liveEventMatchesRideAssetSlug(e, slugFilter)) return false;
    const can = e.canonicalUnsTopic != null ? String(e.canonicalUnsTopic).trim() : '';
    const st = e.sparkplugTopic != null ? String(e.sparkplugTopic) : '';
    const m = String(e.metric || '').trim();

    if (preview) {
      if (can && can === preview) return true;
      if (sparkTail && st && st.toLowerCase().includes(sparkTail.toLowerCase())) return true;
      return false;
    }
    if (code && m && m.toLowerCase() === code.toLowerCase()) return true;
    if (sparkTail && st && st.toLowerCase().includes(sparkTail.toLowerCase())) return true;
    return false;
  });
  candidates.sort((a, b) => Date.parse(String(b.receivedAt)) - Date.parse(String(a.receivedAt)));
  return candidates;
}
