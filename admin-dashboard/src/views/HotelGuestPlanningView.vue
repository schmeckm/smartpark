<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useParkContextStore } from '@/stores/parkContext'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { themePreference } from '@/composables/useUiTheme'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import {
  ApiRequestError,
  createVisitPlan,
  deleteVisitPlan,
  exportVisitPlanXlsxBlob,
  getVisitPlan,
  getVisitActualYear,
  importVisitPlanXlsx,
  listVisitPlans,
  patchVisitPlan,
  postVisitPlanForecast,
  putVisitActualYear,
} from '@/api/client'
import type { VisitPlanDetail, VisitPlanPayload, VisitPlanVersionSummary } from '@/types/api'
import {
  datesFromMonthHorizon,
  fillEmptyByWeekdayMean,
  monthlyVisitTotals,
  pruneGuestCountsForYear,
  weekdayVisitAverages,
  yearVisitGrandTotal,
} from '@/utils/visitPlanning.utils'

const { t, locale } = useI18n()
const parkCtx = useParkContextStore()
const auth = useAuthStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const TICKET_CHANNEL_ROWS = [
  { id: 'sp:ch:kasse', labelKey: 'hotelPlanning.channelKasse' as const },
  { id: 'sp:ch:vorverkauf', labelKey: 'hotelPlanning.channelVorverkauf' as const },
  { id: 'sp:ch:freikarten', labelKey: 'hotelPlanning.channelFreikarten' as const },
] as const

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `h-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

const readOnly = computed(() => !auth.hasPermission('rides', 'update'))

const planYear = ref(new Date().getFullYear())
const planMonth = ref(Math.min(12, Math.max(1, new Date().getMonth() + 1)))

/** Number of consecutive months shown in the grid from {@link planMonth} (same plan year, max until Dec). */
const horizonMonths = ref(1)
const horizonOptions = [1, 2, 3, 6, 12] as const

const yearChoices = computed(() => {
  const y = new Date().getFullYear()
  return Array.from({ length: 11 }, (_, i) => y - 3 + i)
})

const versions = ref<VisitPlanVersionSummary[]>([])
const versionsLoading = ref(false)
const activeVersionId = ref<string | null>(null)
const detailLoading = ref(false)
const suspendSave = ref(false)

const hotels = ref<VisitPlanDetail['payload']['hotels']>([])
const guestCounts = ref<Record<string, number>>({})

const saving = ref(false)
const saveStatus = ref<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')

let saveTimer: ReturnType<typeof setTimeout> | null = null

const showNewVersionDialog = ref(false)
const newVersionName = ref('')

const excelBusy = ref(false)
const visitPlanExcelInputRef = ref<HTMLInputElement | null>(null)

const actualsSaving = ref(false)
const showForecastDialog = ref(false)
const forecastSourceYear = ref(new Date().getFullYear() - 1)
const forecastScale = ref(1)
const forecastEmptyOnly = ref(true)
const forecastApplying = ref(false)
const forecastActualsLoading = ref(false)
/** `null` = not loaded; `0` = no cells for that Ist year */
const forecastActualsCellCount = ref<number | null>(null)

const forecastApplyDisabled = computed(
  () =>
    forecastApplying.value ||
    forecastActualsLoading.value ||
    (forecastActualsCellCount.value !== null && forecastActualsCellCount.value === 0)
)

async function refreshForecastActualsPreview() {
  if (!parkCtx.activeParkId) {
    forecastActualsCellCount.value = null
    return
  }
  forecastActualsLoading.value = true
  try {
    const r = await getVisitActualYear(forecastSourceYear.value)
    forecastActualsCellCount.value = Object.keys(r.guestCounts || {}).length
  } catch {
    forecastActualsCellCount.value = null
  } finally {
    forecastActualsLoading.value = false
  }
}

const statsLocale = computed(() => {
  const l = locale.value
  if (l === 'de') return 'de-DE'
  if (l === 'fr') return 'fr-FR'
  if (l === 'es') return 'es-ES'
  return 'en-GB'
})

const rowIdsAll = computed(() => [
  ...TICKET_CHANNEL_ROWS.map((c) => c.id),
  ...hotels.value.map((h) => h.id),
])

const dateColumns = computed(() =>
  datesFromMonthHorizon(planYear.value, planMonth.value, horizonMonths.value)
)

const monthlyTotals = computed(() =>
  monthlyVisitTotals(guestCounts.value, rowIdsAll.value, planYear.value, statsLocale.value)
)

const weekdayAvgs = computed(() =>
  weekdayVisitAverages(guestCounts.value, rowIdsAll.value, planYear.value, statsLocale.value)
)

const yearGrandTotal = computed(() =>
  yearVisitGrandTotal(guestCounts.value, rowIdsAll.value, planYear.value)
)

function fmtHeader(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return new Intl.DateTimeFormat(statsLocale.value, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(dt)
}

function cellKey(rowId: string, dateIso: string) {
  return `${rowId}::${dateIso}`
}

function getCell(rowId: string, dateIso: string): string {
  const k = cellKey(rowId, dateIso)
  const v = guestCounts.value[k]
  return v !== undefined && v !== null && !Number.isNaN(v) ? String(v) : ''
}

function parseCellInt(rowId: string, dateIso: string): number {
  const k = cellKey(rowId, dateIso)
  const v = guestCounts.value[k]
  return typeof v === 'number' && v >= 0 ? v : 0
}

function columnTotal(dateIso: string): number {
  let s = 0
  for (const ch of TICKET_CHANNEL_ROWS) s += parseCellInt(ch.id, dateIso)
  for (const h of hotels.value) s += parseCellInt(h.id, dateIso)
  return s
}

function setCell(rowId: string, dateIso: string, raw: string) {
  const k = cellKey(rowId, dateIso)
  const trimmed = raw.trim()
  if (trimmed === '') {
    const next = { ...guestCounts.value }
    delete next[k]
    guestCounts.value = next
    return
  }
  const n = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(n) || n < 0) return
  guestCounts.value = { ...guestCounts.value, [k]: n }
}

function onCellInput(rowId: string, dateIso: string, ev: Event) {
  const el = ev.target as HTMLInputElement
  setCell(rowId, dateIso, el.value)
}

function buildPayload(): VisitPlanPayload {
  return {
    schemaVersion: 2,
    hotels: hotels.value.map((h) => ({ ...h })),
    guestCounts: pruneGuestCountsForYear({ ...guestCounts.value }, planYear.value),
  }
}

function applyDetail(d: VisitPlanDetail) {
  suspendSave.value = true
  planYear.value = d.planYear
  const p = d.payload
  if (p && p.schemaVersion === 2 && Array.isArray(p.hotels)) {
    hotels.value = p.hotels.map((x) => ({ ...x }))
    guestCounts.value = pruneGuestCountsForYear(
      p.guestCounts && typeof p.guestCounts === 'object' ? { ...p.guestCounts } : {},
      d.planYear
    )
  } else {
    hotels.value = [
      { id: newId(), name: t('hotelPlanning.sampleHotel', { n: 1 }) },
      { id: newId(), name: t('hotelPlanning.sampleHotel', { n: 2 }) },
    ]
    guestCounts.value = {}
  }
  saveStatus.value = 'idle'
  queueMicrotask(() => {
    suspendSave.value = false
  })
}

async function reloadVersions(autoPickFirst: boolean) {
  if (!parkCtx.activeParkId) {
    versions.value = []
    return
  }
  versionsLoading.value = true
  try {
    versions.value = await listVisitPlans(planYear.value)
    if (autoPickFirst && versions.value.length > 0 && !activeVersionId.value) {
      activeVersionId.value = versions.value[0].id
    }
    if (activeVersionId.value && !versions.value.some((v) => v.id === activeVersionId.value)) {
      activeVersionId.value = versions.value[0]?.id ?? null
    }
  } catch (e) {
    versions.value = []
    push(`${t('hotelPlanning.loadVersionsError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    versionsLoading.value = false
  }
}

async function loadDetail(id: string) {
  detailLoading.value = true
  try {
    const d = await getVisitPlan(id)
    applyDetail(d)
  } catch (e) {
    push(`${t('hotelPlanning.loadDetailError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    detailLoading.value = false
  }
}

async function flushSave(opts?: { notifySuccess?: boolean }) {
  if (readOnly.value || !activeVersionId.value || suspendSave.value || saving.value) return
  saving.value = true
  saveStatus.value = 'saving'
  try {
    const payload = buildPayload()
    await patchVisitPlan(activeVersionId.value, { payload })
    saveStatus.value = 'saved'
    await reloadVersions(false)
    if (opts?.notifySuccess) push(t('hotelPlanning.saveNowSuccess'), 'success')
  } catch (e) {
    saveStatus.value = 'error'
    push(`${t('hotelPlanning.saveError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    saving.value = false
  }
}

function scheduleSave() {
  if (readOnly.value || !activeVersionId.value || suspendSave.value) return
  saveStatus.value = 'dirty'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushSave()
  }, 900)
}

watch(
  () => parkCtx.activeParkId,
  async (pid) => {
    activeVersionId.value = null
    hotels.value = []
    guestCounts.value = {}
    if (!pid) return
    await reloadVersions(true)
  },
  { immediate: true }
)

watch(planYear, async () => {
  activeVersionId.value = null
  await reloadVersions(true)
})

watch(activeVersionId, (id) => {
  if (id) void loadDetail(id)
})

watch(forecastSourceYear, () => {
  if (showForecastDialog.value) void refreshForecastActualsPreview()
})

watch(
  () => [guestCounts.value, hotels.value] as const,
  () => {
    if (suspendSave.value || !activeVersionId.value || readOnly.value) return
    scheduleSave()
  },
  { deep: true }
)

function addHotel() {
  if (readOnly.value) return
  hotels.value = [
    ...hotels.value,
    { id: newId(), name: t('hotelPlanning.sampleHotel', { n: hotels.value.length + 1 }) },
  ]
}

function removeHotel(id: string) {
  if (readOnly.value) return
  hotels.value = hotels.value.filter((h) => h.id !== id)
  const prefix = `${id}::`
  const next = { ...guestCounts.value }
  for (const k of Object.keys(next)) {
    if (k.startsWith(prefix)) delete next[k]
  }
  guestCounts.value = next
}

async function onCreateVersion() {
  const name = newVersionName.value.trim()
  if (!name || readOnly.value || !parkCtx.activeParkId) return
  try {
    const created = await createVisitPlan({ name, planYear: planYear.value })
    showNewVersionDialog.value = false
    newVersionName.value = ''
    await reloadVersions(false)
    activeVersionId.value = created.id
    applyDetail(created)
    push(t('hotelPlanning.versionCreated'), 'success')
  } catch (e) {
    push(`${t('hotelPlanning.createVersionError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

async function onDeleteVersion() {
  if (readOnly.value || !activeVersionId.value) return
  const ok = await askConfirm({
    variant: 'danger',
    title: t('hotelPlanning.deleteVersionTitle'),
    message: t('hotelPlanning.deleteVersionMsg'),
    confirmLabel: t('btn.confirm'),
    cancelLabel: t('btn.cancel'),
  })
  if (!ok) return
  const id = activeVersionId.value
  try {
    await deleteVisitPlan(id)
    activeVersionId.value = null
    hotels.value = []
    guestCounts.value = {}
    await reloadVersions(true)
    push(t('hotelPlanning.versionDeleted'), 'success')
  } catch (e) {
    push(`${t('hotelPlanning.deleteVersionError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  }
}

async function onProjectWeekdayMeans() {
  if (readOnly.value || !activeVersionId.value) return
  const ok = await askConfirm({
    title: t('hotelPlanning.projectConfirmTitle'),
    message: t('hotelPlanning.projectConfirmMsg'),
    confirmLabel: t('btn.confirm'),
    cancelLabel: t('btn.cancel'),
  })
  if (!ok) return
  const rowIds = rowIdsAll.value
  guestCounts.value = fillEmptyByWeekdayMean(guestCounts.value, rowIds, planYear.value)
  scheduleSave()
  push(t('hotelPlanning.projectApplied'), 'success')
}

async function onSaveActualsFromGrid() {
  if (readOnly.value || !parkCtx.activeParkId) return
  actualsSaving.value = true
  try {
    const gc = pruneGuestCountsForYear({ ...guestCounts.value }, planYear.value)
    await putVisitActualYear(planYear.value, gc)
    push(t('hotelPlanning.actualsSaved'), 'success')
    if (showForecastDialog.value) void refreshForecastActualsPreview()
  } catch (e) {
    push(`${t('hotelPlanning.actualsSaveError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    actualsSaving.value = false
  }
}

function openForecastDialog() {
  forecastSourceYear.value = Math.max(2000, planYear.value - 1)
  forecastScale.value = 1
  forecastEmptyOnly.value = true
  forecastActualsCellCount.value = null
  showForecastDialog.value = true
  void refreshForecastActualsPreview()
}

async function onApplyPriorYearForecast() {
  if (readOnly.value || !activeVersionId.value) return
  forecastApplying.value = true
  try {
    const out = await postVisitPlanForecast(activeVersionId.value, {
      sourceYear: forecastSourceYear.value,
      scale: forecastScale.value,
      emptyOnly: forecastEmptyOnly.value,
    })
    applyDetail(out.detail)
    showForecastDialog.value = false
    const s = out.forecastSummary
    push(
      t('hotelPlanning.forecastApplied', {
        filled: s.cellsFilled,
        skippedEx: s.cellsSkippedExisting,
        skippedNs: s.cellsSkippedNoSource,
      }),
      'success'
    )
    await reloadVersions(false)
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'NO_ACTUALS') {
      push(t('hotelPlanning.forecastErrorNoActuals', { year: forecastSourceYear.value }), 'error')
    } else {
      push(`${t('hotelPlanning.forecastError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  } finally {
    forecastApplying.value = false
  }
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  void flushSave({ notifySuccess: true })
}

async function onExportVisitPlanExcel() {
  if (!activeVersionId.value || excelBusy.value) return
  excelBusy.value = true
  try {
    const { blob, filename } = await exportVisitPlanXlsxBlob(activeVersionId.value)
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    a.click()
    URL.revokeObjectURL(href)
  } catch (e) {
    push(`${t('hotelPlanning.excelExportError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    excelBusy.value = false
  }
}

function triggerVisitPlanExcelImport() {
  if (readOnly.value || !activeVersionId.value || excelBusy.value) return
  visitPlanExcelInputRef.value?.click()
}

async function onVisitPlanExcelFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !activeVersionId.value || readOnly.value) return
  excelBusy.value = true
  try {
    const { detail, importSummary } = await importVisitPlanXlsx(activeVersionId.value, file)
    applyDetail(detail)
    let msg = t('hotelPlanning.excelImportSuccess', {
      written: importSummary.cellsWritten,
      cleared: importSummary.cellsCleared,
    })
    const unk = importSummary.unknownRowKeys.length
    const ign = importSummary.ignoredColumns.length
    if (unk > 0 || ign > 0) {
      msg += ` ${t('hotelPlanning.excelImportExtra', { unknown: unk, ignored: ign })}`
    }
    push(msg, 'success')
    await reloadVersions(false)
  } catch (e) {
    push(`${t('hotelPlanning.excelImportError')}: ${e instanceof Error ? e.message : String(e)}`, 'error')
  } finally {
    excelBusy.value = false
  }
}

const headSticky =
  'sticky top-0 z-20 min-w-[4.5rem] border-b border-slate-700 bg-slate-900 px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-950'
const headStickyLight =
  'sticky top-0 z-20 min-w-[4.5rem] border-b border-slate-200 bg-white px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-600'

const cornerSticky =
  'sticky left-0 z-30 min-w-[10rem] max-w-[14rem] border-b border-r border-slate-700 bg-slate-900 px-2 py-2 text-left text-xs font-semibold text-white dark:bg-slate-950'
const cornerStickyLight =
  'sticky left-0 z-30 min-w-[10rem] max-w-[14rem] border-b border-r border-slate-200 bg-white px-2 py-2 text-left text-xs font-semibold text-slate-900'

const rowSticky =
  'sticky left-0 z-10 min-w-[10rem] max-w-[14rem] border-b border-r border-slate-800 bg-slate-900/95 px-2 py-1 align-middle text-slate-200 dark:bg-slate-950/95'
const rowStickyLight =
  'sticky left-0 z-10 min-w-[10rem] max-w-[14rem] border-b border-r border-slate-200 bg-white px-2 py-1 align-middle text-slate-900'

const cellClass =
  'border-b border-slate-800 px-0.5 py-0.5 align-middle dark:border-slate-800'
const cellClassLight = 'border-b border-slate-200 px-0.5 py-0.5 align-middle'

const inputClass =
  'w-full min-w-[3.25rem] rounded border border-slate-700 bg-slate-950 px-1 py-1 text-center text-xs text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-50'
const inputClassLight =
  'w-full min-w-[3.25rem] rounded border border-slate-300 bg-white px-1 py-1 text-center text-xs text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:opacity-50'

const sectionBanner =
  'border-b border-slate-800 bg-slate-900/80 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800'
const sectionBannerLight =
  'border-b border-slate-200 bg-slate-100 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600'

const totalRowHeader =
  'sticky left-0 z-10 min-w-[10rem] max-w-[14rem] border-b border-r border-slate-700 bg-slate-900 px-2 py-2 text-left text-xs font-bold text-brand-300 dark:bg-slate-950'
const totalRowHeaderLight =
  'sticky left-0 z-10 min-w-[10rem] max-w-[14rem] border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-bold text-brand-700'

const totalCell =
  'border-b border-slate-800 bg-slate-900/40 px-1 py-2 text-center text-xs font-semibold text-slate-100 dark:border-slate-800'
const totalCellLight =
  'border-b border-slate-200 bg-slate-50/80 px-1 py-2 text-center text-xs font-semibold text-slate-900'

const isLight = computed(() => themePreference.value === 'light')
const thHead = computed(() => (isLight.value ? headStickyLight : headSticky))
const thCorner = computed(() => (isLight.value ? cornerStickyLight : cornerSticky))
const tdRow = computed(() => (isLight.value ? rowStickyLight : rowSticky))
const tdCell = computed(() => (isLight.value ? cellClassLight : cellClass))
const inp = computed(() => (isLight.value ? inputClassLight : inputClass))
const thSection = computed(() => (isLight.value ? sectionBannerLight : sectionBanner))
const thTotalRow = computed(() => (isLight.value ? totalRowHeaderLight : totalRowHeader))
const tdTotal = computed(() => (isLight.value ? totalCellLight : totalCell))

const saveStatusLabel = computed(() => {
  switch (saveStatus.value) {
    case 'dirty':
      return t('hotelPlanning.saveDirty')
    case 'saving':
      return t('hotelPlanning.saveSaving')
    case 'saved':
      return t('hotelPlanning.saveSaved')
    case 'error':
      return t('hotelPlanning.saveFailed')
    default:
      return ''
  }
})
</script>

<template>
  <div class="mx-auto max-w-[100rem] space-y-5 px-4 py-6 sm:px-6">
    <header>
      <h1 :class="ui.title">{{ t('hotelPlanning.title') }}</h1>
      <p :class="ui.subtitle">{{ t('hotelPlanning.subtitle') }}</p>
    </header>

    <div v-if="!parkCtx.activeParkId" :class="ui.infoBox">
      {{ t('hotelPlanning.needPark') }}
    </div>

    <template v-else>
      <div :class="ui.card" class="space-y-4">
        <div class="flex flex-wrap items-end gap-4">
          <label class="block">
            <span :class="ui.label" class="!mt-0">{{ t('hotelPlanning.planYear') }}</span>
            <select
              v-model.number="planYear"
              :disabled="versionsLoading"
              :class="ui.control"
              class="!mt-1 w-auto min-w-[8rem]"
            >
              <option v-for="y in yearChoices" :key="y" :value="y">{{ y }}</option>
            </select>
          </label>
          <label class="block">
            <span :class="ui.label" class="!mt-0">{{ t('hotelPlanning.planMonth') }}</span>
            <select v-model.number="planMonth" :class="ui.control" class="!mt-1 w-auto min-w-[10rem]">
              <option v-for="m in 12" :key="m" :value="m">
                {{ new Intl.DateTimeFormat(statsLocale, { month: 'long' }).format(new Date(2000, m - 1, 1)) }}
              </option>
            </select>
          </label>
          <label class="block">
            <span :class="ui.label" class="!mt-0">{{ t('hotelPlanning.horizonMonths') }}</span>
            <select v-model.number="horizonMonths" :class="ui.control" class="!mt-1 w-auto min-w-[10rem]">
              <option v-for="h in horizonOptions" :key="h" :value="h">
                {{
                  h === 1
                    ? t('hotelPlanning.horizonSingular')
                    : t('hotelPlanning.horizonPlural', { n: h })
                }}
              </option>
            </select>
          </label>
          <label class="block min-w-[14rem]">
            <span :class="ui.label" class="!mt-0">{{ t('hotelPlanning.versionLabel') }}</span>
            <select
              v-model="activeVersionId"
              :disabled="versionsLoading"
              :class="ui.control"
              class="!mt-1 w-full"
            >
              <option :value="null">{{ t('hotelPlanning.pickVersion') }}</option>
              <option v-for="v in versions" :key="v.id" :value="v.id">
                {{ v.name }} — {{ t('hotelPlanning.updatedShort') }}
                {{ new Date(v.updatedAt).toLocaleString(locale) }}
              </option>
            </select>
          </label>
          <p :class="[ui.muted, 'w-full basis-full !mt-0']">{{ t('hotelPlanning.horizonHint') }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="!readOnly"
              type="button"
              class="mt-6 rounded-md border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              :disabled="versionsLoading"
              @click="
                () => {
                  newVersionName = ''
                  showNewVersionDialog = true
                }
              "
            >
              {{ t('hotelPlanning.newVersion') }}
            </button>
            <button
              v-if="!readOnly"
              type="button"
              class="mt-6 rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              :disabled="!activeVersionId || versionsLoading"
              @click="onDeleteVersion"
            >
              {{ t('hotelPlanning.deleteVersion') }}
            </button>
            <button
              v-if="!readOnly"
              type="button"
              class="mt-6 rounded-md border border-slate-500 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              :disabled="!activeVersionId || saving"
              @click="saveNow"
            >
              {{ t('hotelPlanning.saveNow') }}
            </button>
            <button
              type="button"
              class="mt-6 rounded-md border border-slate-500 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              :disabled="!activeVersionId || versionsLoading || excelBusy"
              @click="onExportVisitPlanExcel"
            >
              {{ t('hotelPlanning.excelDownload') }}
            </button>
            <button
              v-if="!readOnly"
              type="button"
              class="mt-6 rounded-md border border-slate-500 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              :disabled="!activeVersionId || versionsLoading || excelBusy"
              @click="triggerVisitPlanExcelImport"
            >
              {{ t('hotelPlanning.excelUpload') }}
            </button>
            <input
              ref="visitPlanExcelInputRef"
              type="file"
              class="sr-only"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              @change="onVisitPlanExcelFileChange"
            />
          </div>
        </div>
        <p v-if="saveStatusLabel && activeVersionId" :class="ui.muted">{{ saveStatusLabel }}</p>
        <p v-if="readOnly" :class="ui.infoBox">{{ t('hotelPlanning.readOnlyHint') }}</p>
        <p :class="ui.muted">{{ t('hotelPlanning.excelHint') }}</p>
        <p :class="ui.muted">{{ t('hotelPlanning.integrationHint') }}</p>
      </div>

      <div v-if="showForecastDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div :class="ui.card" class="w-full max-w-md space-y-4 shadow-xl">
          <h2 :class="ui.h2">{{ t('hotelPlanning.forecastDialogTitle') }}</h2>
          <p :class="ui.muted">{{ t('hotelPlanning.forecastDialogHint') }}</p>
          <p v-if="forecastActualsLoading" :class="ui.muted">{{ t('hotelPlanning.forecastActualsLoading') }}</p>
          <p v-else-if="forecastActualsCellCount === 0" :class="ui.infoBox">
            {{ t('hotelPlanning.forecastNoActualsHint', { year: forecastSourceYear }) }}
          </p>
          <p v-else-if="forecastActualsCellCount != null && forecastActualsCellCount > 0" :class="ui.muted">
            {{ t('hotelPlanning.forecastActualsOk', { n: forecastActualsCellCount }) }}
          </p>
          <label :class="ui.label" class="!mt-0">
            {{ t('hotelPlanning.forecastSourceYear') }}
            <input
              v-model.number="forecastSourceYear"
              type="number"
              min="2000"
              max="2100"
              step="1"
              :class="ui.control"
              class="!mt-1"
            />
          </label>
          <label :class="ui.label" class="!mt-0">
            {{ t('hotelPlanning.forecastScale') }}
            <input
              v-model.number="forecastScale"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              :class="ui.control"
              class="!mt-1"
            />
          </label>
          <label class="flex cursor-pointer items-center gap-2 text-xs">
            <input v-model="forecastEmptyOnly" type="checkbox" class="rounded border-slate-600" />
            <span :class="ui.muted">{{ t('hotelPlanning.forecastEmptyOnly') }}</span>
          </label>
          <div :class="ui.footerRule">
            <button type="button" class="rounded-md border border-slate-600 px-3 py-2 text-xs" @click="showForecastDialog = false">
              {{ t('btn.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-md border border-amber-600 bg-amber-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              :disabled="forecastApplyDisabled"
              @click="onApplyPriorYearForecast"
            >
              {{ t('hotelPlanning.forecastApply') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="showNewVersionDialog" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div :class="ui.card" class="w-full max-w-md space-y-4 shadow-xl">
          <h2 :class="ui.h2">{{ t('hotelPlanning.newVersionTitle') }}</h2>
          <label :class="ui.label" class="!mt-0">
            {{ t('hotelPlanning.versionName') }}
            <input
              v-model="newVersionName"
              type="text"
              maxlength="200"
              :class="ui.control"
              class="!mt-1"
              :placeholder="t('hotelPlanning.versionNamePh')"
              @keydown.enter.prevent="onCreateVersion"
            />
          </label>
          <div :class="ui.footerRule">
            <button type="button" class="rounded-md border border-slate-600 px-3 py-2 text-xs" @click="showNewVersionDialog = false">
              {{ t('btn.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-md border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-medium text-white"
              :disabled="!newVersionName.trim()"
              @click="onCreateVersion"
            >
              {{ t('btn.confirm') }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="activeVersionId && !detailLoading" :class="ui.card" class="space-y-4">
        <h2 :class="ui.h2">{{ t('hotelPlanning.statsTitle') }}</h2>
        <p :class="ui.muted">{{ t('hotelPlanning.statsHint') }}</p>
        <div class="flex flex-wrap gap-8">
          <div>
            <p :class="ui.statLabel">{{ t('hotelPlanning.statsYearTotal') }}</p>
            <p :class="ui.statValue">{{ yearGrandTotal.toLocaleString(locale) }}</p>
          </div>
        </div>
        <div class="grid gap-6 lg:grid-cols-2">
          <div class="overflow-x-auto">
            <p class="mb-2 text-xs font-semibold text-slate-400">{{ t('hotelPlanning.statsByMonth') }}</p>
            <table class="w-full min-w-[16rem] border-collapse text-left text-xs">
              <thead>
                <tr :class="ui.tableHead">
                  <th class="px-2 py-1">{{ t('hotelPlanning.statsMonthCol') }}</th>
                  <th class="px-2 py-1 text-right">{{ t('hotelPlanning.statsVisitsCol') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in monthlyTotals" :key="row.month" :class="ui.tableRow">
                  <td :class="ui.tableCell">{{ row.label }}</td>
                  <td :class="[ui.tableCell, 'text-right font-mono']">{{ row.total.toLocaleString(locale) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="overflow-x-auto">
            <p class="mb-2 text-xs font-semibold text-slate-400">{{ t('hotelPlanning.statsByWeekday') }}</p>
            <table class="w-full min-w-[16rem] border-collapse text-left text-xs">
              <thead>
                <tr :class="ui.tableHead">
                  <th class="px-2 py-1">{{ t('hotelPlanning.statsWeekdayCol') }}</th>
                  <th class="px-2 py-1 text-right">{{ t('hotelPlanning.statsAvgDailyCol') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in weekdayAvgs" :key="row.dow" :class="ui.tableRow">
                  <td :class="ui.tableCell">{{ row.label }}</td>
                  <td :class="[ui.tableCell, 'text-right font-mono']">{{ row.avg.toLocaleString(locale) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="!readOnly"
            type="button"
            class="rounded-md border border-indigo-600 bg-indigo-600/90 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            :disabled="!activeVersionId"
            @click="onProjectWeekdayMeans"
          >
            {{ t('hotelPlanning.projectWeekdayBtn') }}
          </button>
          <button
            v-if="!readOnly"
            type="button"
            class="rounded-md border border-emerald-700 bg-emerald-700/90 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
            :disabled="actualsSaving"
            @click="onSaveActualsFromGrid"
          >
            {{ t('hotelPlanning.saveActualsBtn') }}
          </button>
          <button
            v-if="!readOnly"
            type="button"
            class="rounded-md border border-amber-600 bg-amber-600/90 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
            :disabled="!activeVersionId || forecastApplying"
            @click="openForecastDialog"
          >
            {{ t('hotelPlanning.forecastPriorYearBtn') }}
          </button>
        </div>
        <p :class="ui.muted">{{ t('hotelPlanning.forecastHint') }}</p>
        <p :class="ui.muted">{{ t('hotelPlanning.actualsSaveHint', { planYear }) }}</p>
      </div>

      <div v-if="detailLoading" :class="ui.card">{{ t('hotelPlanning.detailLoading') }}</div>

      <section
        v-if="activeVersionId && !detailLoading"
        :class="ui.card"
        class="overflow-x-auto p-2 sm:p-4"
        :aria-label="t('hotelPlanning.gridAria')"
      >
        <div class="mb-3 flex flex-wrap gap-2">
          <button
            v-if="!readOnly"
            type="button"
            class="rounded-md border border-brand-600 bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500"
            @click="addHotel"
          >
            {{ t('hotelPlanning.addHotel') }}
          </button>
        </div>

        <table class="border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" :class="thCorner">{{ t('hotelPlanning.colCategory') }}</th>
              <th v-for="day in dateColumns" :key="day" scope="col" :class="thHead">
                <span class="block whitespace-nowrap">{{ fmtHeader(day) }}</span>
                <span class="block font-normal normal-case text-slate-500">{{ day }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th :colspan="1 + dateColumns.length" scope="colgroup" :class="thSection">
                {{ t('hotelPlanning.sectionTicketChannels') }}
              </th>
            </tr>
            <tr v-for="ch in TICKET_CHANNEL_ROWS" :key="ch.id">
              <th scope="row" :class="tdRow">
                <span class="block px-1 py-1 text-left text-xs font-medium">{{ t(ch.labelKey) }}</span>
              </th>
              <td v-for="day in dateColumns" :key="ch.id + day" :class="tdCell">
                <input
                  :value="getCell(ch.id, day)"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="readOnly"
                  :class="inp"
                  :aria-label="t('hotelPlanning.cellAriaChannel', { channel: t(ch.labelKey), date: day })"
                  @input="onCellInput(ch.id, day, $event)"
                />
              </td>
            </tr>
            <tr>
              <th :colspan="1 + dateColumns.length" scope="colgroup" :class="thSection">
                {{ t('hotelPlanning.sectionHotelGuests') }}
              </th>
            </tr>
            <tr v-for="h in hotels" :key="h.id">
              <th scope="row" :class="tdRow">
                <div class="flex items-center gap-1">
                  <input
                    v-model="h.name"
                    type="text"
                    :disabled="readOnly"
                    :class="inp"
                    class="!text-left font-medium"
                  />
                  <button
                    v-if="!readOnly"
                    type="button"
                    class="shrink-0 rounded px-1 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-red-400"
                    :title="t('hotelPlanning.removeHotel')"
                    @click="removeHotel(h.id)"
                  >
                    ×
                  </button>
                </div>
              </th>
              <td v-for="day in dateColumns" :key="day + h.id" :class="tdCell">
                <input
                  :value="getCell(h.id, day)"
                  type="number"
                  min="0"
                  step="1"
                  :disabled="readOnly"
                  :class="inp"
                  :aria-label="t('hotelPlanning.cellAriaHotelGuest', { hotel: h.name, date: day })"
                  @input="onCellInput(h.id, day, $event)"
                />
              </td>
            </tr>
            <tr>
              <th scope="row" :class="thTotalRow">{{ t('hotelPlanning.rowTotal') }}</th>
              <td v-for="day in dateColumns" :key="'sum-' + day" :class="tdTotal">
                {{ columnTotal(day).toLocaleString(locale) }}
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="hotels.length === 0" :class="[ui.muted, 'mt-4 text-center']">
          {{ t('hotelPlanning.emptyHotels') }}
        </p>
        <p :class="[ui.muted, 'mt-3']">{{ t('hotelPlanning.rowTotalHint') }}</p>
      </section>

      <div v-if="!activeVersionId && !versionsLoading && !detailLoading" :class="ui.infoBox">
        {{ t('hotelPlanning.noVersion') }}
      </div>
    </template>
  </div>
</template>
