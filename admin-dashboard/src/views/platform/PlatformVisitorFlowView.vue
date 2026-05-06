<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getGeoFlowSimulation, getPlatformParks } from '@/api/client'
import type { GeoFlowSimulationPayload, PlatformPark } from '@/types/api'
import { setApiParkContextId } from '@/utils/apiParkContext'
import { useToast } from '@/composables/useToast'

const { push } = useToast()
const parks = ref<PlatformPark[]>([])
const parkId = ref('')
const loading = ref(false)
const payload = ref<GeoFlowSimulationPayload | null>(null)
const tickIndex = ref(0)
const flowMode = ref<'synthetic' | 'from_log'>('synthetic')
const guestCount = ref(600)
const transitionCount = ref(5)
const maxHopM = ref(420)
const seedInput = ref('')
/** ISO-8601 for log mode; empty = API default (last 24h) */
const logFromIso = ref('')
const logToIso = ref('')

const chartEl = ref<HTMLElement | null>(null)
const mapEl = ref<HTMLElement | null>(null)
let chart: echarts.ECharts | null = null
const map = shallowRef<L.Map | null>(null)
const lineLayer = shallowRef<L.LayerGroup | null>(null)
let chartResizeObs: ResizeObserver | null = null
let mapResizeObs: ResizeObserver | null = null

function detachChartObservers() {
  chartResizeObs?.disconnect()
  chartResizeObs = null
  mapResizeObs?.disconnect()
  mapResizeObs = null
}

function attachChartObservers() {
  detachChartObservers()
  if (chartEl.value) {
    chartResizeObs = new ResizeObserver(() => {
      chart?.resize()
    })
    chartResizeObs.observe(chartEl.value)
  }
  if (mapEl.value) {
    mapResizeObs = new ResizeObserver(() => {
      map.value?.invalidateSize()
    })
    mapResizeObs.observe(mapEl.value)
  }
}

function bumpChartMapLayout() {
  globalThis.requestAnimationFrame(() => {
    chart?.resize()
    map.value?.invalidateSize()
    globalThis.requestAnimationFrame(() => {
      chart?.resize()
      map.value?.invalidateSize()
    })
  })
}

/** Use internal park UUID in the path — works with `resolveParkRow` PK lookup and avoids slug→UUID issues on older API builds. */
const parkKeyForGeoApi = computed(() => (parkId.value ? String(parkId.value) : ''))

const ticks = computed(() => payload.value?.ticks ?? [])
const currentTick = computed(() => ticks.value[tickIndex.value] ?? null)
/** Log mode without journey transitions: API returns empty ticks — hide replay so it does not look “broken”. */
const hasFlowReplay = computed(() => ticks.value.length > 0)

const slugToName = computed(() => {
  const m: Record<string, string> = {}
  for (const n of payload.value?.nodes ?? []) m[n.slug] = n.name
  return m
})

const slugToCoord = computed(() => {
  const m: Record<string, { lat: number; lng: number }> = {}
  for (const n of payload.value?.nodes ?? []) {
    if (n.lat != null && n.lng != null && Number.isFinite(n.lat) && Number.isFinite(n.lng)) {
      m[n.slug] = { lat: n.lat, lng: n.lng }
    }
  }
  return m
})

/** Park centroid for map fallback (API `park` or Rust / EP area). */
const parkMapFocus = computed(() => {
  const p = payload.value?.park
  let lat = Number.NaN
  let lng = Number.NaN
  if (p?.latitude != null) lat = Number(p.latitude)
  if (p?.longitude != null) lng = Number(p.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, zoom: 15 as const }
  return { lat: 48.266, lng: 7.721, zoom: 14 as const }
})

function graphOption(
  links: Array<{ source: string; target: string; value: number }>,
  labels: Record<string, string>
): EChartsOption {
  const names = new Set<string>()
  for (const l of links) {
    names.add(l.source)
    names.add(l.target)
  }
  const deg = new Map<string, number>()
  for (const l of links) {
    deg.set(l.source, (deg.get(l.source) || 0) + l.value)
    deg.set(l.target, (deg.get(l.target) || 0) + l.value)
  }
  const data = [...names].map((id) => ({
    id,
    name: (labels[id] || id).slice(0, 26),
    symbolSize: 12 + Math.min(28, Math.log1p(deg.get(id) || 0) * 2.8),
  }))
  return {
    backgroundColor: 'transparent',
    tooltip: {
      formatter: (p: unknown) => {
        const o = p as { dataType?: string; data?: { id?: string }; name?: string; value?: number }
        if (o.dataType === 'edge') return `${String(o.value ?? '')} moves`
        return o.data?.id ? labels[o.data.id] || o.data.id : o.name || ''
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        animationDurationUpdate: 380,
        data,
        links: links.map((l) => ({
          source: l.source,
          target: l.target,
          value: l.value,
          lineStyle: {
            width: Math.max(1, Math.log1p(l.value) * 2.1),
            opacity: 0.42,
            curveness: 0.18,
            color: '#64748b',
          },
        })),
        roam: true,
        draggable: true,
        label: { show: true, color: '#e2e8f0', fontSize: 9 },
        force: {
          initLayout: 'circular',
          repulsion: 320,
          gravity: 0.1,
          edgeLength: [72, 200],
          layoutAnimation: true,
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 5, opacity: 0.95, color: '#38bdf8' },
        },
      },
    ],
  }
}

function renderChart() {
  const el = chartEl.value
  if (!el) return
  if (!chart) chart = echarts.init(el, undefined, { renderer: 'canvas' })
  const links = currentTick.value?.links ?? []
  if (!links.length) {
    chart.setOption(
      {
        title: {
          text: 'Keine Kanten für diesen Schritt.',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 13 },
        },
        series: [],
      },
      true
    )
    return
  }
  chart.setOption(graphOption(links, slugToName.value), true)
}

function renderGeoMap() {
  const el = mapEl.value
  if (!el || !payload.value) return
  const links = currentTick.value?.links ?? []
  const coord = slugToCoord.value
  const focus = parkMapFocus.value
  if (!map.value) {
    map.value = L.map(el, { zoomControl: true }).setView([focus.lat, focus.lng], focus.zoom)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(
      map.value
    )
    lineLayer.value = L.layerGroup().addTo(map.value)
  }
  if (!lineLayer.value || !map.value) return
  lineLayer.value.clearLayers()
  const pts: L.LatLngTuple[] = []
  let maxV = 1
  for (const l of links) maxV = Math.max(maxV, l.value)
  for (const l of links) {
    const a = coord[l.source]
    const b = coord[l.target]
    if (!a || !b) continue
    const t: L.LatLngTuple[] = [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ]
    pts.push(t[0], t[1])
    const opacity = Math.max(0.45, 0.25 + (l.value / maxV) * 0.7)
    L.polyline(t, {
      color: '#0369a1',
      weight: 3 + Math.min(12, Math.log1p(l.value) * 1.4),
      opacity,
    }).addTo(lineLayer.value)
  }
  if (pts.length) {
    map.value.fitBounds(L.latLngBounds(pts).pad(0.14))
  } else {
    const nodePts = Object.values(coord).filter((c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    if (nodePts.length) {
      const b = L.latLngBounds(nodePts.map((c) => [c.lat, c.lng] as L.LatLngTuple))
      map.value.fitBounds(b.pad(0.1))
    } else {
      map.value.setView([focus.lat, focus.lng], focus.zoom)
    }
  }
  globalThis.requestAnimationFrame(() => {
    map.value?.invalidateSize()
  })
}

async function load() {
  if (!parkId.value) return
  loading.value = true
  try {
    setApiParkContextId(parkId.value)
    const seedRaw = seedInput.value.trim()
    const seed =
      seedRaw === '' || Number.isNaN(Number(seedRaw)) ? undefined : Math.floor(Number(seedRaw))
    const base = {
      guestCount: guestCount.value,
      transitionCount: transitionCount.value,
      maxHopM: maxHopM.value,
      seed,
      topEdges: 45,
    }
    payload.value =
      flowMode.value === 'from_log'
        ? await getGeoFlowSimulation(parkKeyForGeoApi.value, {
            mode: 'from_log',
            from: logFromIso.value.trim() || undefined,
            to: logToIso.value.trim() || undefined,
            topEdges: 45,
          })
        : await getGeoFlowSimulation(parkKeyForGeoApi.value, base)
    tickIndex.value = 0
    await nextTick()
    attachChartObservers()
    renderChart()
    renderGeoMap()
    bumpChartMapLayout()
  } catch (e) {
    payload.value = null
    detachChartObservers()
    push(e instanceof Error ? e.message : 'Laden fehlgeschlagen', 'error')
  } finally {
    loading.value = false
  }
}

function onResize() {
  chart?.resize()
  map.value?.invalidateSize()
}

watch(tickIndex, async () => {
  await nextTick()
  renderChart()
  renderGeoMap()
  bumpChartMapLayout()
})

watch(parkId, () => void load())

watch(flowMode, () => void load())

onMounted(async () => {
  try {
    parks.value = await getPlatformParks()
    if (parks.value.length) parkId.value = parks.value[0].id
  } catch (e) {
    push(e instanceof Error ? e.message : 'Parks', 'error')
  }
  globalThis.addEventListener('resize', onResize)
  await load()
})

onUnmounted(() => {
  globalThis.removeEventListener('resize', onResize)
  detachChartObservers()
  chart?.dispose()
  chart = null
  map.value?.remove()
  map.value = null
  lineLayer.value = null
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 px-4 py-6">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">Besucherstrom</h1>
      <p class="mt-2 max-w-3xl text-sm text-slate-400">
        <strong class="text-slate-300">Synthetisch:</strong> Monte-Carlo aus Geo-Druck &amp; Distanz.
        <strong class="text-slate-300">Aus Log:</strong> Kanten aus
        <span class="font-mono text-slate-500">visitor_journey_events</span> (Batch-Ingest per API). Replay steuert
        kumulierte Kanten; die Karte zeigt dieselben Flüsse geografisch.
      </p>
    </div>

    <div class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <label class="text-xs text-slate-400">
        Park
        <select v-model="parkId" class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white">
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-400">
        Datenquelle
        <select v-model="flowMode" class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white">
          <option value="synthetic">Simuliert</option>
          <option value="from_log">Journey-Log (DB)</option>
        </select>
      </label>
      <template v-if="flowMode === 'synthetic'">
        <label class="text-xs text-slate-400">
          Gäste
          <input
            v-model.number="guestCount"
            type="number"
            min="50"
            max="8000"
            class="mt-1 block w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-400">
          Übergänge
          <input
            v-model.number="transitionCount"
            type="number"
            min="2"
            max="25"
            class="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-400">
          max. Sprung (m)
          <input
            v-model.number="maxHopM"
            type="number"
            min="120"
            max="1500"
            class="mt-1 block w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-400">
          Seed
          <input
            v-model="seedInput"
            type="text"
            placeholder="zufällig"
            class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          />
        </label>
      </template>
      <template v-else>
        <label class="text-xs text-slate-400">
          from (ISO, optional)
          <input
            v-model="logFromIso"
            type="text"
            placeholder="leer = 24h zurück"
            class="mt-1 block w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-white"
          />
        </label>
        <label class="text-xs text-slate-400">
          to (ISO, optional)
          <input
            v-model="logToIso"
            type="text"
            placeholder="leer = jetzt"
            class="mt-1 block w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-white"
          />
        </label>
      </template>
      <button
        type="button"
        class="rounded-lg border border-brand-600 bg-brand-600/20 px-4 py-2 text-sm font-medium text-brand-100 hover:bg-brand-600/30 disabled:opacity-50"
        :disabled="loading"
        @click="void load()"
      >
        {{ loading ? '…' : 'Laden' }}
      </button>
    </div>

    <!-- Hinweis ersetzt nicht mehr Grafik + Karte (vormals v-else-if → leeres Layout bei meta.message). -->
    <div
      v-if="payload?.meta?.message"
      class="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-3 text-sm text-amber-200"
    >
      <template v-if="payload.meta.code === 'LOG_NO_TRANSITIONS'">
        <p class="font-medium text-amber-100">Journey-Log: keine Übergänge im Zeitraum</p>
        <p class="mt-2 text-xs leading-relaxed text-amber-200/95">
          Es wurden keine Kanten gebaut: entweder gibt es in
          <span class="font-mono text-amber-300/90">visitor_journey_events</span> keine Events im Fenster, oder pro
          <span class="font-mono">caseId</span> gibt es keine Sequenz mit mindestens zwei verschiedenen Assets (ohne
          direkte Wiederholung desselben Slugs).
        </p>
        <p v-if="payload.meta.eventsInWindow != null" class="mt-2 text-xs text-amber-300/85">
          Im Fenster: {{ payload.meta.eventsInWindow }} Events · {{ payload.meta.casesInWindow ?? 0 }} Fälle (caseId) ·
          {{ payload.meta.casesWithPath ?? 0 }} Fälle mit Pfad ≥ 2 Stationen
        </p>
        <p class="mt-2 font-mono text-[11px] leading-snug text-amber-400/90">
          POST /api/v1/parks/{{ parkKeyForGeoApi || '{parkId}' }}/geo/flow/events/batch
        </p>
        <p class="mt-1 text-[11px] text-amber-200/80">
          Alternativ Demo ohne DB-Log:
          <button
            type="button"
            class="ml-1 rounded border border-amber-600/80 bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-100 hover:bg-amber-800/50"
            @click="flowMode = 'synthetic'"
          >
            Datenquelle → Simuliert
          </button>
        </p>
        <p class="mt-3 border-t border-amber-800/40 pt-2 text-[11px] text-amber-300/70">{{ payload.meta.message }}</p>
      </template>
      <template v-else>
        {{ payload.meta.message }}
      </template>
    </div>

    <div v-if="payload && hasFlowReplay" class="space-y-3">
      <div class="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span v-if="payload.parameters.mode === 'from_log'">
          Modus Log · {{ payload.meta.eventsInWindow ?? 0 }} Events · {{ payload.meta.casesWithPath ?? 0 }} Fälle mit
          Pfad · {{ payload.parameters.from?.slice(0, 16) }}… → {{ payload.parameters.to?.slice(0, 16) }}…
        </span>
        <span v-else>
          Modus simuliert · {{ payload.meta.guestsSimulated }} Gäste · {{ payload.meta.transitionsSimulated }} Übergänge
          <template v-if="payload.parameters.seed != null"> · Seed {{ payload.parameters.seed }}</template>
        </span>
        <span v-if="payload.meta.totalEdges != null"
          >{{ payload.meta.edgesReturned }} / {{ payload.meta.totalEdges }} Kanten (Top-N)</span
        >
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-slate-400">
          {{ currentTick?.label || 'Replay' }}
          <input
            v-model.number="tickIndex"
            type="range"
            min="0"
            :max="Math.max(0, ticks.length - 1)"
            step="1"
            class="w-full accent-brand-500"
          />
        </label>
      </div>
      <div ref="chartEl" class="h-[420px] w-full rounded-xl border border-slate-800 bg-slate-950/40" />
      <div>
        <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Karte (Replay-Kanten)</h2>
        <div ref="mapEl" class="h-[360px] w-full rounded-xl border border-slate-800 bg-slate-950/40" />
      </div>

      <details class="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-400">
        <summary class="cursor-pointer text-slate-300">Beispiel-Pfade</summary>
        <ul class="mt-2 space-y-2 font-mono text-[11px] text-slate-500">
          <li v-for="(c, i) in (payload.sampleCases ?? []).slice(0, 6)" :key="i">
            {{ c.map((x) => x.slug).join(' → ') }}
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>
