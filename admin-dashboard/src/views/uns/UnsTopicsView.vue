<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getIntegrationSettings, getUnsTopics, type UnsTopicRow } from '@/api/client'
import {
  buildSparkplugTopic,
  SPARKPLUG_ADVANCED_EXTRA_TYPES,
  SPARKPLUG_COMPACT_DEVICE_TYPES,
  slugifyName,
} from '@/lib/sparkplugTopicBuild'
import { aggregateUnsLeavesToEntities, type AggregatedEntityRow } from '@/lib/unsTopicsEntityModel'
import { utcCompactTimestampForFilename } from '@/utils/dateTime'

const EDGE_NODE_ID = 'park_gateway'

const route = useRoute()
const parkId = ref('')
const leaves = ref<UnsTopicRow[]>([])
const search = ref('')
const domainQuick = ref<string>('')
const viewMode = ref<'business' | 'technical'>('business')
const showAdvancedSparkplug = ref(false)

async function resolveParkId() {
  const settings = await getIntegrationSettings()
  const key = typeof settings.unsParkKey === 'string' ? settings.unsParkKey.trim() : ''
  parkId.value =
    key ||
    ((settings.selectedPark as { externalParkId?: string } | undefined)?.externalParkId as string) ||
    'europa_park'
}

async function load() {
  if (!parkId.value) await resolveParkId()
  leaves.value = await getUnsTopics(parkId.value, { sparkplugMessageType: 'DDATA' })
}

const sparkplugGroupId = computed(() => slugifyName(parkId.value || 'europa_park'))

const nodeTopics = computed(() => {
  const g = sparkplugGroupId.value
  const e = EDGE_NODE_ID
  return {
    edge: e,
    NBIRTH: buildSparkplugTopic({ groupId: g, messageType: 'NBIRTH', edgeNodeId: e }),
    NDEATH: buildSparkplugTopic({ groupId: g, messageType: 'NDEATH', edgeNodeId: e }),
    STATE: buildSparkplugTopic({ groupId: g, messageType: 'STATE', edgeNodeId: e }),
    NCMD: buildSparkplugTopic({ groupId: g, messageType: 'NCMD', edgeNodeId: e }),
  }
})

const entitiesAll = computed(() => aggregateUnsLeavesToEntities(leaves.value))

const filteredEntities = computed(() => {
  let list = entitiesAll.value
  const q = search.value.trim().toLowerCase()
  if (domainQuick.value) {
    list = list.filter((e) => e.domain === domainQuick.value)
  }
  if (q) {
    list = list.filter((e) => {
      const blob = [
        e.displayName,
        e.domain,
        e.assetSlug,
        e.metrics.map((m) => `${m.metric} ${m.canonicalUnsTopic}`).join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }
  return list
})

const stats = computed(() => {
  const e = filteredEntities.value
  return {
    rides: e.filter((x) => x.domain === 'rides').length,
    restaurants: e.filter((x) => x.domain === 'restaurants').length,
    shows: e.filter((x) => x.domain === 'shows').length,
    playgrounds: e.filter((x) => x.domain === 'playgrounds').length,
    devices: e.length,
  }
})

function deviceSparkplugRows(assetSlug: string, types: readonly string[]) {
  const g = sparkplugGroupId.value
  return types.map((mt) => ({
    mt,
    topic: buildSparkplugTopic({
      groupId: g,
      messageType: mt,
      edgeNodeId: EDGE_NODE_ID,
      deviceId: assetSlug,
    }),
  }))
}

function csvEscape(cell: string | number | null | undefined): string {
  const s = cell == null ? '' : String(cell)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function triggerDownload(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadEntitiesCsv() {
  const list = filteredEntities.value
  const headers = [
    'display_name',
    'domain',
    'asset_slug',
    'metrics',
    'sparkplug_ddata',
    'sparkplug_dbirth',
    'uns_park_key',
  ]
  const lines = [headers.join(',')]
  const g = sparkplugGroupId.value
  for (const ent of list) {
    const ddata = buildSparkplugTopic({
      groupId: g,
      messageType: 'DDATA',
      edgeNodeId: EDGE_NODE_ID,
      deviceId: ent.assetSlug,
    })
    const dbirth = buildSparkplugTopic({
      groupId: g,
      messageType: 'DBIRTH',
      edgeNodeId: EDGE_NODE_ID,
      deviceId: ent.assetSlug,
    })
    lines.push(
      [
        csvEscape(ent.displayName),
        csvEscape(ent.domain),
        csvEscape(ent.assetSlug),
        csvEscape(ent.metrics.map((m) => m.metric).join(';')),
        csvEscape(ddata),
        csvEscape(dbirth),
        csvEscape(parkId.value),
      ].join(',')
    )
  }
  const stamp = utcCompactTimestampForFilename()
  const safePark = String(parkId.value || 'park').replace(/[^a-z0-9_-]/gi, '_')
  triggerDownload(`uns-entities_${safePark}_${stamp}.csv`, 'text/csv;charset=utf-8', `\uFEFF${lines.join('\n')}`)
}

/** NBIRTH/NDEATH/STATE/NCMD are node-level: omit deviceId in JSON export for those types. */
function sparkplugUrlForExport(mt: string, assetSlug: string): string {
  const g = sparkplugGroupId.value
  const nodeOnly = ['NBIRTH', 'NDEATH', 'STATE', 'NCMD'].includes(mt)
  return buildSparkplugTopic({
    groupId: g,
    messageType: mt,
    edgeNodeId: EDGE_NODE_ID,
    deviceId: nodeOnly ? undefined : assetSlug,
  })
}

function downloadEntitiesJsonFixed() {
  const stamp = utcCompactTimestampForFilename()
  const safePark = String(parkId.value || 'park').replace(/[^a-z0-9_-]/gi, '_')
  const g = sparkplugGroupId.value
  const allTypes = [...SPARKPLUG_COMPACT_DEVICE_TYPES, ...SPARKPLUG_ADVANCED_EXTRA_TYPES] as string[]
  const doc = {
    exportedAt: new Date().toISOString(),
    unsParkKey: parkId.value,
    view: 'entity_aggregated',
    node: {
      edgeNodeId: EDGE_NODE_ID,
      topics: Object.fromEntries(
        (['NBIRTH', 'NDEATH', 'STATE', 'NCMD'] as const).map((mt) => [
          mt,
          buildSparkplugTopic({ groupId: g, messageType: mt, edgeNodeId: EDGE_NODE_ID }),
        ])
      ),
    },
    entities: filteredEntities.value.map((ent) => ({
      displayName: ent.displayName,
      domain: ent.domain,
      assetSlug: ent.assetSlug,
      metrics: ent.metrics.map((m) => ({ metric: m.metric, canonicalUnsTopic: m.canonicalUnsTopic })),
      sparkplugByMessageType: Object.fromEntries(
        allTypes.map((mt) => [mt, sparkplugUrlForExport(mt, ent.assetSlug)])
      ),
    })),
  }
  triggerDownload(
    `uns-entities_${safePark}_${stamp}.json`,
    'application/json;charset=utf-8',
    `${JSON.stringify(doc, null, 2)}\n`
  )
}

function applyRouteSearchQuery() {
  const q = route.query.q
  if (typeof q === 'string' && q.trim()) search.value = q.trim()
}

onMounted(() => {
  applyRouteSearchQuery()
  void load()
})

watch(
  () => route.query.q,
  () => {
    applyRouteSearchQuery()
  }
)

function compactRows(ent: AggregatedEntityRow) {
  return deviceSparkplugRows(ent.assetSlug, SPARKPLUG_COMPACT_DEVICE_TYPES)
}

function advancedDeviceRows(ent: AggregatedEntityRow) {
  return deviceSparkplugRows(ent.assetSlug, ['DCMD'])
}
</script>

<template>
  <div class="mx-auto max-w-[1920px] space-y-10 px-6 py-10 sm:px-8">
    <header class="space-y-3">
      <h1 class="font-display text-2xl font-semibold tracking-tight text-white">UNS Topic Preview</h1>
      <p class="max-w-3xl text-sm leading-relaxed text-slate-400">
        Eine Zeile pro <strong class="font-medium text-slate-300">Entity</strong> (Attraktion, Restaurant, …). Metriken
        sind eine Unterliste. Sparkplug-Gerätetopics sind kompakt (DBIRTH / DDATA / DDEATH); Node-Topics (NBIRTH/NDEATH
        am Gateway) erscheinen nur oben.
      </p>
    </header>

    <!-- Count cards -->
    <section class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-2xl border border-slate-800/80 bg-slate-900/50 px-6 py-6 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Rides</p>
        <p class="mt-2 text-3xl font-semibold tabular-nums text-white">{{ stats.rides }}</p>
      </div>
      <div class="rounded-2xl border border-slate-800/80 bg-slate-900/50 px-6 py-6 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Restaurants</p>
        <p class="mt-2 text-3xl font-semibold tabular-nums text-white">{{ stats.restaurants }}</p>
      </div>
      <div class="rounded-2xl border border-slate-800/80 bg-slate-900/50 px-6 py-6 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Shows</p>
        <p class="mt-2 text-3xl font-semibold tabular-nums text-white">{{ stats.shows }}</p>
      </div>
      <div class="rounded-2xl border border-slate-800/80 bg-slate-900/50 px-6 py-6 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Online devices</p>
        <p class="mt-2 text-3xl font-semibold tabular-nums text-emerald-300/90">{{ stats.devices }}</p>
        <p v-if="stats.playgrounds > 0" class="mt-2 text-xs text-slate-500">
          + {{ stats.playgrounds }} playground(s)
        </p>
      </div>
    </section>

    <!-- Global node strip -->
    <section
      class="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/80 to-slate-950/90 px-8 py-7"
    >
      <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-400">Node</h2>
      <p class="mt-2 text-lg text-white">
        <span class="font-mono text-brand-300">{{ nodeTopics.edge }}</span>
        <span class="mx-2 text-slate-600">·</span>
        <span class="text-emerald-400/90">online</span>
        <span class="ml-3 text-sm font-normal text-slate-500">(Edge / Gateway — NBIRTH &amp; NDEATH nur hier)</span>
      </p>
      <dl class="mt-5 flex flex-wrap gap-x-10 gap-y-3 text-sm text-slate-300">
        <div>
          <dt class="text-xs uppercase text-slate-500">NBIRTH</dt>
          <dd class="mt-1 font-mono text-xs text-amber-200/90">{{ nodeTopics.NBIRTH }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase text-slate-500">NDEATH</dt>
          <dd class="mt-1 font-mono text-xs text-amber-200/90">{{ nodeTopics.NDEATH }}</dd>
        </div>
      </dl>
      <div v-if="showAdvancedSparkplug" class="mt-6 border-t border-slate-800 pt-6">
        <p class="text-xs font-medium uppercase text-slate-500">Node (advanced)</p>
        <dl class="mt-3 flex flex-wrap gap-x-10 gap-y-3 text-sm text-slate-300">
          <div>
            <dt class="text-xs uppercase text-slate-500">NCMD</dt>
            <dd class="mt-1 font-mono text-xs text-slate-400">{{ nodeTopics.NCMD }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase text-slate-500">STATE</dt>
            <dd class="mt-1 font-mono text-xs text-slate-400">{{ nodeTopics.STATE }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- Toolbar -->
    <section class="flex flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/40 px-6 py-6 sm:px-8">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <p class="text-sm text-slate-400">
          UNS park key: <span class="font-mono text-white">{{ parkId || '—' }}</span>
        </p>
        <div class="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1">
          <button
            type="button"
            class="rounded-lg px-5 py-2 text-sm font-medium transition"
            :class="viewMode === 'business' ? 'bg-brand-600 text-white shadow' : 'text-slate-400 hover:text-white'"
            @click="viewMode = 'business'"
          >
            Business view
          </button>
          <button
            type="button"
            class="rounded-lg px-5 py-2 text-sm font-medium transition"
            :class="viewMode === 'technical' ? 'bg-brand-600 text-white shadow' : 'text-slate-400 hover:text-white'"
            @click="viewMode = 'technical'"
          >
            Technical view
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-5">
        <label class="flex min-w-[14rem] flex-1 flex-col gap-2 text-xs font-medium text-slate-400">
          Search
          <input
            v-model="search"
            type="search"
            placeholder="Entity, Metrik, Topic-Pfad…"
            class="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-600"
          />
        </label>
        <label class="flex flex-col gap-2 text-xs font-medium text-slate-400">
          Domain
          <select
            v-model="domainQuick"
            class="min-w-[11rem] rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
          >
            <option value="">All</option>
            <option value="rides">rides</option>
            <option value="restaurants">restaurants</option>
            <option value="shows">shows</option>
            <option value="playgrounds">playgrounds</option>
            <option value="shops">shops</option>
            <option value="transport">transport</option>
            <option value="services">services</option>
            <option value="operations">operations</option>
          </select>
        </label>
        <label class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-300">
          <input v-model="showAdvancedSparkplug" type="checkbox" class="size-4 rounded border-slate-600" />
          Advanced: Node <span class="font-mono text-slate-500">NCMD · STATE</span> · Device
          <span class="font-mono text-slate-500">DCMD</span>
        </label>
        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-slate-500">Export</span>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              :disabled="!filteredEntities.length"
              @click="downloadEntitiesCsv"
            >
              CSV
            </button>
            <button
              type="button"
              class="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              :disabled="!filteredEntities.length"
              @click="downloadEntitiesJsonFixed"
            >
              JSON
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Table -->
    <section class="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/30">
      <table class="min-w-full border-collapse text-left text-sm">
        <thead>
          <tr class="border-b border-slate-800 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th class="whitespace-nowrap px-6 py-5">Entity</th>
            <th class="whitespace-nowrap px-6 py-5">Type / domain</th>
            <th class="px-6 py-5">Metrics</th>
            <th class="min-w-[14rem] px-6 py-5">Sparkplug (device)</th>
            <th v-if="viewMode === 'technical'" class="px-6 py-5">Canonical UNS</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ent in filteredEntities"
            :key="ent.key"
            class="border-b border-slate-800/90 align-top transition hover:bg-slate-800/20"
          >
            <td class="px-6 py-6">
              <p class="text-base font-medium text-white">{{ ent.displayName }}</p>
              <p v-if="viewMode === 'technical'" class="mt-2 font-mono text-xs text-slate-500">{{ ent.assetSlug }}</p>
            </td>
            <td class="px-6 py-6">
              <span
                class="inline-flex rounded-full border border-slate-600 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200"
              >
                {{ ent.domain }}
              </span>
            </td>
            <td class="px-6 py-6">
              <ul class="list-inside list-disc space-y-2 pl-1 text-slate-200">
                <li v-for="m in ent.metrics" :key="m.leafId" class="marker:text-brand-500">
                  <span class="font-mono text-xs text-brand-200/90">{{ m.metric }}</span>
                  <span v-if="viewMode === 'technical'" class="mt-1 block font-mono text-[11px] leading-snug text-slate-500">
                    {{ m.canonicalUnsTopic }}
                  </span>
                </li>
              </ul>
            </td>
            <td class="px-6 py-6">
              <ul class="space-y-3 text-xs leading-relaxed">
                <li v-for="row in compactRows(ent)" :key="row.mt">
                  <span class="font-semibold text-slate-500">{{ row.mt }}</span>
                  <span class="mt-1 block font-mono text-amber-200/85 break-words">{{ row.topic }}</span>
                </li>
                <template v-if="showAdvancedSparkplug">
                  <li v-for="row in advancedDeviceRows(ent)" :key="'adv-' + row.mt">
                    <span class="font-semibold text-slate-500">{{ row.mt }}</span>
                    <span class="mt-1 block font-mono text-slate-400 break-words">{{ row.topic }}</span>
                  </li>
                </template>
              </ul>
            </td>
            <td v-if="viewMode === 'technical'" class="px-6 py-6">
              <ul class="space-y-2 font-mono text-[11px] leading-relaxed text-slate-400">
                <li v-for="m in ent.metrics" :key="'tp-' + m.leafId" class="break-words">{{ m.canonicalUnsTopic }}</li>
              </ul>
            </td>
          </tr>
          <tr v-if="!filteredEntities.length">
            <td :colspan="viewMode === 'technical' ? 5 : 4" class="px-6 py-12 text-center text-slate-500">
              Keine Entities für die aktuellen Filter.
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
