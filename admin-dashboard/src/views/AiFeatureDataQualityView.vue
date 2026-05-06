<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  bulkDeleteAiParkFeatureSnapshots,
  deleteAiParkFeatureSnapshot,
  getAiFeatureDataQualityDashboard,
  purgeAiParkFeatureSnapshots,
  type AiFeatureDataQualityDashboard,
  type AiFeatureDataQualityLowConfRow,
} from '@/api/client'
import { askConfirm } from '@/composables/useConfirmDialog'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const { formatDateTime } = useRegionalDateTime()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const parkCtx = useParkContextStore()

const canAiRefresh = computed(() => auth.hasPermission('ai', 'refresh'))
const deletingParkSnapshotId = ref<string | null>(null)
const purgingParkSnapshots = ref(false)
const bulkDeletingParkSnapshots = ref(false)
const selectedParkSnapshotIds = ref<string[]>([])
const selectAllParkCheckboxRef = ref<HTMLInputElement | null>(null)

/** Declared before computeds/watchers that read `parkFeatureRows` → `data`. */
const data = ref<AiFeatureDataQualityDashboard | null>(null)

const parkFeatureRows = computed(() => data.value?.parkFeatureQuality ?? [])

const selectedParkSnapshotIdSet = computed(() => new Set(selectedParkSnapshotIds.value))

const allParkSnapshotRowsSelected = computed(() => {
  const rows = parkFeatureRows.value
  if (!rows.length) return false
  const sel = selectedParkSnapshotIdSet.value
  return rows.every((r) => sel.has(r.id))
})

const someParkSnapshotRowsSelected = computed(() => {
  const rows = parkFeatureRows.value
  if (!rows.length) return false
  const sel = selectedParkSnapshotIdSet.value
  const n = rows.filter((r) => sel.has(r.id)).length
  return n > 0 && n < rows.length
})

function toggleParkSnapshotRowSelection(id: string, checked: boolean) {
  const s = new Set(selectedParkSnapshotIds.value)
  if (checked) s.add(id)
  else s.delete(id)
  selectedParkSnapshotIds.value = [...s]
}

function toggleSelectAllParkSnapshots(checked: boolean) {
  if (checked) {
    selectedParkSnapshotIds.value = parkFeatureRows.value.map((r) => r.id)
  } else {
    selectedParkSnapshotIds.value = []
  }
}

watch(parkFeatureRows, (rows) => {
  const ok = new Set(rows.map((r) => r.id))
  selectedParkSnapshotIds.value = selectedParkSnapshotIds.value.filter((id) => ok.has(id))
})

watch([allParkSnapshotRowsSelected, someParkSnapshotRowsSelected], () => {
  nextTick(() => {
    const el = selectAllParkCheckboxRef.value
    if (el) el.indeterminate = someParkSnapshotRowsSelected.value
  })
})

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Deep-links from AI Studio (30d park snapshot KPI) with ?from=&to= ISO. */
function applyTimeRangeFromRouteQuery(): boolean {
  const qf = route.query.from
  const qt = route.query.to
  const fs = Array.isArray(qf) ? qf[0] : qf
  const ts = Array.isArray(qt) ? qt[0] : qt
  if (typeof fs !== 'string' || typeof ts !== 'string' || !fs.trim() || !ts.trim()) return false
  const fl = isoToDatetimeLocal(fs)
  const tl = isoToDatetimeLocal(ts)
  if (!fl || !tl) return false
  fromLocal.value = fl
  toLocal.value = tl
  return true
}

const loading = ref(false)
const loadError = ref(false)

const entityType = ref('')
const missingFeature = ref('')
const completenessMax = ref<string>('')
const confidenceMax = ref('0.45')
const fromLocal = ref('')
const toLocal = ref('')

const activeParkName = computed(() => {
  const id = parkCtx.activeParkId
  if (!id) return ''
  return parkCtx.parks.find((p) => p.id === id)?.name || id
})

function toIsoFromLocal(dt: string): string | undefined {
  if (!dt?.trim()) return undefined
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return undefined
  /** datetime-local is interpreted as local time; ISO string is UTC for the API. */
  return d.toISOString()
}

function activeWindowIsoRange(): { from: string; to: string } | null {
  const a = toIsoFromLocal(fromLocal.value)
  const b = toIsoFromLocal(toLocal.value)
  if (a && b) return { from: a, to: b }
  const r = data.value?.range
  if (r?.from && r?.to) return { from: r.from, to: r.to }
  return null
}

async function onDeleteParkSnapshotRow(id: string) {
  if (!canAiRefresh.value) return
  const ok = await askConfirm({
    message: t('aiDq.deleteParkSnapshotConfirm'),
    variant: 'danger',
    confirmLabel: t('btn.delete'),
    cancelLabel: t('btn.cancel'),
  })
  if (!ok) return
  deletingParkSnapshotId.value = id
  try {
    await deleteAiParkFeatureSnapshot(id)
    push(t('aiDq.deleteParkSnapshotOk'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('aiDq.deleteParkSnapshotFail'), 'error')
  } finally {
    deletingParkSnapshotId.value = null
  }
}

async function onBulkDeleteSelectedParkSnapshots() {
  if (!canAiRefresh.value) return
  const ids = selectedParkSnapshotIds.value
  if (!ids.length) return
  const ok = await askConfirm({
    message: t('aiDq.bulkDeleteParkSnapshotsConfirm', { n: ids.length }),
    variant: 'danger',
    confirmLabel: t('aiDq.bulkDeleteConfirmBtn'),
    cancelLabel: t('btn.cancel'),
  })
  if (!ok) return
  bulkDeletingParkSnapshots.value = true
  try {
    const r = await bulkDeleteAiParkFeatureSnapshots({ ids })
    if (r.deleted < r.requested) {
      push(t('aiDq.bulkDeleteParkSnapshotsPartial', { deleted: r.deleted, requested: r.requested }), 'info')
    } else {
      push(t('aiDq.bulkDeleteParkSnapshotsOk', { n: r.deleted }), 'success')
    }
    selectedParkSnapshotIds.value = []
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('aiDq.bulkDeleteParkSnapshotsFail'), 'error')
  } finally {
    bulkDeletingParkSnapshots.value = false
  }
}

async function onPurgeParkSnapshotsInWindow() {
  if (!canAiRefresh.value) return
  const win = activeWindowIsoRange()
  if (!win) {
    push(t('aiDq.purgeNeedRange'), 'error')
    return
  }
  const ok = await askConfirm({
    title: t('aiDq.purgeDialogTitle'),
    message: t('aiDq.purgeParkSnapshotsWarn'),
    variant: 'danger',
    mustMatch: 'DELETE',
    mustMatchHint: t('aiDq.purgeParkSnapshotsType'),
    confirmLabel: t('aiDq.purgeConfirmBtn'),
    cancelLabel: t('btn.cancel'),
  })
  if (!ok) return
  purgingParkSnapshots.value = true
  try {
    const r = await purgeAiParkFeatureSnapshots(win)
    push(t('aiDq.purgeParkSnapshotsOk', { n: r.deleted }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('aiDq.purgeParkSnapshotsFail'), 'error')
  } finally {
    purgingParkSnapshots.value = false
  }
}

function formatConfidenceCell(r: AiFeatureDataQualityLowConfRow): string {
  const c = r.confidence
  const n = c == null ? NaN : Number(c)
  if (!Number.isFinite(n)) return `— (${r.confidenceLevel ?? '—'})`
  const lv = r.confidenceLevel != null ? String(r.confidenceLevel) : '—'
  return `${n.toFixed(3)} (${lv})`
}

async function load() {
  if (!parkCtx.activeParkId) {
    data.value = null
    loadError.value = false
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const cm = completenessMax.value.trim()
    const cf = confidenceMax.value.trim()
    data.value = await getAiFeatureDataQualityDashboard({
      from: toIsoFromLocal(fromLocal.value),
      to: toIsoFromLocal(toLocal.value),
      entityType: entityType.value || undefined,
      completenessMax: cm !== '' && Number.isFinite(Number(cm)) ? Number(cm) : undefined,
      missingFeature: missingFeature.value || undefined,
      confidenceMax: cf !== '' && Number.isFinite(Number(cf)) ? Number(cf) : undefined,
    })
  } catch (e) {
    data.value = null
    loadError.value = true
    push(e instanceof Error ? e.message : t('aiDq.loadError'), 'error')
  } finally {
    loading.value = false
  }
  if (data.value && route.hash === '#park-snapshots') {
    await nextTick()
    requestAnimationFrame(() => {
      document.getElementById('park-snapshots')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

watch(
  () => parkCtx.activeParkId,
  () => {
    selectedParkSnapshotIds.value = []
    void load()
  }
)

watch(
  () => [route.query.from, route.query.to],
  () => {
    if (applyTimeRangeFromRouteQuery()) void load()
  }
)

onMounted(() => {
  applyTimeRangeFromRouteQuery()
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiMl.back') }}</RouterLink>
    <h1 :class="ui.title">{{ t('aiDq.title') }}</h1>
    <p :class="ui.subtitle">{{ t('aiDq.subtitle') }}</p>

    <div v-if="!parkCtx.activeParkId" :class="ui.card" class="text-amber-600">{{ t('aiMl.needPark') }}</div>

    <template v-else>
      <div :class="ui.card" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <div class="sm:col-span-2 lg:col-span-2">
          <label class="mb-1 block text-xs font-medium text-slate-400">{{ t('aiDq.filterPark') }}</label>
          <p class="rounded border border-slate-700 bg-slate-950/50 px-2 py-2 text-sm text-slate-200">{{ activeParkName }}</p>
          <p class="mt-1 text-[11px] text-slate-500">{{ t('aiDq.filterParkHint') }}</p>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="dq-et">{{ t('aiDq.filterEntity') }}</label>
          <select id="dq-et" v-model="entityType" class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white">
            <option value="">{{ t('aiDq.allEntities') }}</option>
            <option value="RIDE">{{ t('aiDq.entityRide') }}</option>
            <option value="SHOW">{{ t('aiDq.entityShow') }}</option>
            <option value="RESTAURANT">{{ t('aiDq.entityRestaurant') }}</option>
            <option value="SHOP">{{ t('aiDq.entityShop') }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="dq-from">{{ t('aiDq.filterFrom') }}</label>
          <input id="dq-from" v-model="fromLocal" type="datetime-local" class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="dq-to">{{ t('aiDq.filterTo') }}</label>
          <input id="dq-to" v-model="toLocal" type="datetime-local" class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="dq-comp">{{ t('aiDq.filterCompleteness') }}</label>
          <input
            id="dq-comp"
            v-model="completenessMax"
            type="number"
            min="0"
            max="1"
            step="0.05"
            class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
            :placeholder="t('aiDq.filterCompletenessPh')"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="dq-miss">{{ t('aiDq.filterMissing') }}</label>
          <select id="dq-miss" v-model="missingFeature" class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white">
            <option value="">{{ t('aiDq.missingAny') }}</option>
            <option value="weather">{{ t('aiDq.missingWeather') }}</option>
            <option value="calendar">{{ t('aiDq.missingCalendar') }}</option>
            <option value="traffic">{{ t('aiDq.missingTraffic') }}</option>
            <option value="staffing">{{ t('aiDq.missingStaffing') }}</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-slate-400" for="dq-conf">{{ t('aiDq.filterConfidence') }}</label>
          <input id="dq-conf" v-model="confidenceMax" type="number" min="0" max="1" step="0.05" class="w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white" />
        </div>
        <div class="flex items-end gap-2 sm:col-span-2">
          <button
            type="button"
            class="rounded-md bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            :disabled="loading"
            @click="load()"
          >
            {{ t('aiDq.apply') }}
          </button>
          <RouterLink to="/ai-insights/feature-store-monitor" class="text-xs text-slate-400 hover:text-brand-300">{{ t('aiDq.linkMonitor') }}</RouterLink>
        </div>
      </div>

      <div v-if="loadError && !loading" :class="ui.card" class="text-rose-300">{{ t('aiDq.loadError') }}</div>
      <p v-else-if="loading" :class="ui.muted" class="text-sm">{{ t('aiDq.loading') }}</p>

      <template v-if="data">
        <p class="text-[11px] text-slate-500">{{ t('aiDq.kpiCountsHint') }}</p>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiFreshness') }}</p>
          <p class="mt-1 text-lg font-semibold text-white">{{ data.kpis.snapshotFreshnessOk ? '✓' : '—' }}</p>
          <p class="mt-1 text-[11px] text-slate-500">
            {{ data.kpis.latestParkSnapshotAt ? formatDateTime(data.kpis.latestParkSnapshotAt) : '—' }}
          </p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiAvgCompleteness') }}</p>
          <p class="mt-1 text-lg font-semibold text-white">
            {{ data.kpis.avgCompletenessScore != null ? data.kpis.avgCompletenessScore.toFixed(3) : '—' }}
          </p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiNoMl') }}</p>
          <p class="mt-1 text-lg font-semibold text-amber-200">{{ data.kpis.assetsWithoutMlProfile }}</p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiMissWeather') }}</p>
          <p class="mt-1 text-sm text-slate-200">{{ data.kpis.snapshotsMissingWeatherCount }}</p>
          <p class="text-[11px] text-slate-500">{{ t('aiDq.kpiLatest') }}: {{ data.kpis.missingWeatherLatest ? t('aiDq.statusWarn') : t('aiDq.statusOk') }}</p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiMissCalendar') }}</p>
          <p class="mt-1 text-sm text-slate-200">{{ data.kpis.snapshotsMissingCalendarCount }}</p>
          <p class="text-[11px] text-slate-500">{{ t('aiDq.kpiLatest') }}: {{ data.kpis.missingCalendarLatest ? t('aiDq.statusWarn') : t('aiDq.statusOk') }}</p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiMissTraffic') }}</p>
          <p class="mt-1 text-sm text-slate-200">{{ data.kpis.snapshotsMissingTrafficCount }}</p>
          <p class="text-[11px] text-slate-500">{{ t('aiDq.kpiLatest') }}: {{ data.kpis.missingTrafficLatest ? t('aiDq.statusWarn') : t('aiDq.statusOk') }}</p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiMissStaffing') }}</p>
          <p class="mt-1 text-lg font-semibold text-slate-100">{{ data.kpis.snapshotsMissingStaffingCount }}</p>
          <p class="text-[11px] text-slate-500">{{ t('aiDq.kpiStaffingHint') }}</p>
        </div>
        <div :class="ui.card" class="p-4">
          <p class="text-xs text-slate-500">{{ t('aiDq.kpiLowConf') }}</p>
          <p class="mt-1 text-lg font-semibold text-rose-200">{{ data.kpis.lowConfidenceForecastCount }}</p>
        </div>
      </div>

      <section v-if="data" id="park-snapshots" class="scroll-mt-24 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-slate-200">{{ t('aiDq.tablePark') }}</h2>
          <div v-if="canAiRefresh" class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-rose-700/80 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-950/55 disabled:opacity-50"
              :disabled="
                !selectedParkSnapshotIds.length || bulkDeletingParkSnapshots || loading || purgingParkSnapshots
              "
              @click="onBulkDeleteSelectedParkSnapshots()"
            >
              {{ t('aiDq.bulkDeleteSelectedBtn', { n: selectedParkSnapshotIds.length }) }}
            </button>
            <button
              type="button"
              class="rounded-md border border-rose-800/80 bg-rose-950/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-950/70 disabled:opacity-50"
              :disabled="purgingParkSnapshots || bulkDeletingParkSnapshots || loading"
              @click="onPurgeParkSnapshotsInWindow()"
            >
              {{ t('aiDq.purgeParkSnapshotsBtn') }}
            </button>
          </div>
        </div>
        <p v-if="canAiRefresh" class="text-[11px] text-slate-500">{{ t('aiDq.adminDeleteHint') }}</p>
        <div :class="ui.card" class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr :class="ui.muted">
                <th v-if="canAiRefresh" class="w-10 py-2 pr-2">
                  <input
                    ref="selectAllParkCheckboxRef"
                    type="checkbox"
                    class="accent-brand-500"
                    :checked="allParkSnapshotRowsSelected"
                    :disabled="!parkFeatureRows.length || loading || bulkDeletingParkSnapshots"
                    :aria-label="t('aiDq.selectAllParkSnapshots')"
                    @change="
                      toggleSelectAllParkSnapshots(($event.target as HTMLInputElement).checked)
                    "
                  />
                </th>
                <th class="py-2 pr-2">{{ t('aiDq.colTime') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colCompleteness') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colWeather') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colTraffic') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colHints') }}</th>
                <th v-if="canAiRefresh" class="py-2 pr-2 text-right">{{ t('aiDq.colActions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.parkFeatureQuality" :key="row.id" class="border-t border-slate-700/50">
                <td v-if="canAiRefresh" class="py-2 pr-2">
                  <input
                    type="checkbox"
                    class="accent-brand-500"
                    :checked="selectedParkSnapshotIdSet.has(row.id)"
                    :disabled="loading || bulkDeletingParkSnapshots"
                    @change="
                      toggleParkSnapshotRowSelection(row.id, ($event.target as HTMLInputElement).checked)
                    "
                  />
                </td>
                <td class="py-2 pr-2 text-[11px] text-slate-200">{{ formatDateTime(row.snapshotAt) }}</td>
                <td class="py-2 pr-2">{{ row.completenessScore ?? '—' }}</td>
                <td class="py-2 pr-2">{{ row.temperatureC ?? '—' }} / {{ row.precipitationMm ?? '—' }}</td>
                <td class="py-2 pr-2">{{ row.trafficIndex ?? '—' }}</td>
                <td class="py-2 pr-2 text-amber-200/90">{{ row.featureDataQuality?.join('; ') || '—' }}</td>
                <td v-if="canAiRefresh" class="py-2 pr-2 text-right">
                  <button
                    type="button"
                    class="text-rose-400 hover:text-rose-300 disabled:opacity-40"
                    :disabled="deletingParkSnapshotId === row.id || loading || bulkDeletingParkSnapshots"
                    :title="t('aiDq.deleteParkSnapshotAria')"
                    @click="onDeleteParkSnapshotRow(row.id)"
                  >
                    {{ t('aiDq.deleteParkSnapshotBtn') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.parkFeatureQuality.length" :class="ui.muted" class="p-2">{{ t('aiMl.empty') }}</p>
        </div>
      </section>

      <section v-if="data" class="space-y-2">
        <h2 class="text-sm font-semibold text-slate-200">{{ t('aiDq.tableRide') }}</h2>
        <div :class="ui.card" class="overflow-x-auto">
          <table class="w-full min-w-[960px] text-left text-xs">
            <thead>
              <tr :class="ui.muted">
                <th class="py-2 pr-2">{{ t('aiDq.colTime') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colExtId') }}</th>
                <th class="py-2 pr-2">{{ t('aiMl.colEntity') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colCompleteness') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colStaffing') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colMlCode') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colHints') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in data.rideFeatureQuality" :key="row.id" class="border-t border-slate-700/50">
                <td class="py-2 pr-2 text-[11px] text-slate-200">{{ formatDateTime(row.snapshotAt) }}</td>
                <td class="py-2 pr-2 font-mono">{{ row.externalEntityId }}</td>
                <td class="py-2 pr-2">{{ row.entityType }}</td>
                <td class="py-2 pr-2">{{ row.completenessScore ?? '—' }}</td>
                <td class="py-2 pr-2">{{ row.staffingGapNormal ?? '—' }}</td>
                <td class="py-2 pr-2 font-mono">{{ row.mlProfileCode ?? '—' }}</td>
                <td class="py-2 pr-2 text-amber-200/90">{{ row.featureDataQuality?.join('; ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.rideFeatureQuality.length" :class="ui.muted" class="p-2">{{ t('aiMl.empty') }}</p>
        </div>
      </section>

      <section v-if="data" class="space-y-2">
        <h2 class="text-sm font-semibold text-slate-200">{{ t('aiDq.tableNoMl') }}</h2>
        <div :class="ui.card" class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr :class="ui.muted">
                <th class="py-2 pr-2">{{ t('aiDq.colName') }}</th>
                <th class="py-2 pr-2">{{ t('aiMl.colEntity') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colExtId') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in data.assetsMissingMlProfile" :key="a.assetId" class="border-t border-slate-700/50">
                <td class="py-2 pr-2">{{ a.name }}</td>
                <td class="py-2 pr-2">{{ a.entityType ?? '—' }}</td>
                <td class="py-2 pr-2 font-mono">{{ a.externalEntityId ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.assetsMissingMlProfile.length" :class="ui.muted" class="p-2">{{ t('aiDq.noneNoMl') }}</p>
        </div>
      </section>

      <section v-if="data" class="space-y-2">
        <h2 class="text-sm font-semibold text-slate-200">{{ t('aiDq.tableLowConf') }}</h2>
        <div :class="ui.card" class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr :class="ui.muted">
                <th class="py-2 pr-2">{{ t('aiDq.colName') }}</th>
                <th class="py-2 pr-2">{{ t('aiMl.colEntity') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colConfidence') }}</th>
                <th class="py-2 pr-2">{{ t('aiRideGrid.colSource') }}</th>
                <th class="py-2 pr-2">{{ t('aiDq.colHints') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in data.lowConfidenceForecasts" :key="`${r.externalEntityId ?? 'x'}-${i}`" class="border-t border-slate-700/50">
                <td class="py-2 pr-2">{{ r.name }}</td>
                <td class="py-2 pr-2">{{ r.entityType ?? '—' }}</td>
                <td class="py-2 pr-2 font-mono">{{ formatConfidenceCell(r) }}</td>
                <td class="py-2 pr-2 font-mono text-[11px]">{{ r.forecastSource ?? '—' }}</td>
                <td class="py-2 pr-2 text-amber-200/90">{{ r.featureDataQuality?.join('; ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!data.lowConfidenceForecasts.length" :class="ui.muted" class="p-2">{{ t('aiDq.noneLowConf') }}</p>
        </div>
      </section>
      </template>
    </template>
  </div>
</template>
