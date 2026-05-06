<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  getUnsRegistryMirrorSummary,
  getUnsRegistryEntities,
  getUnsRegistryTopics,
  type UnsRegistryMirrorSummary,
  type UnsRegistryEntityRow,
  type UnsRegistryTopicRow,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()

const busy = ref(false)
const summary = ref<UnsRegistryMirrorSummary | null>(null)
const entityAll = ref<UnsRegistryEntityRow[]>([])
const topicAll = ref<UnsRegistryTopicRow[]>([])
const loadError = ref<string | null>(null)
const truncatedEntities = ref(false)
const truncatedTopics = ref(false)

const DUPLICATE_TOPIC_LABEL = 'not available' as const

const fEntityParkId = ref('')
const fEntityKind = ref('')
const fEntityDomain = ref('')
const fEntityLegacyTable = ref('')
const fEntityMissingParkOnly = ref(false)

const fTopicParkId = ref('')
const fTopicSignalKey = ref('')
const fTopicSourceType = ref<'all' | 'mirrored' | 'uns_node'>('all')
const fTopicMissingParkOnly = ref(false)

const entityById = computed(() => {
  const m = new Map<string, UnsRegistryEntityRow>()
  for (const e of entityAll.value) m.set(e.id, e)
  return m
})

function str(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function entityDomain(row: UnsRegistryEntityRow): string {
  const d = row.payloadJson?.domain
  return typeof d === 'string' && d ? d : '—'
}

function entityStatus(row: UnsRegistryEntityRow): string {
  if (row.entityKind === 'EXTERNAL_ENTITY_MAPPING') return 'N/A (global)'
  if (row.parkId) return 'OK'
  if (row.entityKind === 'UNS_NODE') return 'No park UUID'
  return 'No park'
}

function topicSignalKey(row: UnsRegistryTopicRow): string {
  const m = row.payloadJson?.metric
  return typeof m === 'string' && m ? m : '—'
}

function topicSourceTypeLabel(row: UnsRegistryTopicRow): string {
  const parts = [row.registrySource || '—']
  if (row.unsNodeLegacyId) parts.push('UNS node')
  return parts.join(' · ')
}

function topicIsActive(row: UnsRegistryTopicRow): string {
  if (!row.registryEntityId) return '—'
  const ent = entityById.value.get(row.registryEntityId)
  const v = ent?.payloadJson?.isActive
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return '—'
}

const filteredEntities = computed(() => {
  let rows = entityAll.value
  const pk = str(fEntityParkId.value)
  if (pk) rows = rows.filter((r) => r.parkId === pk)
  const ek = str(fEntityKind.value)
  if (ek) rows = rows.filter((r) => r.entityKind.toLowerCase().includes(ek.toLowerCase()))
  const dom = str(fEntityDomain.value).toLowerCase()
  if (dom) rows = rows.filter((r) => entityDomain(r).toLowerCase().includes(dom))
  const lt = str(fEntityLegacyTable.value).toLowerCase()
  if (lt) rows = rows.filter((r) => r.legacyTable.toLowerCase().includes(lt))
  if (fEntityMissingParkOnly.value) rows = rows.filter((r) => r.parkId == null)
  return rows
})

const filteredTopics = computed(() => {
  let rows = topicAll.value
  const pk = str(fTopicParkId.value)
  if (pk) rows = rows.filter((r) => r.parkId === pk)
  const sk = str(fTopicSignalKey.value).toLowerCase()
  if (sk) rows = rows.filter((r) => topicSignalKey(r).toLowerCase().includes(sk))
  if (fTopicSourceType.value === 'uns_node') rows = rows.filter((r) => !!r.unsNodeLegacyId)
  if (fTopicSourceType.value === 'mirrored') rows = rows.filter((r) => (r.registrySource || '').includes('MIRRORED'))
  if (fTopicMissingParkOnly.value) rows = rows.filter((r) => r.parkId == null || r.parkId === '')
  return rows
})

const nullParkEntityCount = computed(() => entityAll.value.filter((e) => e.parkId == null).length)

async function loadPaged<T>(
  fetcher: (offset: number, limit: number) => Promise<{ total: number; items: T[] }>,
  maxRows: number
): Promise<{ rows: T[]; truncated: boolean }> {
  const out: T[] = []
  const page = 200
  let offset = 0
  let total = Number.POSITIVE_INFINITY
  while (offset < total && out.length < maxRows) {
    const res = await fetcher(offset, page)
    total = res.total
    if (!res.items.length) break
    out.push(...res.items)
    offset += res.items.length
  }
  return { rows: out, truncated: out.length < total }
}

async function refresh() {
  busy.value = true
  loadError.value = null
  try {
    summary.value = await getUnsRegistryMirrorSummary()
    const ent = await loadPaged<UnsRegistryEntityRow>(
      (offset, limit) => getUnsRegistryEntities({ limit, offset }),
      10000
    )
    entityAll.value = ent.rows
    truncatedEntities.value = ent.truncated
    const top = await loadPaged<UnsRegistryTopicRow>(
      (offset, limit) => getUnsRegistryTopics({ limit, offset }),
      10000
    )
    topicAll.value = top.rows
    truncatedTopics.value = top.truncated
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load UNS registry mirror'
    loadError.value = msg
    push(msg, 'error')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">UNS registry mirror</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">
          Read-only validation of the additive registry projection (<code class="rounded bg-slate-800 px-1 text-xs">MIRRORED_FROM_LEGACY</code>).
          Compares counts and rows with the legacy UNS world; no cutover — existing UNS screens and APIs stay on legacy
          structures.
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        :disabled="busy"
        @click="refresh"
      >
        {{ busy ? 'Loading…' : 'Refresh' }}
      </button>
    </div>

    <p v-if="loadError" class="rounded-lg border border-rose-800/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
      {{ loadError }}
    </p>

    <!-- Summary cards -->
    <section v-if="summary" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Mirrored entities</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-white">{{ summary.counts.entities }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Mirrored topics</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-white">{{ summary.counts.topics }}</p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Registry source</p>
        <p class="mt-2">
          <span class="rounded-md bg-brand-900/60 px-2 py-1 font-mono text-xs text-brand-100">{{ summary.registrySource }}</span>
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Last mirrored</p>
        <p class="mt-1 text-sm text-slate-200">
          {{ summary.lastMirroredAt ? formatDateTime(summary.lastMirroredAt) : '—' }}
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Entities with parkId = null</p>
        <p class="mt-1 font-mono text-2xl font-semibold text-amber-200">{{ nullParkEntityCount }}</p>
        <p v-if="truncatedEntities" class="mt-1 text-xs text-amber-400/90">
          Count from first 10k rows loaded for this view; totals may be partial.
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Duplicate / skipped topic_path</p>
        <p class="mt-1 text-sm text-slate-400">{{ DUPLICATE_TOPIC_LABEL }}</p>
        <p class="mt-1 text-xs text-slate-500">Not exposed by the mirror API; backend may skip duplicates on insert.</p>
      </div>
    </section>

    <!-- Phase diagram -->
    <section class="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <h2 class="text-sm font-semibold text-slate-200">Current phase (no cutover)</h2>
      <pre class="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-slate-300"><code>Legacy UNS (uns_nodes, MDM)
        │
        ▼  read-only projection
Registry mirror tables (MIRRORED_FROM_LEGACY)
        │
        ▼  GET /api/v1/uns-registry/*
This validation view (admin)</code></pre>
    </section>

    <!-- Risk panel -->
    <section class="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4">
      <h2 class="text-sm font-semibold text-amber-100">Risk &amp; limitations</h2>
      <ul class="mt-2 list-inside list-disc space-y-1.5 text-sm text-amber-100/90">
        <li>
          Some mirrored rows have <code class="rounded bg-black/30 px-1">parkId = null</code> when legacy UNS uses slug or
          non-UUID park keys instead of platform UUIDs.
        </li>
        <li>
          Duplicate <code class="rounded bg-black/30 px-1">topic_path</code> values can be skipped by the unique registry
          constraint; the mirror is not a full 1:1 topic ledger.
        </li>
        <li>Ride signal capabilities are not yet semantically configured; the mirror is read-only and not authoritative.</li>
        <li>Existing <code class="rounded bg-black/30 px-1">/uns</code> APIs and dashboards still use legacy structures.</li>
      </ul>
    </section>

    <!-- Entity table -->
    <section class="space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <h2 class="w-full font-display text-lg font-semibold text-white sm:w-auto">Mirrored entities</h2>
        <label class="text-xs text-slate-500">
          Park ID
          <input
            v-model="fEntityParkId"
            type="text"
            placeholder="UUID"
            class="mt-1 block w-52 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          Entity type
          <input
            v-model="fEntityKind"
            type="text"
            placeholder="e.g. UNS_NODE"
            class="mt-1 block w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          Domain
          <input
            v-model="fEntityDomain"
            type="text"
            class="mt-1 block w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          Legacy table
          <input
            v-model="fEntityLegacyTable"
            type="text"
            placeholder="uns_nodes"
            class="mt-1 block w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input v-model="fEntityMissingParkOnly" type="checkbox" class="rounded border-slate-600" />
          Only missing parkId
        </label>
      </div>
      <p class="text-xs text-slate-500">
        Showing {{ filteredEntities.length }} of {{ entityAll.length }} loaded rows
        <span v-if="truncatedEntities">(entity list capped at 10k for UI)</span>
      </p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">Name</th>
              <th class="px-3 py-2">Entity type</th>
              <th class="px-3 py-2">Domain</th>
              <th class="px-3 py-2">Park ID</th>
              <th class="px-3 py-2">Legacy table</th>
              <th class="px-3 py-2">Legacy ID</th>
              <th class="px-3 py-2">Source</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Mirrored at</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !filteredEntities.length">
              <td colspan="9" class="px-3 py-8 text-center text-slate-500">No entities match filters.</td>
            </tr>
            <tr
              v-for="row in filteredEntities"
              :key="row.id"
              class="border-t border-slate-800/90 hover:bg-slate-900/40"
            >
              <td class="max-w-[14rem] truncate px-3 py-2 text-slate-100" :title="row.name || ''">{{ row.name || '—' }}</td>
              <td class="px-3 py-2">
                <span class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs">{{ row.entityKind }}</span>
              </td>
              <td class="px-3 py-2 font-mono text-xs text-slate-400">{{ entityDomain(row) }}</td>
              <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-xs" :title="row.parkId || ''">
                {{ row.parkId || '—' }}
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ row.legacyTable }}</td>
              <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-xs" :title="row.legacyId">{{ row.legacyId }}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-400">{{ row.registrySource }}</td>
              <td class="px-3 py-2">
                <span
                  class="rounded px-1.5 py-0.5 text-xs"
                  :class="
                    entityStatus(row) === 'OK'
                      ? 'bg-emerald-950/80 text-emerald-200'
                      : 'bg-amber-950/80 text-amber-200'
                  "
                >
                  {{ entityStatus(row) }}
                </span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.mirroredAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Topic table -->
    <section class="space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <h2 class="w-full font-display text-lg font-semibold text-white sm:w-auto">Mirrored topics</h2>
        <label class="text-xs text-slate-500">
          Park ID
          <input
            v-model="fTopicParkId"
            type="text"
            placeholder="UUID"
            class="mt-1 block w-52 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          Signal key (metric)
          <input
            v-model="fTopicSignalKey"
            type="text"
            class="mt-1 block w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          />
        </label>
        <label class="text-xs text-slate-500">
          Source type
          <select
            v-model="fTopicSourceType"
            class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          >
            <option value="all">All</option>
            <option value="mirrored">Mirrored source</option>
            <option value="uns_node">With UNS node id</option>
          </select>
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input v-model="fTopicMissingParkOnly" type="checkbox" class="rounded border-slate-600" />
          Only without parkId
        </label>
      </div>
      <p class="text-xs text-slate-500">
        Showing {{ filteredTopics.length }} of {{ topicAll.length }} loaded rows
        <span v-if="truncatedTopics">(topic list capped at 10k for UI)</span>
      </p>
      <div class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="min-w-full text-left text-sm text-slate-200">
          <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th class="px-3 py-2">Topic path</th>
              <th class="px-3 py-2">Signal key</th>
              <th class="px-3 py-2">Metric</th>
              <th class="px-3 py-2">Park ID</th>
              <th class="px-3 py-2">Entity ID</th>
              <th class="px-3 py-2">Source type</th>
              <th class="px-3 py-2">Is active</th>
              <th class="px-3 py-2">Mirrored at</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!busy && !filteredTopics.length">
              <td colspan="8" class="px-3 py-8 text-center text-slate-500">No topics match filters.</td>
            </tr>
            <tr
              v-for="row in filteredTopics"
              :key="row.id"
              class="border-t border-slate-800/90 hover:bg-slate-900/40"
            >
              <td class="max-w-md truncate px-3 py-2 font-mono text-xs text-brand-100" :title="row.topicPath">
                {{ row.topicPath }}
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ topicSignalKey(row) }}</td>
              <td class="px-3 py-2 font-mono text-xs text-slate-400">
                {{ typeof row.payloadJson?.metric === 'string' ? row.payloadJson.metric : topicSignalKey(row) }}
              </td>
              <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-xs" :title="row.parkId || ''">
                {{ row.parkId || '—' }}
              </td>
              <td class="max-w-[8rem] truncate px-3 py-2 font-mono text-xs" :title="row.registryEntityId || ''">
                {{ row.registryEntityId || '—' }}
              </td>
              <td class="px-3 py-2 text-xs text-slate-300">{{ topicSourceTypeLabel(row) }}</td>
              <td class="px-3 py-2 text-xs">{{ topicIsActive(row) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{{ formatDateTime(row.mirroredAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="busy && !summary" class="text-center text-sm text-slate-500">Loading mirror data…</p>
  </div>
</template>
