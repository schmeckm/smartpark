<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type WaitHeatLeafletLayer = L.Layer & {
  setLatLngs(latlngs: [number, number, number][]): WaitHeatLeafletLayer
  setOptions(opts: {
    minOpacity?: number
    max?: number
    radius?: number
    blur?: number
    maxZoom?: number
  }): WaitHeatLeafletLayer
}
import { getGeoPressureLive, getPlatformAssets, getPlatformParks } from '@/api/client'
import type { GeoPressureCell, GeoPressurePayload, PlatformAsset, PlatformPark } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { waitMinutesFromAssetSnapshot } from '@/utils/assetWaitSnapshot'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { useAuthStore } from '@/stores/auth'
import type { ParkMapFreqBand } from '@/utils/parkMapFreqThresholds'
import { parkMapFreqBandFromPph, resolveParkMapFreqThresholds } from '@/utils/parkMapFreqThresholds'

const { push } = useToast()
const route = useRoute()
const auth = useAuthStore()
const parks = ref<PlatformPark[]>([])
const parkId = ref('')
const assets = ref<PlatformAsset[]>([])
const mapEl = ref<HTMLElement | null>(null)
const mapWrapRef = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
const layer = shallowRef<L.LayerGroup | null>(null)
const heatLayer = shallowRef<L.LayerGroup | null>(null)
const hotspotLayer = shallowRef<L.LayerGroup | null>(null)
const markerByAssetId = shallowRef<Map<string, L.Marker>>(new Map())
/** Gold halo above wait-heat canvas so sidebar selection stays visible (markers sit under pane 610). */
const selectionHaloGroup = shallowRef<L.LayerGroup | null>(null)
let baseRasterTiles: L.TileLayer | null = null
/** Canvas heatmap (leaflet.heat); added under geo-pressure circles. */
const waitHeatLeaflet = shallowRef<WaitHeatLeafletLayer | null>(null)

const showPressureHeat = ref(false)
/** Kernel heatmap from ride coordinates + wait snapshot (overlapping glow ≈ busy area). */
const showWaitHeatmap = ref(false)
const pressureCells = shallowRef<GeoPressureCell[]>([])
type GeoPressureHotspot = GeoPressurePayload['hotspots'][number]
const pressureHotspots = shallowRef<GeoPressureHotspot[]>([])
const pressureLoading = ref(false)
const pressureInsights = ref<string[]>([])
const viewportBounds = shallowRef<L.LatLngBounds | null>(null)
const selectedAssetId = ref<string>('')

/** '' = all */
const filterTypeCode = ref<string>('')
/** '' = all */
const filterStatus = ref<string>('')
/** '' = all — visitor-frequency band from ride theoretical capacity (rides); other types → UNKNOWN */
const filterFreq = ref<string>('')

function parkIdFromRouteQuery(): string {
  const v = route.query.parkId
  return Array.isArray(v) ? String(v[0] || '').trim() : String(v || '').trim()
}

function assetIdFromRouteQuery(): string {
  const v = route.query.assetId
  return Array.isArray(v) ? String(v[0] || '').trim() : String(v || '').trim()
}

function truthyQuery(key: string): boolean {
  const v = route.query[key]
  const s = (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

/** Deep-link from Add-on Board / ops links: `?pressure=1` turns on geo-pressure overlay. */
function applyPressureQueryToToggles() {
  if (truthyQuery('pressure') || truthyQuery('geoPressure')) showPressureHeat.value = true
  if (truthyQuery('waitHeat')) showWaitHeatmap.value = true
}

function applyAssetIdFromRouteAfterAssetsLoaded() {
  const aid = assetIdFromRouteQuery()
  if (!aid) return
  if (assets.value.some((a) => assetId(a) === aid)) selectedAssetId.value = aid
}

function assetTypeCode(a: PlatformAsset): string {
  const at = a.assetType as { code?: string } | undefined
  return String(at?.code || '').toUpperCase()
}

function assetStatus(a: PlatformAsset): string {
  return String(a.status ?? 'UNKNOWN').toUpperCase()
}

function assetId(a: PlatformAsset): string {
  return String(a.id ?? '')
}

function assetLabel(a: PlatformAsset): string {
  const name = a.name != null ? String(a.name).trim() : ''
  if (name) return name
  const slug = a.slug != null ? String(a.slug).trim() : ''
  if (slug) return slug
  return assetId(a) || '—'
}

function withCoords(a: PlatformAsset) {
  const lat = a.latitude as number | undefined
  const lng = a.longitude as number | undefined
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
}

/** Optional standby wait (minutes) from last synced ThemeParks entity snapshot */
function assetWaitMinutes(a: PlatformAsset): number | null {
  return waitMinutesFromAssetSnapshot(a)
}

/** Theoretical guests/hour from ride master (rides); used as a proxy for typical visitor frequency. */
function assetTheoreticalPph(a: PlatformAsset): number | null {
  if (assetTypeCode(a) !== 'RIDE') return null
  const rm = a.rideMaster as Record<string, unknown> | undefined
  if (!rm || typeof rm !== 'object') return null
  const pick = (k: string) => {
    const v = rm[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
    }
    return null
  }
  return pick('theoreticalCapacityPph') ?? pick('capacityPph')
}

const parkFreqThresholds = computed(() => resolveParkMapFreqThresholds(auth.user))

function assetFreqBand(a: PlatformAsset): ParkMapFreqBand {
  const pph = assetTheoreticalPph(a)
  return parkMapFreqBandFromPph(pph, assetTypeCode(a) === 'RIDE', parkFreqThresholds.value)
}

const FREQ_CHIPS: { code: string; label: string }[] = [
  { code: '', label: 'Alle' },
  { code: 'VERY_HIGH', label: 'Sehr hoch' },
  { code: 'MEDIUM', label: 'Mittel' },
  { code: 'LOW', label: 'Niedrig' },
  { code: 'WEAK', label: 'Schwach' },
  { code: 'UNKNOWN', label: 'Keine Daten' },
]

type WaitBand = 'short' | 'medium' | 'long' | 'verylong'

function waitBand(min: number): WaitBand {
  if (min <= 15) return 'short'
  if (min <= 45) return 'medium'
  if (min <= 75) return 'long'
  return 'verylong'
}

/** Intensity 0–1 for leaflet.heat (third coordinate); OPEN rides without wait stay visibly low. */
function waitHeatIntensity(wait: number | null, status: string): number {
  const st = status.toUpperCase()
  if (st !== 'OPEN') return 0.05
  if (wait == null || !Number.isFinite(wait)) return 0.18
  const w = Math.max(0, Math.min(150, wait))
  return 0.2 + (w / 150) ** 0.88 * 0.78
}

const showAnyHeatOverlay = computed(() => showPressureHeat.value || showWaitHeatmap.value)

const heatBadgeTitle = computed(() => {
  if (showPressureHeat.value && showWaitHeatmap.value) {
    return 'Geo-Druck ca. alle 55 s; Wartezeit aus ThemeParks-Snapshot'
  }
  if (showPressureHeat.value) return 'Geo-Druck ca. alle 55 s'
  return 'Wartezeit aus ThemeParks-Snapshot (kein Live-Poll)'
})

const WAIT_LEGEND: { band: WaitBand; label: string; fill: string; stroke: string }[] = [
  { band: 'short', label: 'Short wait', fill: '#22c55e', stroke: '#14532d' },
  { band: 'medium', label: 'Medium wait', fill: '#3b82f6', stroke: '#1e3a8a' },
  { band: 'long', label: 'Long wait', fill: '#a855f7', stroke: '#581c87' },
  { band: 'verylong', label: 'Very long', fill: '#ef4444', stroke: '#7f1d1d' },
]

function statusMarkerColors(st: string): { fill: string; stroke: string } {
  const s = st.toUpperCase()
  if (s === 'OPEN') return { fill: '#22c55e', stroke: '#166534' }
  if (s === 'CLOSED' || s === 'CLOSED_FOR_SEASON') return { fill: '#64748b', stroke: '#334155' }
  if (s === 'INACTIVE' || s === 'UNKNOWN') return { fill: '#475569', stroke: '#1e293b' }
  if (s === 'DOWN' || s === 'MAINTENANCE' || s === 'REFURBISHMENT') return { fill: '#f97316', stroke: '#9a3412' }
  return { fill: '#94a3b8', stroke: '#475569' }
}

function markerPalette(a: PlatformAsset): { fill: string; stroke: string } {
  const wait = assetWaitMinutes(a)
  const code = assetTypeCode(a)
  if (wait != null && code === 'RIDE') {
    const b = waitBand(wait)
    const row = WAIT_LEGEND.find((x) => x.band === b)!
    return { fill: row.fill, stroke: row.stroke }
  }
  return statusMarkerColors(assetStatus(a))
}

function typeGlyph(code: string): string {
  switch (code) {
    case 'RIDE':
      return '🎢'
    case 'SHOW':
      return '🎭'
    case 'RESTAURANT':
      return '🍴'
    case 'SHOP':
      return '🛍'
    case 'ZONE':
      return '◎'
    default:
      return '·'
  }
}

const TYPE_CHIPS: { code: string; label: string }[] = [
  { code: '', label: 'All' },
  { code: 'RIDE', label: 'Attractions' },
  { code: 'SHOW', label: 'Shows' },
  { code: 'RESTAURANT', label: 'Dining' },
  { code: 'SHOP', label: 'Shops' },
]

const typeCounts = computed(() => {
  const o: Record<string, number> = { RIDE: 0, SHOW: 0, RESTAURANT: 0, SHOP: 0, OTHER: 0 }
  for (const a of assets.value) {
    const c = assetTypeCode(a)
    if (c in o) o[c]++
    else o.OTHER++
  }
  return o
})

const statusOrder = ['OPEN', 'CLOSED', 'DOWN', 'INACTIVE', 'UNKNOWN', 'MAINTENANCE', 'REFURBISHMENT']

const statusCounts = computed(() => {
  const o: Record<string, number> = {}
  for (const a of assets.value) {
    const s = assetStatus(a)
    o[s] = (o[s] || 0) + 1
  }
  return o
})

const statusChips = computed(() => {
  const keys = Object.keys(statusCounts.value).sort((a, b) => {
    const ia = statusOrder.indexOf(a)
    const ib = statusOrder.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return keys
})

const filteredAssets = computed(() => {
  return assets.value.filter((a) => {
    if (filterTypeCode.value && assetTypeCode(a) !== filterTypeCode.value) return false
    if (filterStatus.value && assetStatus(a) !== filterStatus.value) return false
    if (filterFreq.value && assetFreqBand(a) !== filterFreq.value) return false
    return true
  })
})

const freqCounts = computed(() => {
  const o: Record<ParkMapFreqBand, number> = { VERY_HIGH: 0, MEDIUM: 0, LOW: 0, WEAK: 0, UNKNOWN: 0 }
  for (const a of assets.value) {
    if (filterTypeCode.value && assetTypeCode(a) !== filterTypeCode.value) continue
    if (filterStatus.value && assetStatus(a) !== filterStatus.value) continue
    o[assetFreqBand(a)]++
  }
  return o
})

function freqChipCount(code: string): number {
  if (!code) {
    let n = 0
    for (const a of assets.value) {
      if (filterTypeCode.value && assetTypeCode(a) !== filterTypeCode.value) continue
      if (filterStatus.value && assetStatus(a) !== filterStatus.value) continue
      n++
    }
    return n
  }
  return freqCounts.value[code as ParkMapFreqBand] ?? 0
}

/** Right-hand list: coordinates inside current map bounds; entries without coordinates listed below. */
const assetsForSidebar = computed(() => {
  const filtered = filteredAssets.value
  const b = viewportBounds.value
  const inView: PlatformAsset[] = []
  const noCoords: PlatformAsset[] = []
  for (const a of filtered) {
    if (!withCoords(a)) {
      noCoords.push(a)
      continue
    }
    const la = a.latitude as number
    const ln = a.longitude as number
    if (!b || b.contains(L.latLng(la, ln))) inView.push(a)
  }
  const byLabel = (x: PlatformAsset, y: PlatformAsset) =>
    assetLabel(x).localeCompare(assetLabel(y), undefined, { sensitivity: 'base' })
  inView.sort(byLabel)
  noCoords.sort(byLabel)
  return { inView, noCoords }
})

const withCoordsCount = computed(() => filteredAssets.value.filter(withCoords).length)

const ridesWithWaitSample = computed(() => assets.value.some((a) => assetTypeCode(a) === 'RIDE' && assetWaitMinutes(a) != null))

const WAIT_HEAT_PANE = 'spWaitHeatPane'

function ensureWaitHeatPane(mapInst: L.Map): HTMLElement {
  let el = mapInst.getPane(WAIT_HEAT_PANE)
  if (!el) {
    mapInst.createPane(WAIT_HEAT_PANE)
    el = mapInst.getPane(WAIT_HEAT_PANE)!
    el.style.zIndex = '610'
    el.style.pointerEvents = 'none'
  }
  return el
}

/** leaflet.heat attaches to overlayPane; move canvas above markerPane so heat isn’t hidden under pins. */
function mountWaitHeatCanvasAboveMarkers() {
  const mapInst = map.value
  const heat = waitHeatLeaflet.value as unknown as { _canvas?: HTMLCanvasElement } | null
  if (!mapInst || !heat?._canvas) return
  const pane = ensureWaitHeatPane(mapInst)
  const c = heat._canvas
  if (c.parentElement !== pane) pane.appendChild(c)
}

/**
 * leaflet.heat `onRemove` always does `overlayPane.removeChild(this._canvas)`.
 * After `mountWaitHeatCanvasAboveMarkers` the canvas lives in `WAIT_HEAT_PANE` — restore before `map.remove()`.
 */
function restoreWaitHeatCanvasToOverlayPane() {
  const mapInst = map.value
  const heat = waitHeatLeaflet.value as unknown as { _canvas?: HTMLCanvasElement } | null
  if (!mapInst || !heat?._canvas) return
  const overlay = mapInst.getPanes()?.overlayPane
  if (!overlay) return
  const c = heat._canvas
  if (!c.parentNode || c.parentElement === overlay) return
  try {
    overlay.appendChild(c)
  } catch {
    /* detached */
  }
}

const SELECTION_HILITE_PANE = 'spAssetSelectionHilite'

function ensureSelectionHilitePane(mapInst: L.Map): void {
  if (mapInst.getPane(SELECTION_HILITE_PANE)) return
  mapInst.createPane(SELECTION_HILITE_PANE)
  const el = mapInst.getPane(SELECTION_HILITE_PANE)!
  el.style.zIndex = '620'
  el.style.pointerEvents = 'none'
}

/** Visible ring above heat layer; markers alone are hidden under the heat canvas (z-index 610). */
function syncSelectionHalo() {
  const g = selectionHaloGroup.value
  const mapInst = map.value
  if (!g || !mapInst) return
  g.clearLayers()
  const id = selectedAssetId.value
  if (!id) return
  const a = findAssetById(id)
  if (!a || !withCoords(a)) return
  ensureSelectionHilitePane(mapInst)
  const lat = a.latitude as number
  const lng = a.longitude as number
  const ll = L.latLng(lat, lng)
  const haloOpts: L.CircleMarkerOptions = {
    pane: SELECTION_HILITE_PANE,
    stroke: true,
    color: '#fbbf24',
    interactive: false,
  }
  L.circleMarker(ll, { ...haloOpts, radius: 22, weight: 3, fillColor: '#fbbf24', fillOpacity: 0.1 }).addTo(g)
  L.circleMarker(ll, { ...haloOpts, radius: 7, weight: 2, fillColor: '#fef08a', fillOpacity: 0.4 }).addTo(g)
  const b = mapInst.getBounds().pad(0.08)
  if (!b.contains(ll)) mapInst.panTo(ll)
}

function cellHeatStyle(status: string): { fill: string; stroke: string } {
  const s = String(status || '').toUpperCase()
  if (s === 'GREEN') return { fill: '#22c55e', stroke: '#14532d' }
  if (s === 'YELLOW') return { fill: '#eab308', stroke: '#713f12' }
  if (s === 'RED') return { fill: '#f97316', stroke: '#9a3412' }
  return { fill: '#b91c1c', stroke: '#450a0a' }
}

function renderPressureHeat() {
  if (!map.value || !heatLayer.value) return
  heatLayer.value.clearLayers()
  if (!showPressureHeat.value || !pressureCells.value.length) return
  for (const c of pressureCells.value) {
    const { fill, stroke } = cellHeatStyle(c.status)
    const r = 8 + Math.round((c.pressureScore / 100) * 14)
    const lines = [
      `<div style="font-weight:600">Pressure ${c.pressureScore}</div>`,
      `<div style="font-size:11px;color:#94a3b8">${escapeHtml(c.status)}</div>`,
    ]
    if (c.topContributors?.length) {
      lines.push('<div style="font-size:10px;color:#cbd5e1;margin-top:4px">Top contributors</div>')
      for (const t of c.topContributors.slice(0, 3)) {
        lines.push(
          `<div style="font-size:10px;color:#e2e8f0">· ${escapeHtml(t.name)} <span style="color:#94a3b8">(${Math.round(t.contribution)})</span></div>`
        )
      }
    }
    L.circleMarker([c.lat, c.lng], {
      radius: r,
      stroke: true,
      color: stroke,
      weight: 1,
      fillColor: fill,
      fillOpacity: showWaitHeatmap.value ? 0.14 : 0.28,
    })
      .bindTooltip(lines.join(''), { direction: 'top', opacity: 0.95 })
      .addTo(heatLayer.value)
  }
}

let hotspotWaveCircles: L.Circle[] = []
const hotspotWaveMeta = new WeakMap<
  L.Circle,
  { baseR: number; phase: number; kind: 'outer' | 'inner'; baseFillOp: number }
>()
let hotspotWaveRaf = 0
let hotspotWaveT0 = 0
let pressureHeatPollTimer: ReturnType<typeof setInterval> | null = null

function wavePhaseFromId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ((h % 1000) / 1000) * Math.PI * 2
}

/** Effective wait (min): snapshot wait when present, else proxy from pressure score for radius scaling. */
function effectiveHotspotWaitMinutes(h: GeoPressureHotspot): number {
  const w = h.waitMinutes
  if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) return Number(w)
  const ps = Number(h.pressureScore)
  if (Number.isFinite(ps) && ps > 0) return Math.max(3, Math.min(120, ps * 0.9))
  return 8
}

/** Radius in metres: area scales ~like wait — r ∝ √w (clamped for map readability). */
function hotspotRadiusMeters(waitEff: number): number {
  const minR = 72
  const maxR = 540
  const scale = 52
  const r = Math.sqrt(waitEff * scale)
  return Math.round(Math.min(maxR, Math.max(minR, r)))
}

function stopHotspotWaveAnimation() {
  if (hotspotWaveRaf) cancelAnimationFrame(hotspotWaveRaf)
  hotspotWaveRaf = 0
}

function tickHotspotWaves(ts: number) {
  if (!showPressureHeat.value || !map.value) {
    stopHotspotWaveAnimation()
    return
  }
  const t = (ts - hotspotWaveT0) / 1000
  for (const circle of hotspotWaveCircles) {
    const meta = hotspotWaveMeta.get(circle)
    if (!meta) continue
    const isInner = meta.kind === 'inner'
    const freq = isInner ? 1.38 : 1.06
    const breathe = 0.84 + 0.16 * Math.sin(t * freq + meta.phase)
    circle.setRadius(meta.baseR * breathe)
    const opAmp = isInner ? 0.14 : 0.1
    const fillOp = Math.min(0.42, meta.baseFillOp + opAmp * Math.sin(t * 0.88 + meta.phase * 1.25))
    circle.setStyle({ fillOpacity: fillOp, opacity: 0.5 + 0.38 * breathe })
  }
  hotspotWaveRaf = requestAnimationFrame(tickHotspotWaves)
}

function startHotspotWaveAnimation() {
  stopHotspotWaveAnimation()
  if (!hotspotWaveCircles.length) return
  hotspotWaveT0 = performance.now()
  hotspotWaveRaf = requestAnimationFrame(tickHotspotWaves)
}

function renderHotspotLayer() {
  stopHotspotWaveAnimation()
  hotspotWaveCircles = []
  if (!map.value || !hotspotLayer.value) return
  hotspotLayer.value.clearLayers()
  if (!showPressureHeat.value) return

  for (const h of pressureHotspots.value) {
    const la = h.lat
    const ln = h.lng
    if (la == null || ln == null || !Number.isFinite(la) || !Number.isFinite(ln)) continue
    const wEff = effectiveHotspotWaitMinutes(h)
    const baseR = hotspotRadiusMeters(wEff)
    const { fill, stroke } = cellHeatStyle(h.status)
    const phase = wavePhaseFromId(h.assetId || h.slug || h.name || 'x')
    const tipLines = [
      `<div style="font-weight:600">${escapeHtml(h.name || h.slug || 'Hotspot')}</div>`,
      `<div style="font-size:11px;color:#94a3b8">${escapeHtml(h.entityType || '—')} · ${escapeHtml(h.status)} · score ${Math.round(h.pressureScore)}</div>`,
    ]
    if (h.waitMinutes != null && Number.isFinite(Number(h.waitMinutes)))
      tipLines.push(`<div style="font-size:11px;color:#e2e8f0;margin-top:4px">Wait ~${escapeHtml(String(h.waitMinutes))} min</div>`)
    else tipLines.push(`<div style="font-size:10px;color:#64748b;margin-top:4px">Wait n/a — radius from pressure proxy</div>`)

    const outer = L.circle([la, ln], {
      radius: baseR,
      stroke: true,
      color: stroke,
      weight: 1,
      fillColor: fill,
      fillOpacity: 0.16,
      opacity: 0.78,
    })
      .bindTooltip(tipLines.join(''), { direction: 'top', opacity: 0.95 })
      .addTo(hotspotLayer.value)
    hotspotWaveMeta.set(outer, { baseR, phase, kind: 'outer', baseFillOp: 0.14 })
    hotspotWaveCircles.push(outer)

    const innerR = Math.max(28, Math.round(baseR * 0.4))
    const inner = L.circle([la, ln], {
      radius: innerR,
      stroke: true,
      color: stroke,
      weight: 1,
      fillColor: fill,
      fillOpacity: 0.28,
      opacity: 0.82,
    })
      .addTo(hotspotLayer.value)
    hotspotWaveMeta.set(inner, {
      baseR: innerR,
      phase: phase + 1.1,
      kind: 'inner',
      baseFillOp: 0.22,
    })
    hotspotWaveCircles.push(inner)
  }

  if (hotspotWaveCircles.length) startHotspotWaveAnimation()
}

function refreshPressureLayers() {
  renderPressureHeat()
  renderHotspotLayer()
}

function stopPressureHeatPoll() {
  if (pressureHeatPollTimer != null) {
    clearInterval(pressureHeatPollTimer)
    pressureHeatPollTimer = null
  }
}

function startPressureHeatPoll() {
  stopPressureHeatPoll()
  pressureHeatPollTimer = setInterval(() => {
    if (showPressureHeat.value && parkId.value) void loadPressureHeat()
  }, 55_000)
}

async function loadPressureHeat() {
  if (!showPressureHeat.value || !parkId.value) return
  pressureLoading.value = true
  try {
    setApiParkContextId(parkId.value)
    const atc = filterTypeCode.value || undefined
    const data = await getGeoPressureLive(parkId.value, { assetTypeCode: atc })
    pressureCells.value = data.cells || []
    pressureHotspots.value = Array.isArray(data.hotspots) ? data.hotspots : []
    pressureInsights.value = Array.isArray(data.insights) ? data.insights : []
    refreshPressureLayers()
  } catch (e) {
    pressureCells.value = []
    pressureHotspots.value = []
    pressureInsights.value = []
    push(e instanceof Error ? e.message : 'Pressure layer failed', 'error')
    refreshPressureLayers()
  } finally {
    pressureLoading.value = false
  }
}

const googleMapsHref = computed(() => {
  const pts = filteredAssets.value.filter(withCoords) as Array<PlatformAsset & { latitude: number; longitude: number }>
  if (!pts.length) return 'https://www.google.com/maps'
  let s = 0
  let t = 0
  for (const p of pts) {
    s += p.latitude
    t += p.longitude
  }
  const lat = s / pts.length
  const lng = t / pts.length
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
})

function typeChipCount(code: string): number {
  if (!code) return assets.value.length
  return typeCounts.value[code] ?? 0
}

function formatChipCount(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/** Pixel radius/blur grow with zoom so merged heat stays visible when zoomed in (fixed px radius shrinks in “ground space”). */
function waitHeatPaintOpts(zoom: number): { radius: number; blur: number; minOpacity: number } {
  const t = Math.max(0, zoom - 11)
  const factor = 1 + t * 0.2
  return {
    radius: Math.min(96, Math.round(40 * factor)),
    blur: Math.min(68, Math.round(26 * factor)),
    minOpacity: 0.13 + Math.min(0.1, t * 0.015),
  }
}

function refreshWaitHeatmap() {
  const h = waitHeatLeaflet.value
  if (!h) return
  if (!showWaitHeatmap.value) {
    h.setLatLngs([])
    h.setOptions({ minOpacity: 0 })
    return
  }
  const pts: [number, number, number][] = []
  for (const a of filteredAssets.value) {
    if (assetTypeCode(a) !== 'RIDE' || !withCoords(a)) continue
    const lat = a.latitude as number
    const lng = a.longitude as number
    pts.push([lat, lng, waitHeatIntensity(assetWaitMinutes(a), assetStatus(a))])
  }
  const z = map.value?.getZoom() ?? 14
  const paint = waitHeatPaintOpts(z)
  h.setLatLngs(pts)
  // maxZoom: low value → plugin keeps intensity factor v≈1 at all normal zooms (see leaflet.heat _redraw: v = 2^-(max(0, maxZoom - zoom))).
  h.setOptions({ minOpacity: pts.length ? paint.minOpacity : 0, max: 1.05, radius: paint.radius, blur: paint.blur, maxZoom: 2 })
  mountWaitHeatCanvasAboveMarkers()
}

async function load() {
  try {
    clearMapSelection()
    parks.value = await getPlatformParks()
    const q = parkIdFromRouteQuery()
    if (q && parks.value.some((p) => p.id === q)) {
      parkId.value = q
    } else if (!parkId.value && parks.value.length) {
      parkId.value = parks.value[0].id
    }
    if (!parkId.value) return
    setApiParkContextId(parkId.value)
    assets.value = await getPlatformAssets({ parkId: parkId.value, limit: 800 })
    applyAssetIdFromRouteAfterAssetsLoaded()
    renderMarkers({ fitToMarkers: true })
    if (showPressureHeat.value) void loadPressureHeat()
    refreshWaitHeatmap()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

function buildDivIcon(a: PlatformAsset, selected = false): L.DivIcon {
  const base = markerPalette(a)
  const { fill, stroke } = selected ? { fill: '#fbbf24', stroke: '#b45309' } : base
  const code = assetTypeCode(a)
  const wait = assetWaitMinutes(a)
  const compact = showWaitHeatmap.value && !selected
  const inner =
    wait != null && code === 'RIDE'
      ? `<span style="font-size:${compact ? '9px' : '11px'};font-weight:800;color:#fff;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.6)">${wait > 99 ? '99+' : wait}</span>`
      : `<span style="font-size:${compact ? '12px' : '14px'};line-height:1">${typeGlyph(code)}</span>`
  const sel = selected ? ' asset-map-pin--selected' : ''
  const comp = compact ? ' asset-map-pin--compact' : ''
  const html = `<div class="asset-map-pin${sel}${comp}" style="--pin-fill:${fill};--pin-stroke:${stroke}">${inner}</div>`
  const sz = compact ? 24 : 36
  const half = sz / 2
  return L.divIcon({
    className: 'asset-map-divicon-root',
    html,
    iconSize: [sz, sz],
    iconAnchor: [half, half],
    popupAnchor: [0, Math.round(-12 - (compact ? 2 : 4))],
  })
}

function buildPopupHtml(a: PlatformAsset): string {
  const label = assetLabel(a)
  const st = assetStatus(a)
  const typeC = assetTypeCode(a)
  const wait = assetWaitMinutes(a)
  const lines = [
    `<div style="font-weight:600">${escapeHtml(label)}</div>`,
    `<div style="font-size:11px;color:#94a3b8;margin-top:4px">${escapeHtml(typeC || '—')} · ${escapeHtml(st)}</div>`,
  ]
  if (typeC === 'RIDE') {
    if (wait != null) {
      lines.push(
        `<div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-top:8px">Wartezeit: ${escapeHtml(String(wait))} min</div>`,
        `<div style="font-size:10px;color:#64748b;margin-top:2px">Stand (ThemeParks-Snapshot, STANDBY)</div>`
      )
    } else {
      lines.push(
        `<div style="font-size:12px;color:#94a3b8;margin-top:8px">Keine Wartezeit im letzten Snapshot</div>`,
        `<div style="font-size:10px;color:#64748b;margin-top:2px">queue.STANDBY.waitTime nicht gesetzt oder veraltet</div>`
      )
    }
  } else if (wait != null) {
    lines.push(`<div style="font-size:11px;color:#cbd5e1;margin-top:6px">Wait (snapshot): ${escapeHtml(String(wait))} min</div>`)
  }
  const pph = assetTheoreticalPph(a)
  if (pph != null) {
    lines.push(
      `<div style="font-size:10px;color:#64748b;margin-top:6px">Theoretisch ca. ${escapeHtml(String(Math.round(pph)))} Gäste/h</div>`
    )
  }
  return lines.join('')
}

function renderMarkers(opts?: { fitToMarkers?: boolean }) {
  if (!map.value || !layer.value) return
  layer.value.clearLayers()
  markerByAssetId.value = new Map()
  const pts = filteredAssets.value.filter(withCoords) as Array<PlatformAsset & { latitude: number; longitude: number }>
  const fit = Boolean(opts?.fitToMarkers)
  for (const a of pts) {
    const id = assetId(a)
    const selected = Boolean(id && id === selectedAssetId.value)
    const m = L.marker([a.latitude, a.longitude], { icon: buildDivIcon(a, selected) })
      .bindPopup(buildPopupHtml(a), { maxWidth: 280, closeButton: true, autoPan: true })
      .addTo(layer.value)
    if (id) {
      markerByAssetId.value.set(id, m)
      m.on('click', (ev: L.LeafletMouseEvent) => {
        if (ev.originalEvent) L.DomEvent.stopPropagation(ev.originalEvent)
        selectedAssetId.value = id
      })
    }
  }
  if (fit && pts.length === 1) {
    map.value.setView([pts[0].latitude, pts[0].longitude], 15)
  } else   if (fit && pts.length > 1) {
    const b = L.latLngBounds(pts.map((p) => [p.latitude, p.longitude] as L.LatLngTuple))
    map.value.fitBounds(b.pad(0.15))
  }
  syncSelectionHalo()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function findAssetById(id: string): PlatformAsset | undefined {
  return assets.value.find((x) => assetId(x) === id)
}

function refreshMarkerIcon(id: string) {
  const m = markerByAssetId.value.get(id)
  const a = findAssetById(id)
  if (!m || !a || !withCoords(a)) return
  const sel = id === selectedAssetId.value
  m.setIcon(buildDivIcon(a, sel))
}

function clearMapSelection() {
  selectedAssetId.value = ''
  map.value?.closePopup()
}

/** List / sidebar: only highlight marker (colour), no pan/zoom/popup. Same row again → deselect. */
function selectAssetFromSidebar(a: PlatformAsset) {
  const id = assetId(a)
  if (!id) return
  if (selectedAssetId.value === id) {
    clearMapSelection()
    return
  }
  selectedAssetId.value = id
  map.value?.closePopup()
}

function resetAllFilters() {
  filterTypeCode.value = ''
  filterStatus.value = ''
  filterFreq.value = ''
}

const hasActiveFilters = computed(() => {
  return Boolean(filterTypeCode.value || filterStatus.value || filterFreq.value)
})

function refreshViewportBounds() {
  if (!map.value) return
  viewportBounds.value = map.value.getBounds()
}

const sidebarOutsideHint = computed(() => {
  const b = viewportBounds.value
  if (!b) return false
  for (const a of filteredAssets.value) {
    if (!withCoords(a)) continue
    const la = a.latitude as number
    const ln = a.longitude as number
    if (!b.contains(L.latLng(la, ln))) return true
  }
  return false
})

function toggleFullscreen() {
  const el = mapWrapRef.value
  if (!el) return
  if (!document.fullscreenElement) {
    void el.requestFullscreen().catch(() => push('Fullscreen not available', 'error'))
  } else {
    void document.exitFullscreen()
  }
}

/** Dark basemap when pressure overlay is on — closer to a “live heatmap” look; standard OSM otherwise. */
function setBaseMapTiles() {
  if (!map.value) return
  if (baseRasterTiles) {
    map.value.removeLayer(baseRasterTiles)
    baseRasterTiles = null
  }
  if (showAnyHeatOverlay.value) {
    baseRasterTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
    })
  } else {
    baseRasterTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
      subdomains: 'abc',
    })
  }
  baseRasterTiles.addTo(map.value)
}

watch(parkId, () => void load())

watch(
  () => route.query.parkId,
  () => {
    const q = parkIdFromRouteQuery()
    if (q && parks.value.some((p) => p.id === q)) {
      parkId.value = q
    }
  }
)

watch(
  () => route.query.assetId,
  async () => {
    applyAssetIdFromRouteAfterAssetsLoaded()
    if (map.value) {
      renderMarkers({ fitToMarkers: false })
      await nextTick()
      syncSelectionHalo()
    }
  }
)

watch(
  () =>
    `${String(route.query.pressure ?? '')}|${String(route.query.geoPressure ?? '')}|${String(route.query.waitHeat ?? '')}`,
  () => {
    applyPressureQueryToToggles()
    if (map.value) {
      setBaseMapTiles()
      if (showPressureHeat.value) void loadPressureHeat()
      else stopPressureHeatPoll()
      refreshWaitHeatmap()
    }
  }
)

watch([filterTypeCode, filterStatus, filterFreq], () => {
  const id = selectedAssetId.value
  if (id && !filteredAssets.value.some((a) => assetId(a) === id)) {
    selectedAssetId.value = ''
  }
  renderMarkers()
  if (showPressureHeat.value) void loadPressureHeat()
  refreshWaitHeatmap()
})

watch(showPressureHeat, (on) => {
  if (on) {
    void loadPressureHeat()
    startPressureHeatPoll()
  } else {
    stopPressureHeatPoll()
    pressureCells.value = []
    pressureHotspots.value = []
    pressureInsights.value = []
    refreshPressureLayers()
  }
  setBaseMapTiles()
  globalThis.requestAnimationFrame(() => map.value?.invalidateSize())
})

watch(showWaitHeatmap, () => {
  setBaseMapTiles()
  refreshWaitHeatmap()
  mountWaitHeatCanvasAboveMarkers()
  renderMarkers()
  if (showPressureHeat.value) refreshPressureLayers()
  globalThis.requestAnimationFrame(() => map.value?.invalidateSize())
})

watch(selectedAssetId, (cur, prev) => {
  if (prev) refreshMarkerIcon(prev)
  if (cur) refreshMarkerIcon(cur)
  syncSelectionHalo()
})

let mapMoveHandler: (() => void) | null = null
let mapZoomHandler: (() => void) | null = null
let mapClearSelect: (() => void) | null = null

onMounted(async () => {
  await load()
  if (!mapEl.value) return
  applyPressureQueryToToggles()
  map.value = L.map(mapEl.value, { zoomControl: true }).setView([48.27, 7.72], 13)
  setBaseMapTiles()
  ;(globalThis as unknown as { L: typeof L }).L = L
  await import('leaflet.heat')
  const LHeat = L as unknown as { heatLayer: (latlngs: [number, number, number][], o?: Record<string, unknown>) => WaitHeatLeafletLayer }
  waitHeatLeaflet.value = LHeat.heatLayer([], {
    radius: 46,
    blur: 32,
    minOpacity: 0,
    max: 1.05,
    maxZoom: 2,
    gradient: {
      0.05: '#052e16',
      0.28: '#166534',
      0.48: '#ca8a04',
      0.62: '#ea580c',
      0.78: '#ef4444',
      1.0: '#7f1d1d',
    },
  })
  waitHeatLeaflet.value.addTo(map.value)
  mountWaitHeatCanvasAboveMarkers()
  heatLayer.value = L.layerGroup().addTo(map.value)
  hotspotLayer.value = L.layerGroup().addTo(map.value)
  layer.value = L.layerGroup().addTo(map.value)
  selectionHaloGroup.value = L.layerGroup().addTo(map.value)
  if (showPressureHeat.value) void loadPressureHeat()
  else refreshPressureLayers()
  renderMarkers({ fitToMarkers: !assetIdFromRouteQuery() })
  void nextTick(() => syncSelectionHalo())
  refreshViewportBounds()
  mapMoveHandler = () => refreshViewportBounds()
  mapZoomHandler = () => {
    refreshViewportBounds()
    if (showWaitHeatmap.value) refreshWaitHeatmap()
  }
  map.value.on('moveend', mapMoveHandler)
  map.value.on('zoomend', mapZoomHandler)
  mapClearSelect = () => {
    clearMapSelection()
  }
  map.value.on('click', mapClearSelect)
  refreshWaitHeatmap()
})

onUnmounted(() => {
  stopHotspotWaveAnimation()
  stopPressureHeatPoll()
  const m = map.value
  if (m) {
    if (mapMoveHandler) m.off('moveend', mapMoveHandler)
    if (mapZoomHandler) m.off('zoomend', mapZoomHandler)
    if (mapClearSelect) m.off('click', mapClearSelect)
    restoreWaitHeatCanvasToOverlayPane()
    try {
      m.remove()
    } catch {
      /* heat canvas reparenting can leave DOM out of sync with leaflet.heat onRemove */
    }
    map.value = null
  }
  waitHeatLeaflet.value = null
  heatLayer.value = null
  hotspotLayer.value = null
  layer.value = null
  selectionHaloGroup.value = null
  markerByAssetId.value = new Map()
  baseRasterTiles = null
})
</script>

<template>
  <div class="asset-map-page flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-3 px-4 py-4">
    <div class="flex shrink-0 flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="font-display text-lg font-semibold text-white">Interactive park map</h1>
        <select
          v-model="parkId"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          @change="void load()"
        >
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <span class="text-xs text-slate-500">
          {{ filteredAssets.length }} shown · {{ withCoordsCount }} on map
        </span>
        <label class="ml-1 flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
          <input v-model="showPressureHeat" type="checkbox" class="rounded border-slate-600" />
          <span>Geo pressure heat</span>
          <span v-if="pressureLoading" class="text-slate-500">…</span>
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
          <input v-model="showWaitHeatmap" type="checkbox" class="rounded border-slate-600" />
          <span>Wartezeit-Heatmap</span>
        </label>
      </div>
      <p v-if="showWaitHeatmap" class="text-[10px] leading-snug text-slate-500">
        Kernel-Heatmap (leaflet.heat): jede offene Attraktion mit Koordinaten erzeugt ein Gewicht aus
        <span class="font-mono text-slate-500">queue.STANDBY.waitTime</span> (Snapshot); ohne Wartezeit niedrige Basisintensität.
        Überlagernde „Hotspots“ entsprechen dichter liegenden hohen Wartezeiten — keine echte Personendichte.
        Mit aktiver Heatmap: Pins kleiner/transparenter, Druck-Zellen blasser, Heat liegt über den Markern (Klicks gehen durch).
      </p>
      <p v-if="showPressureHeat" class="text-[10px] leading-snug text-slate-500">
        Raster = Druck je Zelle; halbtransparente Kreise = Hotspots (Größe ~ Wartezeit bzw. Druck, Überlagerung wirkt wie eine „Regenwolke“). Sanfte Puls-Animation; Live-Update ca. alle 55&nbsp;s.
      </p>
      <ul
        v-if="showPressureHeat && pressureInsights.length"
        class="list-inside list-disc rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-[11px] leading-snug text-slate-400"
      >
        <li v-for="(line, i) in pressureInsights.slice(0, 5)" :key="i">{{ line }}</li>
      </ul>

      <p class="text-[11px] leading-snug text-slate-500">
        Filter the list and markers. Ride markers use
        <strong class="text-slate-400">wait-time colours</strong> when a recent ThemeParks snapshot includes
        <span class="font-mono text-slate-500">queue.STANDBY.waitTime</span>; otherwise colour reflects
        <strong class="text-slate-400">operational status</strong>.
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Type</span>
        <button
          v-for="chip in TYPE_CHIPS"
          :key="chip.code || 'all'"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="
            filterTypeCode === chip.code
              ? 'border-brand-500 bg-brand-600/30 text-brand-100'
              : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500'
          "
          @click="filterTypeCode = chip.code"
        >
          {{ chip.label }}
          <span class="tabular-nums text-slate-400">({{ formatChipCount(typeChipCount(chip.code)) }})</span>
        </button>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="ml-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800"
          @click="resetAllFilters"
        >
          Alle Filter zurücksetzen
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="
            filterStatus === ''
              ? 'border-brand-500 bg-brand-600/30 text-brand-100'
              : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500'
          "
          @click="filterStatus = ''"
        >
          All
          <span class="tabular-nums text-slate-400">({{ formatChipCount(assets.length) }})</span>
        </button>
        <button
          v-for="st in statusChips"
          :key="st"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="
            filterStatus === st
              ? 'border-brand-500 bg-brand-600/30 text-brand-100'
              : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500'
          "
          @click="filterStatus = st"
        >
          {{ st }}
          <span class="tabular-nums text-slate-400">({{ formatChipCount(statusCounts[st] || 0) }})</span>
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Frequenz</span>
        <button
          v-for="chip in FREQ_CHIPS"
          :key="chip.code || 'all'"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
          :class="
            filterFreq === chip.code
              ? 'border-brand-500 bg-brand-600/30 text-brand-100'
              : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500'
          "
          @click="filterFreq = chip.code"
        >
          {{ chip.label }}
          <span class="tabular-nums text-slate-400">({{ formatChipCount(freqChipCount(chip.code)) }})</span>
        </button>
      </div>
      <p class="text-[10px] leading-snug text-slate-500">
        Frequenz aus
        <span class="font-mono text-slate-500">rideMaster.theoreticalCapacityPph</span> (Attraktionen). Schwellen
        (Gäste/h): sehr hoch ≥ {{ parkFreqThresholds.veryHighMin }}, mittel ≥ {{ parkFreqThresholds.mediumMin }}, niedrig ≥
        {{ parkFreqThresholds.lowMin }}; darunter „Schwach“. Ohne Wert oder andere Typen → „Keine Daten“. Anpassen unter
        <RouterLink to="/settings" class="text-brand-400 underline hover:text-brand-300">Einstellungen</RouterLink>.
      </p>

      <div class="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
        <a
          :href="googleMapsHref"
          target="_blank"
          rel="noopener noreferrer"
          class="text-brand-400 underline hover:text-brand-300"
        >
          Open in Google Maps
        </a>
        <span v-if="showPressureHeat" class="hidden h-3 w-px bg-slate-600 sm:inline" />
        <template v-if="showPressureHeat || showWaitHeatmap">
          <span class="font-semibold uppercase tracking-wide text-slate-500">Heat</span>
          <span class="inline-flex items-center gap-1"
            ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #22c55e" /> Low</span
          >
          <span class="inline-flex items-center gap-1"
            ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #eab308" /> Rising</span
          >
          <span class="inline-flex items-center gap-1"
            ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #f97316" /> Congested</span
          >
          <span class="inline-flex items-center gap-1"
            ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #b91c1c" /> Critical</span
          >
        </template>
        <span class="hidden h-3 w-px bg-slate-600 sm:inline" />
        <span class="font-semibold uppercase tracking-wide text-slate-500">Status colours</span>
        <span class="inline-flex items-center gap-1"
          ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #22c55e" /> Open</span
        >
        <span class="inline-flex items-center gap-1"
          ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #64748b" /> Closed</span
        >
        <span class="inline-flex items-center gap-1"
          ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #f97316" /> Down / refurb</span
        >
        <span class="inline-flex items-center gap-1"
          ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: #475569" /> Inactive / unknown</span
        >
      </div>

      <div v-if="ridesWithWaitSample" class="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
        <span class="font-semibold uppercase tracking-wide text-slate-500">Wait (rides, snapshot)</span>
        <span v-for="row in WAIT_LEGEND" :key="row.band" class="inline-flex items-center gap-1">
          <i class="inline-block h-2.5 w-2.5 rounded-full" :style="{ background: row.fill }" />
          {{ row.label }}
        </span>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:gap-4">
      <div
        ref="mapWrapRef"
        class="relative min-h-[280px] shrink-0 lg:min-h-0 lg:flex-1"
      >
        <div
          ref="mapEl"
          class="asset-map-wrap h-full min-h-[280px] rounded-xl border border-slate-800 lg:min-h-0"
        />
        <div
          v-if="showAnyHeatOverlay"
          class="pointer-events-none absolute left-3 top-1/2 z-[1001] flex -translate-y-1/2 flex-col items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-white drop-shadow-md"
          aria-hidden="true"
        >
          <span>Hoch</span>
          <div
            class="h-[7.5rem] w-2.5 rounded-sm border border-slate-700/90 shadow-lg"
            style="
              background: linear-gradient(
                to top,
                #14532d 0%,
                #22c55e 18%,
                #713f12 42%,
                #eab308 55%,
                #9a3412 78%,
                #450a0a 100%
              );
            "
          />
          <span>Niedrig</span>
        </div>
        <div
          v-if="showAnyHeatOverlay"
          class="absolute right-24 top-2 z-[1001] flex items-center gap-1.5 rounded-full border bg-slate-950/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-md max-sm:right-14"
          :class="
            showPressureHeat
              ? 'border-emerald-800/50 text-emerald-100'
              : 'border-sky-800/50 text-sky-100'
          "
          :title="heatBadgeTitle"
        >
          <template v-if="showPressureHeat">
            <span class="relative flex h-2 w-2 shrink-0">
              <span
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
              />
              <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live
          </template>
          <template v-else>
            <span class="inline-flex h-2 w-2 shrink-0 rounded-full bg-sky-400" />
            Snapshot
          </template>
        </div>
        <button
          type="button"
          class="absolute right-2 top-2 z-[1000] rounded border border-slate-600 bg-slate-900/90 px-2 py-1 text-[10px] font-medium text-slate-200 shadow hover:bg-slate-800"
          title="Fullscreen map"
          @click="toggleFullscreen"
        >
          ⛶ Full screen
        </button>
      </div>
      <aside
        class="flex max-h-[38vh] min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 lg:max-h-none lg:w-80"
      >
        <div
          class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          <div>
            <span>Sichtbereich</span>
            <span class="ml-1.5 font-normal normal-case text-slate-400">
              ({{ assetsForSidebar.inView.length }} im Ausschnitt)
            </span>
          </div>
          <button
            v-if="selectedAssetId"
            type="button"
            class="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-[10px] font-medium normal-case text-slate-200 hover:bg-slate-800"
            @click="clearMapSelection"
          >
            Auswahl aufheben
          </button>
        </div>
        <ul class="min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-2 text-sm" role="list">
          <li
            v-if="!assetsForSidebar.inView.length && !assetsForSidebar.noCoords.length && sidebarOutsideHint"
            class="px-2 py-3 text-center text-[11px] leading-snug text-slate-500"
          >
            Keine Assets im aktuellen Kartenausschnitt. Karte verschieben oder zoomen.
          </li>
          <li v-for="a in assetsForSidebar.inView" :key="assetId(a) || assetLabel(a)">
            <button
              type="button"
              class="flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-slate-200 hover:bg-slate-800/80"
              :class="[
                withCoords(a) ? '' : 'opacity-70',
                selectedAssetId && assetId(a) === selectedAssetId
                  ? 'bg-brand-900/40 ring-1 ring-brand-500/60'
                  : '',
              ]"
              @click="selectAssetFromSidebar(a)"
            >
              <span class="font-medium leading-tight text-white">{{ assetLabel(a) }}</span>
              <span class="text-[11px] text-slate-500">
                {{ assetTypeCode(a) || '—' }} · {{ assetStatus(a) }}
                <template v-if="assetWaitMinutes(a) != null"> · {{ assetWaitMinutes(a) }} min</template>
                <span v-if="!withCoords(a)" class="text-amber-400/90"> · no coordinates</span>
              </span>
            </button>
          </li>
          <template v-if="assetsForSidebar.noCoords.length">
            <li class="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ohne Koordinaten</li>
            <li v-for="a in assetsForSidebar.noCoords" :key="`nc-${assetId(a) || assetLabel(a)}`">
              <button
                type="button"
                class="flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left text-slate-200 opacity-70 hover:bg-slate-800/80"
                :class="
                  selectedAssetId && assetId(a) === selectedAssetId ? 'bg-brand-900/40 ring-1 ring-brand-500/60' : ''
                "
                @click="selectAssetFromSidebar(a)"
              >
                <span class="font-medium leading-tight text-white">{{ assetLabel(a) }}</span>
                <span class="text-[11px] text-slate-500">
                  {{ assetTypeCode(a) || '—' }} · {{ assetStatus(a) }}
                  <span class="text-amber-400/90"> · no coordinates</span>
                </span>
              </button>
            </li>
          </template>
          <li v-if="!filteredAssets.length" class="px-2 py-4 text-center text-xs text-slate-500">No assets match filters.</li>
        </ul>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* DivIcon: no default Leaflet image box */
.asset-map-wrap :deep(.asset-map-divicon-root) {
  background: transparent !important;
  border: none !important;
}

.asset-map-wrap :deep(.asset-map-pin) {
  width: 34px;
  height: 34px;
  border-radius: 9999px;
  border: 2px solid var(--pin-stroke, #334155);
  background: var(--pin-fill, #64748b);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}

.asset-map-wrap :deep(.asset-map-pin--compact) {
  width: 22px;
  height: 22px;
  border-width: 1.5px;
  opacity: 0.88;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.35);
}

.asset-map-wrap :deep(.asset-map-pin--selected) {
  box-shadow:
    0 0 0 3px rgba(250, 204, 21, 0.95),
    0 2px 10px rgba(0, 0, 0, 0.55);
}
</style>
