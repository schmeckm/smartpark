<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import {
  ApiRequestError,
  getPlatformParkZones,
  getPlatformParks,
  patchPlatformParkLevel0,
  type PlatformParkZoneRow,
} from '@/api/client'
import type { PlatformPark } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'

const { push } = useToast()
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const parkContext = useParkContextStore()

/** Leave editor: same-path RouterLink would no-op (this view IS `/diagnostics/sparkplug`). */
function closeSparkplugEdgesPage() {
  // Prefer previous screen (natural „close“). UNS-Governance is unrelated to Sparkplug config.
  const w = globalThis.window
  if (w && w.history.length > 1) {
    router.back()
    return
  }
  router.push('/').catch(() => {
    /* ignored: redundant navigation */
  })
}

const parks = ref<PlatformPark[]>([])
const parkZones = ref<PlatformParkZoneRow[]>([])
const busy = ref(false)
const zonesBusy = ref(false)
const sparkplugBusy = ref(false)
const detailParkId = ref('')

/** Select value for „Freitext“ — not a real zone slug, only UI. */
const ZONE_CUSTOM = '__custom__'

type SparkRole = 'PRIMARY' | 'ZONE' | 'VIRTUAL_LAB' | 'BACKUP' | 'OTHER'
type SparkEdgeForm = {
  id: string
  label: string
  edgeNodeId: string
  /** Persistiert (API): Zonen-`slug` oder eigener Schlüssel. */
  zoneKey: string
  /** Nur UI: `''` | Zonen-slug | `ZONE_CUSTOM`. */
  zonePicker: string
  role: SparkRole | ''
  notes: string
}
const sparkplugForm = ref({
  documentationNotes: '',
  defaultEdgeNodeId: '',
  edges: [] as SparkEdgeForm[],
})

const sparkRoleOptions: { value: SparkRole | ''; label: string }[] = [
  { value: '', label: '—' },
  { value: 'PRIMARY', label: 'Primär (Park-Gateway)' },
  { value: 'ZONE', label: 'Zone / Bereich' },
  { value: 'VIRTUAL_LAB', label: 'Virtuell / Labor' },
  { value: 'BACKUP', label: 'Backup / redundant' },
  { value: 'OTHER', label: 'Sonstiges' },
]

function newSparkEdgeId() {
  return globalThis.crypto?.randomUUID?.() ?? `e_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

/** Liest String aus API-Objekt (camelCase oder snake_case). */
function sparkRecordStr(obj: Record<string, unknown>, camelKey: string): string {
  const snakeKey = camelKey.replace(/[A-Z]/g, (m: string) => `_${m.toLowerCase()}`)
  const v = obj[camelKey] ?? obj[snakeKey]
  return v == null ? '' : String(v)
}

function readSparkplugFormFromPark(p: PlatformPark | null) {
  const raw =
    p?.masterProfile && typeof p.masterProfile === 'object'
      ? (p.masterProfile as { sparkplug?: Record<string, unknown> }).sparkplug
      : undefined
  if (!raw || typeof raw !== 'object') {
    sparkplugForm.value = { documentationNotes: '', defaultEdgeNodeId: '', edges: [] }
    return
  }
  const list = Array.isArray(raw.edges) ? raw.edges : []
  const roles = new Set(['PRIMARY', 'ZONE', 'VIRTUAL_LAB', 'BACKUP', 'OTHER'])
  sparkplugForm.value = {
    documentationNotes: sparkRecordStr(raw, 'documentationNotes'),
    defaultEdgeNodeId: sparkRecordStr(raw, 'defaultEdgeNodeId'),
    edges: list.map((row: unknown) => {
      const e = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
      const roleRaw = sparkRecordStr(e, 'role')
      const role = roleRaw && roles.has(roleRaw) ? (roleRaw as SparkRole) : ''
      return {
        id: typeof e.id === 'string' && e.id ? e.id : newSparkEdgeId(),
        label: sparkRecordStr(e, 'label'),
        edgeNodeId: sparkRecordStr(e, 'edgeNodeId'),
        zoneKey: sparkRecordStr(e, 'zoneKey'),
        zonePicker: '',
        role,
        notes: sparkRecordStr(e, 'notes'),
      }
    }),
  }
}

function resetSparkplugForm() {
  readSparkplugFormFromPark(selectedDetailPark.value)
  syncEdgeZonePickers()
}

function syncEdgeZonePickers() {
  const slugs = new Set(parkZones.value.map((z) => z.slug))
  for (const row of sparkplugForm.value.edges) {
    const k = row.zoneKey.trim()
    if (!k) row.zonePicker = ''
    else if (slugs.has(k)) row.zonePicker = k
    else row.zonePicker = ZONE_CUSTOM
  }
}

function onZonePickerChange(row: SparkEdgeForm, v: string) {
  const prevZoneKey = row.zoneKey.trim()
  const prevEdge = row.edgeNodeId.trim()
  row.zonePicker = v
  if (!v) {
    row.zoneKey = ''
    return
  }
  if (v === ZONE_CUSTOM) {
    if (parkZones.value.some((z) => z.slug === row.zoneKey.trim())) {
      row.zoneKey = ''
    }
    return
  }
  row.zoneKey = v
  /** Default edge segment from zone slug when empty or still tied to the previous zone key (broker IDs often match). */
  const slug = v.trim()
  if (slug && (!prevEdge || prevEdge === prevZoneKey)) {
    row.edgeNodeId = slug
  }
}

function addSparkEdgeRow() {
  sparkplugForm.value.edges.push({
    id: newSparkEdgeId(),
    label: '',
    edgeNodeId: '',
    zoneKey: '',
    zonePicker: '',
    role: '',
    notes: '',
  })
}

function removeSparkEdgeRow(id: string) {
  sparkplugForm.value.edges = sparkplugForm.value.edges.filter((e) => e.id !== id)
}

function asNullableText(v: string): string | null {
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}

function sparkEdgeRowIsBlank(e: SparkEdgeForm) {
  return (
    !e.edgeNodeId.trim() &&
    !e.label.trim() &&
    !e.zoneKey.trim() &&
    !e.notes.trim() &&
    !e.role
  )
}

function formatSaveError(e: unknown): string {
  if (e instanceof ApiRequestError && Array.isArray(e.details)) {
    const lines = e.details
      .map((d: { message?: string; path?: string }) => [d.path, d.message].filter(Boolean).join(': '))
      .filter(Boolean)
    if (lines.length) return lines.join(' · ')
    return e.message
  }
  return e instanceof Error ? e.message : t('diagnostics.sparkplug.saveFailedGeneric')
}

async function saveSparkplug() {
  const parkId = detailParkId.value.trim()
  if (!parkId) {
    push(t('diagnostics.sparkplug.errSelectParkFirst'), 'error')
    return
  }
  if (!canEditLevel0.value) {
    push(t('diagnostics.sparkplug.errRidesUpdateRequired'), 'error')
    return
  }
  const defaultEdge = sparkplugForm.value.defaultEdgeNodeId.trim()
  const rows = sparkplugForm.value.edges.filter((e) => !sparkEdgeRowIsBlank(e))
  for (const e of rows) {
    const resolvedEdge = e.edgeNodeId.trim() || defaultEdge
    if (!resolvedEdge) {
      push(t('diagnostics.sparkplug.errRowNeedsEdgeOrDefault'), 'error')
      return
    }
  }
  sparkplugBusy.value = true
  try {
    const edges = rows.map((e) => ({
      id: e.id,
      label: asNullableText(e.label),
      edgeNodeId: e.edgeNodeId.trim() || defaultEdge,
      zoneKey: asNullableText(e.zoneKey),
      role: e.role ? e.role : undefined,
      notes: asNullableText(e.notes),
    }))
    const updated = await patchPlatformParkLevel0(
      parkId,
      {
        sparkplug: {
          documentationNotes: asNullableText(sparkplugForm.value.documentationNotes),
          defaultEdgeNodeId: asNullableText(sparkplugForm.value.defaultEdgeNodeId),
          edges,
        },
      },
      { headers: { 'X-Park-Id': parkId } }
    )
    parks.value = parks.value.map((p) => (p.id === updated.id ? updated : p))
    readSparkplugFormFromPark(updated)
    syncEdgeZonePickers()
    push(t('diagnostics.sparkplug.saveSuccess'), 'success')
  } catch (e) {
    push(formatSaveError(e), 'error')
  } finally {
    sparkplugBusy.value = false
  }
}

const selectedDetailPark = computed(() => parks.value.find((p) => p.id === detailParkId.value) ?? null)
const canEditLevel0 = computed(() => auth.hasPermission('rides', 'update'))
const formDisabled = computed(() => !canEditLevel0.value || sparkplugBusy.value)

/** Rows currently shown in the editor (matches what Save will consider). */
const sparkplugEdgeRowCount = computed(() => sparkplugForm.value.edges.length)

const sortedParkZones = computed(() =>
  [...parkZones.value].sort((a, b) => {
    const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    return so !== 0 ? so : a.name.localeCompare(b.name, 'de')
  })
)

function pickDefaultParkId(list: PlatformPark[]): string {
  const pref = parkContext.activeParkId
  if (pref && list.some((p) => p.id === pref)) return pref
  return list[0]?.id ?? ''
}

async function load() {
  busy.value = true
  try {
    const p = await getPlatformParks()
    parks.value = p
    if (!detailParkId.value || !p.some((x) => x.id === detailParkId.value)) {
      detailParkId.value = pickDefaultParkId(p)
    }
  } catch (e) {
    push(e instanceof Error ? e.message : t('diagnostics.sparkplug.loadFailed'), 'error')
  } finally {
    busy.value = false
  }
}

async function loadParkZones(parkId: string) {
  if (!parkId) {
    parkZones.value = []
    return
  }
  zonesBusy.value = true
  try {
    parkZones.value = await getPlatformParkZones(parkId)
  } catch (e) {
    parkZones.value = []
    push(e instanceof Error ? e.message : t('diagnostics.sparkplug.zonesLoadFailed'), 'error')
  } finally {
    zonesBusy.value = false
  }
}

onMounted(() => void load())

watch(
  detailParkId,
  async (id) => {
    if (!id) {
      parkZones.value = []
      return
    }
    readSparkplugFormFromPark(parks.value.find((p) => p.id === id) ?? null)
    await loadParkZones(id)
    syncEdgeZonePickers()
  },
  { immediate: true }
)
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <nav class="text-xs text-slate-500">
      <span class="text-slate-500">{{ t('nav.section.diagnostics') }}</span>
      <span class="mx-1">/</span>
      <span class="text-slate-400">{{ t('diagnostics.sparkplug.title') }}</span>
    </nav>
    <h1 class="font-display text-xl font-semibold text-white">{{ t('diagnostics.sparkplug.title') }}</h1>
    <p class="text-sm text-slate-400">
      {{ t('diagnostics.sparkplug.intro') }}
      <RouterLink to="/platform/parks" class="text-brand-400 hover:underline">{{
        t('diagnostics.sparkplug.parkExplorerLink')
      }}</RouterLink>.
    </p>

    <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label for="sp-park-select" class="block text-xs font-medium text-slate-400">{{ t('diagnostics.sparkplug.parkLabel') }}</label>
      <select
        id="sp-park-select"
        v-model="detailParkId"
        class="mt-1 w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        :disabled="busy"
      >
        <option disabled value="">{{ t('diagnostics.sparkplug.parkPlaceholder') }}</option>
        <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }} ({{ p.slug }})</option>
      </select>

      <template v-if="detailParkId">
        <div class="mt-6 border-t border-slate-800 pt-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-sm font-medium text-white">{{ t('diagnostics.sparkplug.sectionTitle') }}</h2>
              <p class="mt-1 text-xs text-slate-500">
                {{ t('diagnostics.sparkplug.topicHint', { count: sparkplugEdgeRowCount }) }}
              </p>
            </div>
          </div>

          <p v-if="!canEditLevel0" class="mt-2 text-xs text-amber-500/90">{{ t('diagnostics.sparkplug.readOnly') }}</p>

          <label class="mt-4 block text-xs text-slate-400">
            {{ t('diagnostics.sparkplug.defaultEdgeLabel') }}
            <span class="mt-0.5 block text-[11px] font-normal text-slate-500">{{ t('diagnostics.sparkplug.defaultEdgeHint') }}</span>
            <input
              v-model="sparkplugForm.defaultEdgeNodeId"
              placeholder="park_gateway"
              :disabled="formDisabled"
              class="mt-1 w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label class="mt-3 block text-xs text-slate-400">
            {{ t('diagnostics.sparkplug.notesLabel') }}
            <textarea
              v-model="sparkplugForm.documentationNotes"
              rows="3"
              :placeholder="t('diagnostics.sparkplug.notesPlaceholder')"
              :disabled="formDisabled"
              class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-medium text-slate-300">{{ t('diagnostics.sparkplug.nodeListTitle') }}</span>
            <button
              type="button"
              class="rounded border border-brand-600/50 bg-brand-600/10 px-2 py-1 text-xs font-medium text-brand-100 hover:bg-brand-600/20 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="formDisabled"
              @click="addSparkEdgeRow"
            >
              {{ t('diagnostics.sparkplug.addRow') }}
            </button>
          </div>
          <ul class="mt-2 list-inside list-disc space-y-1 text-[11px] leading-relaxed text-slate-500">
            <li>{{ t('diagnostics.sparkplug.helpRole') }}</li>
            <li>{{ t('diagnostics.sparkplug.helpRows') }}</li>
            <li>
              {{ t('diagnostics.sparkplug.helpZone') }}
              <template v-if="zonesBusy"> {{ t('diagnostics.sparkplug.zonesLoading') }}</template>
            </li>
          </ul>
          <div class="mt-2 overflow-x-auto rounded-lg border border-slate-800">
            <table class="w-full min-w-[720px] text-left text-xs text-slate-300">
              <thead class="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-2 py-2">Label</th>
                  <th class="px-2 py-2 font-mono">edge_node_id</th>
                  <th class="px-2 py-2">Zone</th>
                  <th class="px-2 py-2">Rolle</th>
                  <th class="px-2 py-2">Notiz</th>
                  <th class="min-w-[5.5rem] px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in sparkplugForm.edges" :key="e.id" class="border-b border-slate-800/80 align-top odd:bg-slate-900/20">
                  <td class="px-2 py-1.5">
                    <input
                      v-model="e.label"
                      :disabled="formDisabled"
                      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="OPC Parktor"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="e.edgeNodeId"
                      :disabled="formDisabled"
                      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="park_gateway"
                    />
                  </td>
                  <td class="px-2 py-1.5 space-y-1">
                    <select
                      :value="e.zonePicker"
                      :disabled="formDisabled || zonesBusy"
                      class="w-full min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                      @change="onZonePickerChange(e, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">— keine Zone</option>
                      <option v-for="z in sortedParkZones" :key="z.id" :value="z.slug">
                        {{ z.name }} ({{ z.slug }})
                      </option>
                      <option :value="ZONE_CUSTOM">Sonstiges (Freitext)</option>
                    </select>
                    <input
                      v-if="e.zonePicker === ZONE_CUSTOM"
                      v-model="e.zoneKey"
                      :disabled="formDisabled"
                      class="w-full rounded border border-dashed border-slate-600 bg-slate-950 px-2 py-1 font-mono text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="z. B. lab_gateway_01"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <select
                      v-model="e.role"
                      :disabled="formDisabled"
                      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option v-for="opt in sparkRoleOptions" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option>
                    </select>
                  </td>
                  <td class="px-2 py-1.5">
                    <input
                      v-model="e.notes"
                      :disabled="formDisabled"
                      class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="optional"
                    />
                  </td>
                  <td class="px-2 py-1.5">
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-[11px] text-rose-400/90 hover:bg-slate-800 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                      :disabled="formDisabled"
                      @click="removeSparkEdgeRow(e.id)"
                    >
                      Entfernen
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="!sparkplugForm.edges.length" class="px-3 py-6 text-center text-slate-500">
              {{ t('diagnostics.sparkplug.emptyRowsHint') }}
            </p>
          </div>

          <div class="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-800/80 pt-4">
            <button
              type="button"
              class="rounded-lg border border-slate-600/70 bg-slate-900/60 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800/80"
              @click="closeSparkplugEdgesPage"
            >
              {{ t('diagnostics.sparkplug.close') }}
            </button>
            <button
              type="button"
              class="rounded-lg border border-brand-600/50 bg-brand-600/10 px-4 py-2 text-sm font-medium text-brand-100 hover:bg-brand-600/20 disabled:opacity-40"
              :disabled="sparkplugBusy || !detailParkId"
              :title="t('diagnostics.sparkplug.cancelTitle')"
              @click="resetSparkplugForm"
            >
              {{ t('diagnostics.sparkplug.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-brand-500 disabled:opacity-40"
              :disabled="sparkplugBusy || !detailParkId || !canEditLevel0"
              @click="saveSparkplug"
            >
              {{ sparkplugBusy ? t('diagnostics.sparkplug.saving') : t('diagnostics.sparkplug.save') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
