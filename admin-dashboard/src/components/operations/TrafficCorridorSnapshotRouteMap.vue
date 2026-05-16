<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { extractTomTomRouteLatLngs } from '@/utils/tomtomRouteGeometry.mjs'

const FALLBACK: L.LatLngExpression = [48.27, 7.76]

const props = defineProps<{
  providerRawResponse: Record<string, unknown> | null
  originLat: number | null | undefined
  originLng: number | null | undefined
  destinationLat: number | null | undefined
  destinationLng: number | null | undefined
  routeDistanceMeters?: number | null
  travelTimeSeconds?: number | null
  trafficDelaySeconds?: number | null
}>()

const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
const routeLine = shallowRef<L.Polyline | null>(null)
const originMarker = shallowRef<L.CircleMarker | null>(null)
const destMarker = shallowRef<L.CircleMarker | null>(null)
const tiles = shallowRef<L.TileLayer | null>(null)

const hasRouteGeometry = computed(() => {
  const n = extractTomTomRouteLatLngs(props.providerRawResponse as unknown).length
  return n >= 2
})

function routeLatLngs(): L.LatLngExpression[] {
  return extractTomTomRouteLatLngs(props.providerRawResponse as unknown) as L.LatLngExpression[]
}

function num(n: unknown): number | null {
  if (n == null) return null
  const x = Number(n)
  return Number.isFinite(x) ? x : null
}

function destroyMap() {
  const m = map.value
  if (m) m.remove()
  map.value = null
  tiles.value = null
  routeLine.value = null
  originMarker.value = null
  destMarker.value = null
}

function ensureLayers() {
  if (!routeLine.value) {
    routeLine.value = L.polyline([], {
      color: '#38bdf8',
      weight: 5,
      opacity: 0.92,
      lineJoin: 'round',
    })
  }
  if (!originMarker.value) {
    originMarker.value = L.circleMarker([48, 7], {
      radius: 8,
      color: '#0369a1',
      weight: 2,
      fillColor: '#0284c7',
      fillOpacity: 0.95,
    })
  }
  if (!destMarker.value) {
    destMarker.value = L.circleMarker([48, 7], {
      radius: 8,
      color: '#c2410c',
      weight: 2,
      fillColor: '#ea580c',
      fillOpacity: 0.95,
    })
  }
  return { line: routeLine.value!, o: originMarker.value!, d: destMarker.value! }
}

function addToMap(m: L.Map, layer: L.Layer) {
  if (!m.hasLayer(layer)) layer.addTo(m)
}

function syncPolylineRoute(
  m: L.Map,
  line: L.Polyline,
  o: L.CircleMarker,
  d: L.CircleMarker,
  ll: L.LatLngExpression[],
) {
  line.setLatLngs(ll)
  addToMap(m, line)
  const start = ll[0]
  const end = ll[ll.length - 1]
  o.setLatLng(start)
  d.setLatLng(end)
  o.setStyle({ opacity: 1, fillOpacity: 0.95 })
  d.setStyle({ opacity: 1, fillOpacity: 0.95 })
  addToMap(m, o)
  addToMap(m, d)
  m.fitBounds(L.latLngBounds(ll).pad(0.1), { maxZoom: 15, animate: false })
}

function syncEndpointsOnly(
  m: L.Map,
  line: L.Polyline,
  o: L.CircleMarker,
  d: L.CircleMarker,
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number,
) {
  if (m.hasLayer(line)) m.removeLayer(line)
  o.setLatLng([oLat, oLng])
  d.setLatLng([dLat, dLng])
  addToMap(m, o)
  addToMap(m, d)
  m.fitBounds(L.latLngBounds([oLat, oLng], [dLat, dLng]).pad(0.12), { maxZoom: 14, animate: false })
}

function clearEndpoints(m: L.Map, o: L.CircleMarker, d: L.CircleMarker) {
  if (m.hasLayer(o)) m.removeLayer(o)
  if (m.hasLayer(d)) m.removeLayer(d)
  m.setView(FALLBACK, 11, { animate: false })
}

function syncMap() {
  const m = map.value
  if (!m) return
  const { line, o, d } = ensureLayers()
  const ll = routeLatLngs()
  const oLat = num(props.originLat)
  const oLng = num(props.originLng)
  const dLat = num(props.destinationLat)
  const dLng = num(props.destinationLng)

  if (ll.length >= 2) {
    syncPolylineRoute(m, line, o, d, ll)
    return
  }
  if (m.hasLayer(line)) m.removeLayer(line)
  const pairOk =
    oLat != null && oLng != null && dLat != null && dLng != null && [oLat, oLng, dLat, dLng].every(Number.isFinite)
  if (pairOk) syncEndpointsOnly(m, line, o, d, oLat!, oLng!, dLat!, dLng!)
  else clearEndpoints(m, o, d)
}

function mountMap() {
  if (!mapEl.value || map.value) return
  const m = L.map(mapEl.value, { zoomControl: true, preferCanvas: true })
  tiles.value = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: 'abc',
  })
  tiles.value.addTo(m)
  map.value = m
  syncMap()
  void nextTick(() => {
    m.invalidateSize()
    requestAnimationFrame(() => m.invalidateSize())
  })
}

function invalidateLater() {
  void nextTick(() => {
    const m = map.value
    if (!m) return
    m.invalidateSize()
    requestAnimationFrame(() => m.invalidateSize())
  })
}

onMounted(() => {
  void nextTick(() => mountMap())
})

onUnmounted(() => {
  destroyMap()
})

watch(
  () => [
    props.providerRawResponse,
    props.originLat,
    props.originLng,
    props.destinationLat,
    props.destinationLng,
  ],
  () => {
    syncMap()
    invalidateLater()
  },
  { deep: true }
)

defineExpose({ invalidateSize: invalidateLater })

const fmtKm = computed(() => {
  const m = num(props.routeDistanceMeters)
  if (m == null) return '—'
  return `${(m / 1000).toFixed(2)} km`
})

const fmtTravelMin = computed(() => {
  const s = num(props.travelTimeSeconds)
  if (s == null) return '—'
  return `${(s / 60).toFixed(1)} min`
})

const fmtDelay = computed(() => {
  const s = num(props.trafficDelaySeconds)
  if (s == null || s <= 0) return '—'
  if (s >= 60) return `${(s / 60).toFixed(1)} min (${Math.round(s)} s)`
  return `${Math.round(s)} s`
})
</script>

<template>
  <div class="space-y-2" data-testid="traffic-corridor-snapshot-route-map">
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
      <span
        >Route distance <span class="font-mono text-slate-100">{{ fmtKm }}</span></span
      >
      <span
        >Travel time <span class="font-mono text-slate-100">{{ fmtTravelMin }}</span></span
      >
      <span
        >Traffic delay <span class="font-mono text-slate-100">{{ fmtDelay }}</span></span
      >
    </div>
    <p v-if="!hasRouteGeometry" class="text-xs text-amber-200/90">No route geometry available</p>
    <div
      ref="mapEl"
      class="h-[min(22rem,45vh)] min-h-[14rem] w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
      role="application"
      aria-label="TomTom route snapshot map"
    />
    <p class="text-[10px] leading-snug text-slate-500">
      Polyline from stored <span class="font-mono text-slate-400">routes[].legs[].points[]</span> (sanitized snapshot).
    </p>
  </div>
</template>
