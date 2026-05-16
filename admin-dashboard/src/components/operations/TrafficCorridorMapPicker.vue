<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const FALLBACK_CENTER: L.LatLngExpression = [48.27, 7.76]

const props = defineProps<{
  originLat: number | null
  originLng: number | null
  destinationLat: number | null
  destinationLng: number | null
  /** Park centroid — used when no endpoints yet */
  centerLat?: number | null
  centerLng?: number | null
}>()

const emit = defineEmits<{
  'update:origin': [payload: { lat: number; lng: number }]
  'update:destination': [payload: { lat: number; lng: number }]
}>()

const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
const tiles = shallowRef<L.TileLayer | null>(null)
const originMarker = shallowRef<L.CircleMarker | null>(null)
const destMarker = shallowRef<L.CircleMarker | null>(null)
const connector = shallowRef<L.Polyline | null>(null)

const pickTarget = ref<'origin' | 'destination'>('origin')

function initialCenterZoom(): { center: L.LatLngExpression; zoom: number } {
  const pairs: L.LatLngExpression[] = []
  if (props.originLat != null && props.originLng != null) pairs.push([props.originLat, props.originLng])
  if (props.destinationLat != null && props.destinationLng != null) pairs.push([props.destinationLat, props.destinationLng])
  if (pairs.length === 2) {
    const b = L.latLngBounds(pairs[0], pairs[1])
    return { center: b.getCenter(), zoom: 11 }
  }
  if (pairs.length === 1) return { center: pairs[0], zoom: 12 }
  if (
    props.centerLat != null &&
    props.centerLng != null &&
    Number.isFinite(props.centerLat) &&
    Number.isFinite(props.centerLng)
  ) {
    return { center: [props.centerLat, props.centerLng], zoom: 11 }
  }
  return { center: FALLBACK_CENTER, zoom: 11 }
}

function ensureLayers() {
  const m = map.value
  if (!m) return

  if (!originMarker.value) {
    originMarker.value = L.circleMarker([48, 7], {
      radius: 9,
      color: '#0369a1',
      weight: 2,
      fillColor: '#0284c7',
      fillOpacity: 0.9,
    })
  }
  if (!destMarker.value) {
    destMarker.value = L.circleMarker([48, 7], {
      radius: 9,
      color: '#c2410c',
      weight: 2,
      fillColor: '#ea580c',
      fillOpacity: 0.9,
    })
  }
  if (!connector.value) {
    connector.value = L.polyline([], { color: '#475569', weight: 3, dashArray: '8 6', opacity: 0.95 })
  }
}

function applyEndpointMarker(
  m: L.Map,
  marker: L.CircleMarker,
  ok: boolean,
  lat: number | null,
  lng: number | null
) {
  if (ok && lat != null && lng != null) {
    marker.setLatLng([lat, lng])
    marker.setStyle({ opacity: 1, fillOpacity: 0.9 })
    if (!m.hasLayer(marker)) marker.addTo(m)
  } else if (m.hasLayer(marker)) {
    m.removeLayer(marker)
  }
}

function syncFromProps() {
  const m = map.value
  if (!m) return
  ensureLayers()

  const oOk = props.originLat != null && props.originLng != null
  const dOk = props.destinationLat != null && props.destinationLng != null

  applyEndpointMarker(m, originMarker.value!, oOk, props.originLat, props.originLng)
  applyEndpointMarker(m, destMarker.value!, dOk, props.destinationLat, props.destinationLng)

  const ln = connector.value!
  if (oOk && dOk && props.originLat != null && props.originLng != null) {
    ln.setLatLngs([
      [props.originLat, props.originLng],
      [props.destinationLat!, props.destinationLng!],
    ])
    ln.setStyle({ opacity: 0.9 })
    if (!m.hasLayer(ln)) ln.addTo(m)
  } else if (m.hasLayer(ln)) {
    m.removeLayer(ln)
  }
}

function onMapClick(e: L.LeafletMouseEvent) {
  const { lat, lng } = e.latlng
  const latR = Math.round(lat * 1e6) / 1e6
  const lngR = Math.round(lng * 1e6) / 1e6
  if (pickTarget.value === 'origin') emit('update:origin', { lat: latR, lng: lngR })
  else emit('update:destination', { lat: latR, lng: lngR })
}

function mountMap() {
  if (!mapEl.value || map.value) return
  const { center, zoom } = initialCenterZoom()
  const m = L.map(mapEl.value, {
    zoomControl: true,
    preferCanvas: true,
  }).setView(center, zoom)

  tiles.value = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: 'abc',
  })
  tiles.value.addTo(m)
  m.on('click', onMapClick)
  map.value = m
  syncFromProps()
  void nextTick(() => {
    m.invalidateSize()
    requestAnimationFrame(() => m.invalidateSize())
  })
}

function destroyMap() {
  const m = map.value
  if (m) {
    m.off('click', onMapClick)
    m.remove()
  }
  map.value = null
  tiles.value = null
  originMarker.value = null
  destMarker.value = null
  connector.value = null
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
  () =>
    [props.originLat, props.originLng, props.destinationLat, props.destinationLng, props.centerLat, props.centerLng],
  () => {
    syncFromProps()
    const m = map.value
    if (!m) return
    const oOk = props.originLat != null && props.originLng != null
    const dOk = props.destinationLat != null && props.destinationLng != null
    if (oOk && dOk) {
      const b = L.latLngBounds(
        [props.originLat!, props.originLng!],
        [props.destinationLat!, props.destinationLng!]
      )
      m.fitBounds(b.pad(0.12), { maxZoom: 13, animate: false })
    }
    invalidateLater()
  }
)

defineExpose({
  /** Call when the parent dialog finished opening (size was 0 during mount). */
  invalidateSize: invalidateLater,
})
</script>

<template>
  <div class="traffic-corridor-map-picker space-y-2" data-testid="traffic-corridor-map-picker">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-slate-500">Click map to set</span>
      <div class="inline-flex rounded-lg border border-slate-700 p-0.5 text-xs">
        <button
          type="button"
          class="rounded-md px-2 py-1 font-medium transition"
          :class="pickTarget === 'origin' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'"
          @click="pickTarget = 'origin'"
        >
          Origin
        </button>
        <button
          type="button"
          class="rounded-md px-2 py-1 font-medium transition"
          :class="pickTarget === 'destination' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'"
          @click="pickTarget = 'destination'"
        >
          Destination
        </button>
      </div>
    </div>
    <div
      ref="mapEl"
      class="h-[min(32rem,55vh)] min-h-[18rem] w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950 sm:h-[min(36rem,58vh)]"
      role="application"
      aria-label="Map to pick corridor origin and destination"
    />
    <p class="text-[11px] leading-snug text-slate-500">
      Coordinates are optional metadata. You can still type lat/lng above or clear them in the inputs after picking.
    </p>
  </div>
</template>
