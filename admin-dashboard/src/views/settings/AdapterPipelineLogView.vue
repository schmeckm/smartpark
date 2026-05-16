<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  getAdapterOpsDashboard,
  getAdapterOpsStatus,
  getAdapterPipelineLog,
  postAdapterOpsActivate,
  postAdapterOpsDisable,
  postAdapterOpsPause,
  postAdapterOpsRunNow,
  type AdapterOpsDashboard,
  type AdapterOpsGridRow,
  type AdapterOpsStatusDetail,
  type AdapterPipelineLogEntry,
  type AdapterPipelineLogResponse,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { formatDateTime } = useRegionalDateTime()
const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { push } = useToast()

/** Server routes also require `integrations.manage` for POST …/run-now|pause|activate|disable. */
const canManageIntegrations = computed(() => auth.hasPermission('integrations', 'manage'))

const adapterActionsLockedHint = computed(() => {
  if (canManageIntegrations.value) return ''
  const roles = auth.user?.roles?.length ? auth.user.roles.join(', ') : '—'
  return `Run / Pause / Activate / Disable sind gesperrt: Es fehlt die Berechtigung integrations.manage (aktuell Rollen: ${roles}). Mit Admin- oder Operator-Konto anmelden, oder Rolle in shared/rbac.json anpassen.`
})

const adapterKeyFilter = ref('')
const limit = ref(200)
const loading = ref(true)
const dashboardLoading = ref(true)
const data = ref<AdapterPipelineLogResponse | null>(null)
const dash = ref<AdapterOpsDashboard | null>(null)

const drawerOpen = ref(false)
const drawerKey = ref<string | null>(null)
const detail = ref<AdapterOpsStatusDetail | null>(null)
const detailLoading = ref(false)
const actionBusyKey = ref<string | null>(null)
const tableSearch = ref('')
const tableStatusFilter = ref<'ALL' | string>('ALL')
const tableProviderFilter = ref<'ALL' | string>('ALL')
const tableSortBy = ref<'name' | 'status' | 'provider' | 'errors' | 'success' | 'runtime'>('status')
const tableSortDir = ref<'asc' | 'desc'>('desc')
const eventLevelFilter = ref<'ALL' | 'ERROR' | 'WARN' | 'SUCCESS' | 'INFO'>('ALL')
const eventWindowMin = ref<5 | 15 | 60>(15)
const eventDedupe = ref(true)
const eventAdapterFilter = ref('')
const troubleshootingOpen = ref(false)
const actionConfirmOpen = ref(false)
type ActionKind = 'run' | 'pause' | 'activate' | 'disable'
const confirmActionKind = ref<ActionKind | null>(null)
const confirmRow = ref<AdapterOpsGridRow | null>(null)
const undoAction = ref<{
  adapterKey: string
  label: string
  inverseKind: 'pause' | 'activate' | 'disable'
} | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | null = null

const expanded = ref<Record<string, boolean>>({})

function toggleRow(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

const rows = computed(() => data.value?.entries ?? [])
const events = computed(() => dash.value?.events ?? [])
const adapters = computed(() => dash.value?.adapters ?? [])
const kpis = computed(() => dash.value?.kpis ?? null)
const providerOptions = computed(() => {
  const set = new Set<string>()
  for (const row of adapters.value) {
    const p = (row.provider || '').trim()
    if (p) set.add(p)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

function adapterOpsGridStatusLabel(status: string, row?: AdapterOpsGridRow | null) {
  const s = (status || '').toUpperCase()
  if (s === 'HEALTHY') return t('adapterOpsDashboard.statusHealthy')
  if (s === 'PAUSED') return t('adapterOpsDashboard.statusPaused')
  if (s === 'FAILED') return t('adapterOpsDashboard.statusFailed')
  if (s === 'WARNING') return t('adapterOpsDashboard.statusWarning')
  if (s === 'MANUAL_OK') {
    const key = (row?.adapterKey || '').trim()
    if (key === 'traffic_tomtom') return t('adapterOpsDashboard.statusManualOkTomtom')
    return t('adapterOpsDashboard.statusManualOk', { key: key || 'adapter' })
  }
  return status
}

function adapterOpsGridStatusHint(row: AdapterOpsGridRow) {
  if ((row.status || '').toUpperCase() !== 'MANUAL_OK') return ''
  return t('adapterOpsDashboard.statusManualOkHint')
}

function adapterOpsStatusMatchesFilter(rowStatus: string, filter: string) {
  const want = filter.toUpperCase()
  const rs = rowStatus.toUpperCase()
  if (want === 'HEALTHY' && (rs === 'HEALTHY' || rs === 'MANUAL_OK')) return true
  return rs === want
}

const filteredAdapters = computed(() => {
  const query = tableSearch.value.trim().toLowerCase()
  const sorted = adapters.value
    .filter((row) => {
      if (tableStatusFilter.value !== 'ALL' && !adapterOpsStatusMatchesFilter(row.status, tableStatusFilter.value))
        return false
      if (tableProviderFilter.value !== 'ALL' && (row.provider || '') !== tableProviderFilter.value) return false
      if (!query) return true
      const haystack = `${row.name} ${row.adapterKey} ${row.provider || ''}`.toLowerCase()
      return haystack.includes(query)
    })
    .slice()
  const dir = tableSortDir.value === 'asc' ? 1 : -1
  sorted.sort((a, b) => {
    if (tableSortBy.value === 'name') return a.name.localeCompare(b.name) * dir
    if (tableSortBy.value === 'provider') return (a.provider || '').localeCompare(b.provider || '') * dir
    if (tableSortBy.value === 'status') return a.status.localeCompare(b.status) * dir
    if (tableSortBy.value === 'errors') return ((a.errorsCount ?? 0) - (b.errorsCount ?? 0)) * dir
    if (tableSortBy.value === 'success') return ((a.successRate ?? -1) - (b.successRate ?? -1)) * dir
    return ((a.runtimeMs ?? Number.MAX_SAFE_INTEGER) - (b.runtimeMs ?? Number.MAX_SAFE_INTEGER)) * dir
  })
  return sorted
})

const missedSchedules = computed(() => {
  const now = Date.now()
  let count = 0
  for (const row of adapters.value) {
    if (!row.active || !row.nextRun) continue
    const ts = Date.parse(row.nextRun)
    if (Number.isFinite(ts) && ts < now) count += 1
  }
  return count
})
const errors24hTotal = computed(() => adapters.value.reduce((sum, row) => sum + (row.errorsCount || 0), 0))
const failedCount = computed(() => adapters.value.filter((row) => row.status.toUpperCase() === 'FAILED').length)
const eventDuplicatesCollapsed = computed(
  () => filteredEvents.value.length - visibleEvents.value.length
)

async function loadPipeline() {
  loading.value = true
  try {
    const ak = adapterKeyFilter.value.trim()
    data.value = await getAdapterPipelineLog({
      adapterKey: ak || undefined,
      limit: limit.value,
    })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load pipeline log', 'error')
    data.value = null
  } finally {
    loading.value = false
  }
}

async function loadDashboard() {
  dashboardLoading.value = true
  try {
    dash.value = await getAdapterOpsDashboard()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load adapter dashboard', 'error')
    dash.value = null
  } finally {
    dashboardLoading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadDashboard(), loadPipeline()])
}

function chartLatest(values: number[]) {
  if (!values.length) return null
  return values[values.length - 1] ?? null
}

function tailLevelClass(row: AdapterPipelineLogEntry) {
  const l = (row.level || '').toLowerCase()
  const ev = row.event || ''
  const det = row.detail as { status?: string; mqttFailures?: unknown[] } | undefined
  if (l === 'error') return 'text-rose-200 bg-rose-950/45 border-rose-800/55'
  if (l === 'warn') return 'text-amber-100 bg-amber-950/35 border-amber-800/45'
  if (ev === 'poll_run_outcome' && det?.status === 'SUCCESS') {
    return 'text-emerald-200 bg-emerald-950/35 border-emerald-800/45'
  }
  return 'text-slate-300 bg-slate-900/70 border-slate-700/80'
}

function eventLevelClass(level: string) {
  const x = (level || '').toUpperCase()
  if (x === 'ERROR') return 'text-rose-200 bg-rose-950/40 border-rose-800/50'
  if (x === 'WARN') return 'text-amber-100 bg-amber-950/35 border-amber-800/45'
  if (x === 'SUCCESS') return 'text-emerald-200 bg-emerald-950/35 border-emerald-800/45'
  return 'text-slate-300 bg-slate-900/70 border-slate-700/80'
}

function gridStatusClass(status: string) {
  const s = (status || '').toUpperCase()
  if (s === 'FAILED') return 'text-rose-300'
  if (s === 'WARNING') return 'text-amber-300'
  if (s === 'PAUSED') return 'text-slate-400'
  if (s === 'MANUAL_OK') return 'text-teal-300'
  return 'text-emerald-300'
}

type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'muted' | 'info'

function kpiCardClass(tone: KpiTone) {
  if (tone === 'success') return 'border-emerald-800/60 bg-emerald-950/25'
  if (tone === 'warning') return 'border-amber-800/60 bg-amber-950/25'
  if (tone === 'danger') return 'border-rose-800/60 bg-rose-950/25'
  if (tone === 'muted') return 'border-slate-700/80 bg-slate-900/70'
  if (tone === 'info') return 'border-sky-800/60 bg-sky-950/25'
  return 'border-slate-800 bg-slate-900/60'
}

function kpiValueClass(tone: KpiTone) {
  if (tone === 'success') return 'text-emerald-200'
  if (tone === 'warning') return 'text-amber-300'
  if (tone === 'danger') return 'text-rose-300'
  if (tone === 'muted') return 'text-slate-400'
  if (tone === 'info') return 'text-sky-300'
  return 'text-white'
}

function actionBusyLabel(kind: ActionKind) {
  if (kind === 'run') return 'Running…'
  if (kind === 'pause') return 'Pausing…'
  if (kind === 'activate') return 'Activating…'
  return 'Disabling…'
}

function normalizeEventLevel(level: string) {
  const l = String(level || '').toUpperCase()
  if (l === 'ERROR' || l === 'WARN' || l === 'SUCCESS') return l
  return 'INFO'
}

const filteredEvents = computed(() => {
  const now = Date.now()
  const windowMs = eventWindowMin.value * 60 * 1000
  return events.value.filter((ev) => {
    const level = normalizeEventLevel(ev.level)
    if (eventLevelFilter.value !== 'ALL' && level !== eventLevelFilter.value) return false
    if (eventAdapterFilter.value && (ev.adapterKey || '') !== eventAdapterFilter.value) return false
    const ts = Date.parse(ev.ts)
    if (!Number.isFinite(ts)) return true
    return now - ts <= windowMs
  })
})

const visibleEvents = computed(() => {
  if (!eventDedupe.value) return filteredEvents.value.map((ev) => ({ ...ev, count: 1 }))
  const map = new Map<string, { ts: string; adapterKey: string | null; level: string; message: string; count: number }>()
  for (const ev of filteredEvents.value) {
    const key = `${ev.adapterKey || '—'}|${normalizeEventLevel(ev.level)}|${ev.message}`
    const prev = map.get(key)
    if (prev) prev.count += 1
    else map.set(key, { ...ev, level: normalizeEventLevel(ev.level), count: 1 })
  }
  return Array.from(map.values()).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
})

function sparkPts(values: number[], cw = 140, ch = 44): string {
  if (!values.length) return ''
  const max = Math.max(...values.map((n) => (Number.isFinite(n) ? n : 0)), 1)
  const last = values.length - 1 || 1
  return values
    .map((raw, i) => {
      const n = Number.isFinite(raw) ? raw : 0
      const x = (i / last) * (cw - 4) + 2
      const y = ch - 3 - (n / max) * (ch - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const chartRuns = computed(() => dash.value?.charts.runsPerHour.map((x) => x.count) ?? [])
const chartErrors = computed(() => dash.value?.charts.errorsPerHour.map((x) => x.count) ?? [])
const chartRuntime = computed(() => dash.value?.charts.runtimeTrend.map((x) => x.avgMs) ?? [])
const chartMessages = computed(() => dash.value?.charts.messagesTrend.map((x) => x.total) ?? [])

function openDrawer(key: string) {
  drawerKey.value = key
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
}

watch(
  () => [drawerOpen.value, drawerKey.value] as const,
  async ([open, key]) => {
    if (!open || !key) {
      detail.value = null
      return
    }
    detailLoading.value = true
    try {
      detail.value = await getAdapterOpsStatus(key)
    } catch (e) {
      detail.value = null
      push(e instanceof Error ? e.message : 'Failed to load adapter detail', 'error')
    } finally {
      detailLoading.value = false
    }
  }
)

function isThemeParksKey(k: string) {
  return k.replace(/-/g, '_').toLowerCase() === 'themeparks_wiki'
}

async function runAction(
  label: string,
  fn: (key: string) => Promise<unknown>,
  row: AdapterOpsGridRow
) {
  if (!canManageIntegrations.value) return false
  actionBusyKey.value = row.adapterKey
  try {
    await fn(row.adapterKey)
    push(`${label}: ${row.adapterKey}`, 'success')
    await refreshAll()
    if (drawerOpen.value && drawerKey.value === row.adapterKey) {
      detailLoading.value = true
      try {
        detail.value = await getAdapterOpsStatus(row.adapterKey)
      } finally {
        detailLoading.value = false
      }
    }
    return true
  } catch (e) {
    push(e instanceof Error ? e.message : `${label} failed`, 'error')
    return false
  } finally {
    actionBusyKey.value = null
  }
}

function openActionConfirm(kind: ActionKind, row: AdapterOpsGridRow) {
  confirmActionKind.value = kind
  confirmRow.value = row
  actionConfirmOpen.value = true
}

function closeActionConfirm() {
  actionConfirmOpen.value = false
  confirmActionKind.value = null
  confirmRow.value = null
}

function setUndoAction(
  row: AdapterOpsGridRow,
  label: string,
  inverseKind: 'pause' | 'activate' | 'disable'
) {
  if (undoTimer) globalThis.clearTimeout(undoTimer)
  undoAction.value = {
    adapterKey: row.adapterKey,
    label,
    inverseKind,
  }
  undoTimer = globalThis.setTimeout(() => {
    undoAction.value = null
  }, 8000)
}

async function performAction(
  kind: ActionKind,
  row: AdapterOpsGridRow,
  fromUndo = false
) {
  let ok = false
  if (kind === 'run') ok = await runAction('Run now', postAdapterOpsRunNow, row)
  else if (kind === 'pause') ok = await runAction('Paused', postAdapterOpsPause, row)
  else if (kind === 'activate') ok = await runAction('Activated', postAdapterOpsActivate, row)
  else ok = await runAction('Disabled', postAdapterOpsDisable, row)
  if (!ok || fromUndo) return
  if (kind === 'pause') setUndoAction(row, 'Adapter paused', 'activate')
  if (kind === 'activate') setUndoAction(row, 'Adapter activated', 'pause')
  if (kind === 'disable') setUndoAction(row, 'Adapter disabled', 'activate')
  if (kind !== 'run') push('Action executed. Undo is available for 8 seconds.', 'info')
}

async function confirmAndRun() {
  if (!confirmActionKind.value || !confirmRow.value) return
  const kind = confirmActionKind.value
  const row = confirmRow.value
  closeActionConfirm()
  await performAction(kind, row)
}

async function undoLastAction() {
  if (!undoAction.value) return
  const target = adapters.value.find((row) => row.adapterKey === undoAction.value?.adapterKey)
  const inverse = undoAction.value.inverseKind
  undoAction.value = null
  if (!target) {
    push('Undo target not available anymore.', 'warning')
    return
  }
  await performAction(inverse, target, true)
  push('Last action was reverted.', 'success')
}

async function runDrawerNow() {
  if (!drawerKey.value || !canManageIntegrations.value) return
  actionBusyKey.value = drawerKey.value
  try {
    await postAdapterOpsRunNow(drawerKey.value)
    push(`Run now started: ${drawerKey.value}`, 'success')
    await refreshAll()
    detailLoading.value = true
    try {
      detail.value = await getAdapterOpsStatus(drawerKey.value)
    } finally {
      detailLoading.value = false
    }
  } catch (e) {
    push(e instanceof Error ? e.message : 'Run now failed', 'error')
  } finally {
    actionBusyKey.value = null
  }
}

function scrollToRawTail() {
  document.getElementById('adapter-raw-log-tail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function scrollToAdapterTable() {
  document.getElementById('adapter-status-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function focusFailedAdapters() {
  tableStatusFilter.value = 'FAILED'
  tableSortBy.value = 'errors'
  tableSortDir.value = 'desc'
  eventLevelFilter.value = 'ERROR'
  scrollToAdapterTable()
}

function focusErrorLoad() {
  tableSortBy.value = 'errors'
  tableSortDir.value = 'desc'
  eventLevelFilter.value = 'ERROR'
  scrollToAdapterTable()
}

function focusMissedSchedules() {
  tableSortBy.value = 'runtime'
  tableSortDir.value = 'desc'
  scrollToAdapterTable()
}

function applyFilterToUrl() {
  const ak = adapterKeyFilter.value.trim()
  router.replace({ name: 'adapter-pipeline-log', query: ak ? { adapterKey: ak } : {} })
  void loadPipeline()
}

onMounted(() => {
  const q = route.query.adapterKey
  if (typeof q === 'string') adapterKeyFilter.value = q
  else if (Array.isArray(q) && q[0]) adapterKeyFilter.value = String(q[0])
  else adapterKeyFilter.value = ''
  void refreshAll()
})

onBeforeUnmount(() => {
  if (undoTimer) globalThis.clearTimeout(undoTimer)
})
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink to="/settings/devices-services" class="text-sm text-brand-400 hover:text-brand-300">
        ← Devices &amp; Services
      </RouterLink>
    </div>

    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Adapter operations center</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">
          Live KPIs, adapter grid, event stream, and trends — plus the full pipeline tail you already rely on (NDJSON).
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
        :disabled="dashboardLoading || loading"
        @click="refreshAll()"
      >
        Refresh all
      </button>
    </div>

    <div class="rounded-lg border border-slate-800 bg-slate-900/40">
      <button
        type="button"
        class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        :aria-expanded="troubleshootingOpen ? 'true' : 'false'"
        @click="troubleshootingOpen = !troubleshootingOpen"
      >
        <span class="font-medium">Troubleshooting quick help</span>
        <span class="text-xs text-slate-400">
          {{ troubleshootingOpen ? 'Hide' : 'Show' }}
        </span>
      </button>
      <div v-if="troubleshootingOpen" class="border-t border-slate-800 px-3 py-3 text-xs text-slate-300">
        <p class="font-semibold text-slate-200">No data in dashboard or event stream</p>
        <ul class="mt-1 list-disc space-y-1 pl-4 text-slate-400">
          <li>Check adapter is active and run preview/run now returns success.</li>
          <li>Check filter windows (event time window, table search/filter) are not too narrow.</li>
          <li>Open pipeline tail to confirm raw events exist.</li>
        </ul>
        <p class="mt-3 font-semibold text-slate-200">Wrong park context or topic namespace</p>
        <ul class="mt-1 list-disc space-y-1 pl-4 text-slate-400">
          <li>Align adapter <span class="font-mono">parkSlug</span> with integration <span class="font-mono">unsParkKey</span>.</li>
          <li>Align <span class="font-mono">sparkplugGroupId</span> / <span class="font-mono">sparkplugEdgeNode</span> in context.</li>
          <li>Use adapter row "Config" action to validate current install values.</li>
        </ul>
        <p class="mt-3 font-semibold text-slate-200">MQTT subscriber sees no messages</p>
        <ul class="mt-1 list-disc space-y-1 pl-4 text-slate-400">
          <li>Enable <span class="font-mono">MQTT_ENABLED=true</span> and verify broker URL.</li>
          <li>In Docker use service name host (for example <span class="font-mono">mqtt://mqtt:1883</span>).</li>
          <li>From host tools subscribe to mapped host port (often <span class="font-mono">localhost:1883</span>).</li>
        </ul>
      </div>
    </div>

    <div
      v-if="!canManageIntegrations"
      class="rounded-lg border border-amber-600/50 bg-amber-950/35 px-4 py-3 text-sm text-amber-100/95"
    >
      <p class="font-medium text-amber-50">Adapter-Aktionen nicht verfügbar</p>
      <p class="mt-1 text-amber-100/90">{{ adapterActionsLockedHint }}</p>
      <p class="mt-2 text-xs text-amber-200/80">
        <span class="font-mono">Config</span> (Link zur Integration) reicht
        <span class="font-mono">integrations.read</span> — nur die vier POST-Aktionen brauchen
        <span class="font-mono">integrations.manage</span>.
      </p>
    </div>

    <div class="grid gap-2 sm:grid-cols-3">
      <button
        type="button"
        class="rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-left hover:bg-rose-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
        @click="focusFailedAdapters"
      >
        <div class="text-[10px] uppercase tracking-wide text-rose-300/80">[!] Failed adapters</div>
        <div class="font-mono text-lg font-semibold text-rose-200">{{ failedCount }}</div>
      </button>
      <button
        type="button"
        class="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-left hover:bg-amber-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        @click="focusErrorLoad"
      >
        <div class="text-[10px] uppercase tracking-wide text-amber-300/80">[~] Errors 24h (total)</div>
        <div class="font-mono text-lg font-semibold text-amber-200">{{ errors24hTotal }}</div>
      </button>
      <button
        type="button"
        class="rounded-lg border border-sky-800/60 bg-sky-950/30 px-3 py-2 text-left hover:bg-sky-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        @click="focusMissedSchedules"
      >
        <div class="text-[10px] uppercase tracking-wide text-sky-300/80">[i] Missed schedules</div>
        <div class="font-mono text-lg font-semibold text-sky-200">{{ missedSchedules }}</div>
      </button>
    </div>

    <div
      v-if="undoAction"
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-700/60 bg-brand-950/25 px-3 py-2 text-sm text-brand-100"
    >
      <span>
        {{ undoAction.label }} (<span class="font-mono">{{ undoAction.adapterKey }}</span
        >).
      </span>
      <button
        type="button"
        class="rounded border border-brand-600 px-2 py-1 text-xs text-brand-200 hover:bg-brand-900/40"
        @click="undoLastAction"
      >
        Undo
      </button>
    </div>

    <!-- KPI cards -->
    <div
      v-if="kpis"
      class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('neutral')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total adapters</div>
        <div class="font-mono text-lg" :class="kpiValueClass('neutral')">{{ kpis.totalAdapters }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('success')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Active</div>
        <div class="font-mono text-lg" :class="kpiValueClass('success')">{{ kpis.activeAdapters }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('success')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Healthy</div>
        <div class="font-mono text-lg" :class="kpiValueClass('success')">{{ kpis.healthyAdapters }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('warning')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Warning</div>
        <div class="font-mono text-lg" :class="kpiValueClass('warning')">{{ kpis.warningAdapters }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('danger')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Failed</div>
        <div class="font-mono text-lg" :class="kpiValueClass('danger')">{{ kpis.failedAdapters }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('muted')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Paused</div>
        <div class="font-mono text-lg" :class="kpiValueClass('muted')">{{ kpis.pausedAdapters }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('neutral')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Runs today</div>
        <div class="font-mono text-lg" :class="kpiValueClass('neutral')">{{ kpis.runsToday }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('danger')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">MQTT publish errors today</div>
        <div class="font-mono text-lg" :class="kpiValueClass('danger')">{{ kpis.mqttPublishErrorsToday }}</div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('info')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Avg runtime (today)</div>
        <div class="font-mono text-lg" :class="kpiValueClass('info')">
          {{ kpis.avgRuntimeSecToday != null ? `${kpis.avgRuntimeSecToday}s` : '—' }}
        </div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('neutral')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Last scheduler row</div>
        <div
          class="truncate font-mono text-[11px] text-slate-300"
          :title="kpis.lastSchedulerRun || undefined"
        >
          {{ kpis.lastSchedulerRun ? formatDateTime(kpis.lastSchedulerRun) : '—' }}
        </div>
      </div>
      <div class="rounded-lg border px-3 py-2" :class="kpiCardClass('neutral')">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Next scheduled run</div>
        <div
          class="truncate font-mono text-[11px] text-slate-300"
          :title="kpis.nextScheduledRun || undefined"
        >
          {{ kpis.nextScheduledRun ? formatDateTime(kpis.nextScheduledRun) : '—' }}
        </div>
      </div>
    </div>

    <!-- Charts -->
    <div class="grid gap-3 lg:grid-cols-4">
      <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Runs / hour (24h)</div>
        <svg viewBox="0 0 140 44" class="mt-2 h-14 w-full text-brand-400" preserveAspectRatio="none">
          <polyline
            v-if="chartRuns.length"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            :points="sparkPts(chartRuns)"
          />
        </svg>
        <p class="text-[10px] text-slate-400">
          {{ chartRuns.length ? `Latest: ${chartLatest(chartRuns)}` : 'No data in selected window' }}
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Errors / hour (24h)</div>
        <svg viewBox="0 0 140 44" class="mt-2 h-14 w-full text-rose-400/90" preserveAspectRatio="none">
          <polyline
            v-if="chartErrors.length"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            :points="sparkPts(chartErrors)"
          />
        </svg>
        <p class="text-[10px] text-slate-400">
          {{ chartErrors.length ? `Latest: ${chartLatest(chartErrors)}` : 'No data in selected window' }}
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Runtime trend (avg ms)</div>
        <svg viewBox="0 0 140 44" class="mt-2 h-14 w-full text-amber-300/90" preserveAspectRatio="none">
          <polyline
            v-if="chartRuntime.length"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            :points="sparkPts(chartRuntime)"
          />
        </svg>
        <p class="text-[10px] text-slate-400">
          {{ chartRuntime.length ? `Latest: ${chartLatest(chartRuntime)} ms` : 'No data in selected window' }}
        </p>
      </div>
      <div class="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Messages processed / hour</div>
        <svg viewBox="0 0 140 44" class="mt-2 h-14 w-full text-sky-400/90" preserveAspectRatio="none">
          <polyline
            v-if="chartMessages.length"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            :points="sparkPts(chartMessages)"
          />
        </svg>
        <p class="text-[10px] text-slate-400">
          {{ chartMessages.length ? `Latest: ${chartLatest(chartMessages)}` : 'No data in selected window' }}
        </p>
      </div>
    </div>

    <!-- Adapter grid -->
    <div id="adapter-status-grid" class="rounded-xl border border-slate-800 bg-slate-900/30">
      <div class="border-b border-slate-800 px-3 py-2 text-sm font-semibold text-slate-200">Adapter status</div>
      <div class="grid gap-2 border-b border-slate-800 px-3 py-2 md:grid-cols-6">
        <input
          v-model="tableSearch"
          type="text"
          placeholder="Search name/key/provider"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 md:col-span-2"
        />
        <select
          v-model="tableStatusFilter"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="ALL">{{ t('adapterOpsDashboard.filterAll') }}</option>
          <option value="FAILED">{{ t('adapterOpsDashboard.statusFailed') }}</option>
          <option value="WARNING">{{ t('adapterOpsDashboard.statusWarning') }}</option>
          <option value="HEALTHY">{{ t('adapterOpsDashboard.statusHealthy') }}</option>
          <option value="MANUAL_OK">{{ t('adapterOpsDashboard.filterManualOk') }}</option>
          <option value="PAUSED">{{ t('adapterOpsDashboard.statusPaused') }}</option>
        </select>
        <select
          v-model="tableProviderFilter"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="ALL">All providers</option>
          <option v-for="provider in providerOptions" :key="provider" :value="provider">
            {{ provider }}
          </option>
        </select>
        <select
          v-model="tableSortBy"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="status">Sort: Status</option>
          <option value="errors">Sort: Errors 24h</option>
          <option value="success">Sort: Success %</option>
          <option value="runtime">Sort: Runtime</option>
          <option value="name">Sort: Name</option>
          <option value="provider">Sort: Provider</option>
        </select>
        <select
          v-model="tableSortDir"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1100px] border-collapse text-left text-xs">
          <thead>
            <tr class="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 text-[10px] uppercase tracking-wide text-slate-500">
              <th class="px-2 py-2">Name</th>
              <th class="px-2 py-2">Key</th>
              <th class="px-2 py-2">Type</th>
              <th class="px-2 py-2">Provider</th>
              <th class="px-2 py-2">Status</th>
              <th class="px-2 py-2">Active</th>
              <th class="px-2 py-2">Last run</th>
              <th class="px-2 py-2">Next run</th>
              <th class="px-2 py-2">Runtime ms</th>
              <th class="px-2 py-2">Msgs 24h</th>
              <th class="px-2 py-2">Err 24h</th>
              <th class="px-2 py-2">Success %</th>
              <th class="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="dashboardLoading && !adapters.length">
              <td colspan="13" class="px-3 py-6 text-center text-slate-500">Loading adapters…</td>
            </tr>
            <tr v-else-if="!filteredAdapters.length">
              <td colspan="13" class="px-3 py-6 text-center text-slate-500">No installed adapters.</td>
            </tr>
            <tr
              v-for="row in filteredAdapters"
              :key="row.adapterKey"
              class="cursor-pointer border-b border-slate-800/80 hover:bg-slate-900/50"
              @click="openDrawer(row.adapterKey)"
            >
              <td class="max-w-[140px] truncate px-2 py-1.5 font-medium text-slate-100">{{ row.name }}</td>
              <td class="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-brand-300">{{ row.adapterKey }}</td>
              <td class="px-2 py-1.5 text-slate-400">{{ row.adapterType || '—' }}</td>
              <td class="px-2 py-1.5 text-slate-400">{{ row.provider || '—' }}</td>
              <td
                class="whitespace-nowrap px-2 py-1.5 font-semibold"
                :class="gridStatusClass(row.status)"
                :title="adapterOpsGridStatusHint(row) || undefined"
              >
                {{ adapterOpsGridStatusLabel(row.status, row) }}
              </td>
              <td class="px-2 py-1.5 text-slate-300">{{ row.active ? 'true' : 'false' }}</td>
              <td
                class="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-400"
                :title="row.lastRun || undefined"
              >
                {{ row.lastRun ? formatDateTime(row.lastRun) : '—' }}
              </td>
              <td
                class="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-400"
                :title="row.nextRun || undefined"
              >
                {{ row.nextRun ? formatDateTime(row.nextRun) : '—' }}
              </td>
              <td class="px-2 py-1.5 font-mono text-slate-300">{{ row.runtimeMs ?? '—' }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-300">{{ row.messagesProcessed }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-300">{{ row.errorsCount }}</td>
              <td class="px-2 py-1.5 font-mono text-slate-300">{{ row.successRate != null ? `${row.successRate}%` : '—' }}</td>
              <td class="px-2 py-1.5">
                <div class="flex flex-wrap gap-1" @click.stop>
                  <button
                    type="button"
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-brand-300 hover:bg-slate-800 disabled:opacity-40"
                    :disabled="!canManageIntegrations || actionBusyKey === row.adapterKey"
                    :title="
                      !canManageIntegrations
                        ? 'Benötigt Berechtigung integrations.manage (z. B. Admin, Operator, Operations Manager)'
                        : ''
                    "
                    @click="openActionConfirm('run', row)"
                  >
                    {{ actionBusyKey === row.adapterKey ? actionBusyLabel('run') : 'Run' }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-slate-800 disabled:opacity-40"
                    :disabled="!canManageIntegrations || actionBusyKey === row.adapterKey"
                    :title="
                      !canManageIntegrations
                        ? 'Benötigt Berechtigung integrations.manage (z. B. Admin, Operator, Operations Manager)'
                        : ''
                    "
                    @click="openActionConfirm('pause', row)"
                  >
                    {{ actionBusyKey === row.adapterKey ? actionBusyLabel('pause') : 'Pause' }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-slate-800 disabled:opacity-40"
                    :disabled="!canManageIntegrations || actionBusyKey === row.adapterKey"
                    :title="
                      !canManageIntegrations
                        ? 'Benötigt Berechtigung integrations.manage (z. B. Admin, Operator, Operations Manager)'
                        : ''
                    "
                    @click="openActionConfirm('activate', row)"
                  >
                    {{ actionBusyKey === row.adapterKey ? actionBusyLabel('activate') : 'Activate' }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800 disabled:opacity-40"
                    :disabled="!canManageIntegrations || actionBusyKey === row.adapterKey"
                    :title="
                      !canManageIntegrations
                        ? 'Benötigt Berechtigung integrations.manage (z. B. Admin, Operator, Operations Manager)'
                        : ''
                    "
                    @click="openActionConfirm('disable', row)"
                  >
                    {{ actionBusyKey === row.adapterKey ? actionBusyLabel('disable') : 'Disable' }}
                  </button>
                  <RouterLink
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                    :to="{ name: 'integration-detail', params: { id: encodeURIComponent(row.adapterKey) } }"
                  >
                    Config
                  </RouterLink>
                  <RouterLink
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-slate-800"
                    :to="{
                      name: 'integration-detail',
                      params: { id: encodeURIComponent(row.adapterKey) },
                      hash: '#package-readme',
                    }"
                  >
                    Docs
                  </RouterLink>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!canManageIntegrations" class="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
        Actions require <span class="font-mono text-slate-400">integrations · manage</span>.
      </p>
    </div>

    <!-- Live events -->
    <div class="rounded-xl border border-slate-800 bg-slate-900/30">
      <div class="border-b border-slate-800 px-3 py-2 text-sm font-semibold text-slate-200">Live event stream</div>
      <div class="grid gap-2 border-b border-slate-800 px-3 py-2 md:grid-cols-4">
        <select
          v-model="eventLevelFilter"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
        >
          <option value="ALL">All levels</option>
          <option value="ERROR">Error</option>
          <option value="WARN">Warn</option>
          <option value="SUCCESS">Success</option>
          <option value="INFO">Info</option>
        </select>
        <select
          v-model.number="eventWindowMin"
          class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
        >
          <option :value="5">Window: 5 min</option>
          <option :value="15">Window: 15 min</option>
          <option :value="60">Window: 1 hour</option>
        </select>
        <label class="inline-flex items-center gap-2 text-xs text-slate-300">
          <input v-model="eventDedupe" type="checkbox" class="rounded border-slate-700 bg-slate-950" />
          Group duplicate messages
        </label>
        <button
          v-if="eventAdapterFilter"
          type="button"
          class="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
          @click="eventAdapterFilter = ''"
        >
          Clear adapter filter ({{ eventAdapterFilter }})
        </button>
      </div>
      <div class="max-h-52 overflow-y-auto divide-y divide-slate-800/80">
        <p
          v-if="eventDedupe && eventDuplicatesCollapsed > 0"
          class="border-b border-slate-800 px-3 py-1 text-[10px] text-slate-400"
        >
          Grouped duplicate events: {{ eventDuplicatesCollapsed }}
        </p>
        <div v-if="!visibleEvents.length" class="px-3 py-6 text-center text-xs text-slate-500">No recent merged events.</div>
        <div
          v-for="(ev, i) in visibleEvents"
          :key="i + ev.ts + (ev.adapterKey || '')"
          class="flex flex-wrap gap-2 px-3 py-1.5 text-[11px]"
        >
          <span class="font-mono text-slate-500" :title="ev.ts">{{ formatDateTime(ev.ts) }}</span>
          <button
            type="button"
            class="font-mono text-brand-400 hover:text-brand-300"
            @click="tableSearch = ev.adapterKey || ''; eventAdapterFilter = ev.adapterKey || ''"
          >
            {{ ev.adapterKey || '—' }}
          </button>
          <span class="rounded border px-1 py-0.5 text-[10px] font-semibold" :class="eventLevelClass(ev.level)">{{
            ev.level
          }}</span>
          <span
            v-if="ev.count > 1"
            class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-300"
            :title="`${ev.count} duplicate events merged`"
            >x{{ ev.count }}</span
          >
          <span class="min-w-0 flex-1 text-slate-300">{{ ev.message }}</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="actionConfirmOpen && confirmRow"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        @click.self="closeActionConfirm"
      >
        <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-2xl">
          <h3 class="text-sm font-semibold text-slate-100">Confirm adapter action</h3>
          <p class="mt-2 text-sm text-slate-300">
            Continue with
            <span class="font-semibold text-slate-100">{{ confirmActionKind }}</span>
            for <span class="font-mono text-brand-300">{{ confirmRow.adapterKey }}</span
            >?
          </p>
          <p class="mt-2 text-xs text-slate-400">This action updates adapter state immediately.</p>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-900"
              @click="closeActionConfirm"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500"
              @click="confirmAndRun"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Detail drawer -->
    <Teleport to="body">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-[1px]"
        @click.self="closeDrawer"
      >
        <div
          class="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
        >
          <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold text-white">{{ detail?.name || drawerKey }}</div>
              <div class="truncate font-mono text-[11px] text-brand-400">{{ drawerKey }}</div>
            </div>
            <button type="button" class="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-900" @click="closeDrawer">
              Close
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-3 text-sm text-slate-300">
            <div v-if="detailLoading" class="text-xs text-slate-500">Loading detail…</div>
            <template v-else-if="detail">
              <section class="space-y-2 border-b border-slate-800 pb-3">
                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Install</h3>
                <p class="text-xs">
                  Status <span class="font-mono text-slate-200">{{ detail.installStatus }}</span> · enabled
                  <span class="font-mono">{{ detail.enabled }}</span>
                </p>
                <p class="text-xs">Selected park / context: <span class="font-mono text-slate-200">{{ detail.selectedPark || '—' }}</span></p>
                <p class="text-xs">
                  Cron: <span class="font-mono text-slate-200">{{ detail.cronSchedule || '—' }}</span>
                </p>
                <p class="text-xs">
                  Outputs: MQTT <span class="font-mono">{{ detail.outputs.mqtt }}</span> · canonical
                  <span class="font-mono">{{ detail.outputs.canonical }}</span>
                </p>
              </section>

              <section class="space-y-2 border-b border-slate-800 py-3">
                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Config summary</h3>
                <p class="text-xs text-slate-400">Keys: {{ detail.configSummary.keys.join(', ') || '—' }}</p>
                <p class="text-xs text-slate-400">Profiles: {{ detail.configSummary.outputProfiles.join(', ') || '—' }}</p>
              </section>

              <section v-if="detail.themeParks && drawerKey && isThemeParksKey(drawerKey)" class="space-y-2 border-b border-slate-800 py-3">
                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">ThemeParks.wiki</h3>
                <dl class="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <dt class="text-slate-500">Selected park</dt>
                  <dd class="font-mono text-slate-200">{{ detail.themeParks.selectedParkName || detail.themeParks.selectedParkId || '—' }}</dd>
                  <dt class="text-slate-500">Last entities synced</dt>
                  <dd class="font-mono text-slate-200">
                    {{
                      detail.themeParks.lastEntitiesSyncedAt
                        ? formatDateTime(String(detail.themeParks.lastEntitiesSyncedAt))
                        : '—'
                    }}
                  </dd>
                  <dt class="text-slate-500">Last live observations</dt>
                  <dd class="font-mono text-slate-200">
                    {{
                      detail.themeParks.lastLiveObservationsAt
                        ? formatDateTime(String(detail.themeParks.lastLiveObservationsAt))
                        : '—'
                    }}
                    <span v-if="detail.themeParks.lastLiveObservationCount != null" class="text-slate-500">
                      ({{ detail.themeParks.lastLiveObservationCount }})</span>
                  </dd>
                  <dt class="text-slate-500">Mapped entities</dt>
                  <dd class="font-mono text-slate-200">{{ detail.themeParks.mappedEntityTotal }}</dd>
                  <dt class="text-slate-500">Attractions</dt>
                  <dd class="font-mono text-slate-200">{{ detail.themeParks.attractionsCount }}</dd>
                  <dt class="text-slate-500">Shows</dt>
                  <dd class="font-mono text-slate-200">{{ detail.themeParks.showsCount }}</dd>
                  <dt class="text-slate-500">Restaurants</dt>
                  <dd class="font-mono text-slate-200">{{ detail.themeParks.restaurantsCount }}</dd>
                  <dt class="text-slate-500">Other / children bucket</dt>
                  <dd class="font-mono text-slate-200">{{ detail.themeParks.childrenCount }}</dd>
                </dl>
              </section>

              <section class="space-y-2 border-b border-slate-800 py-3">
                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Last 10 runs</h3>
                <ul class="space-y-1 font-mono text-[10px] text-slate-400">
                  <li v-for="r in detail.last10Runs" :key="r.id" class="flex flex-wrap gap-2 border-b border-slate-800/60 pb-1">
                    <span>{{ formatDateTime(r.createdAt) }}</span>
                    <span :class="r.status === 'FAILED' ? 'text-rose-400' : r.status === 'PARTIAL' ? 'text-amber-400' : 'text-emerald-400'">{{ r.status }}</span>
                    <span>obs {{ r.observationCount }} / {{ r.durationMs ?? '—' }} ms</span>
                  </li>
                </ul>
                <p class="text-xs text-slate-400">
                  Avg runtime 24h:
                  <span class="font-mono text-slate-200">{{
                    detail.avgRuntimeMs24h != null ? `${Math.round(detail.avgRuntimeMs24h)} ms` : '—'
                  }}</span>
                </p>
              </section>

              <section v-if="detail.lastError" class="py-3">
                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-rose-400/90">Last error</h3>
                <pre class="mt-1 whitespace-pre-wrap break-words rounded border border-rose-900/50 bg-rose-950/30 p-2 text-[11px] text-rose-100">{{ detail.lastError }}</pre>
              </section>

              <div class="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-800 bg-slate-950/95 py-3">
                <button
                  type="button"
                  class="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-40"
                  :disabled="!canManageIntegrations || !drawerKey || actionBusyKey === drawerKey"
                  @click="runDrawerNow"
                >
                  Run now
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900"
                  @click="scrollToRawTail"
                >
                  Open raw logs
                </button>
                <RouterLink
                  v-if="drawerKey"
                  class="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900"
                  :to="{ name: 'integration-detail', params: { id: encodeURIComponent(drawerKey) } }"
                >
                  Open config
                </RouterLink>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Pipeline tail (existing behaviour) -->
    <div id="adapter-raw-log-tail" class="scroll-mt-24 space-y-3">
      <h2 class="text-sm font-semibold text-slate-200">Pipeline tail (raw)</h2>
      <p class="text-xs text-slate-500">
        NDJSON tail: scheduler skips, validation/MQTT issues, and adapter runtime events. Filter applies here only.
      </p>

      <div class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <label class="min-w-[200px] flex-1 text-xs text-slate-400">
          Adapter key (empty = all in window)
          <input
            v-model="adapterKeyFilter"
            type="text"
            placeholder="e.g. weather_open_meteo"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
            spellcheck="false"
            @keyup.enter="applyFilterToUrl"
          />
        </label>
        <label class="w-28 text-xs text-slate-400">
          Limit
          <input
            v-model.number="limit"
            type="number"
            min="1"
            max="500"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100"
          />
        </label>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
          :disabled="loading"
          @click="applyFilterToUrl"
        >
          {{ loading ? 'Loading…' : 'Refresh tail' }}
        </button>
      </div>

      <div v-if="data?.message" class="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
        {{ data.message }}
      </div>
      <div v-if="data?.readError" class="rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-sm text-rose-100">
        Read error: {{ data.readError }}
      </div>
      <p v-if="data" class="text-xs text-slate-500">
        <span class="font-mono text-slate-400">{{ data.logPath }}</span>
        · logging {{ data.loggingEnabled ? 'on' : 'off' }}
        <span v-if="data.fileExists === false"> · file not created yet</span>
        <span v-if="data.truncatedTail"> · tail truncated (large file)</span>
        <span v-if="data.totalParsedInTail != null"> · {{ data.totalParsedInTail }} lines parsed in tail</span>
      </p>

      <div v-if="loading && !data" class="rounded-xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-500">
        Loading…
      </div>
      <div
        v-else-if="!rows.length"
        class="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500"
      >
        No entries in the current tail window{{ adapterKeyFilter.trim() ? ' for this adapter' : '' }}.
      </div>
      <div v-else class="overflow-x-auto rounded-xl border border-slate-800">
        <table class="w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr class="border-b border-slate-800 bg-slate-950/80 text-[10px] uppercase tracking-wide text-slate-500">
              <th class="px-3 py-2">Time</th>
              <th class="px-3 py-2">Level</th>
              <th class="px-3 py-2">Adapter</th>
              <th class="px-3 py-2">Source</th>
              <th class="px-3 py-2">Event</th>
              <th class="px-3 py-2">Message</th>
              <th class="w-20 px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(row, idx) in rows" :key="row.ts + row.event + idx">
              <tr class="border-b border-slate-800/80 hover:bg-slate-900/40">
                <td class="whitespace-nowrap px-3 py-2 font-mono text-slate-400">{{ row.ts }}</td>
                <td class="px-3 py-2">
                  <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase" :class="tailLevelClass(row)">
                    {{ row.level }}
                  </span>
                </td>
                <td class="px-3 py-2 font-mono text-brand-300">{{ row.adapterKey || '—' }}</td>
                <td class="px-3 py-2 text-slate-400">{{ row.source }}</td>
                <td class="px-3 py-2 font-mono text-slate-300">{{ row.event }}</td>
                <td class="max-w-md px-3 py-2 text-slate-200">{{ row.message }}</td>
                <td class="px-3 py-2">
                  <button
                    v-if="row.detail !== undefined"
                    type="button"
                    class="text-brand-400 hover:text-brand-300"
                    @click="toggleRow(`${idx}-${row.ts}`)"
                  >
                    {{ expanded[`${idx}-${row.ts}`] ? 'Hide' : 'JSON' }}
                  </button>
                  <span v-else class="text-slate-600">—</span>
                </td>
              </tr>
              <tr v-if="expanded[`${idx}-${row.ts}`] && row.detail !== undefined" class="border-b border-slate-800 bg-slate-950/60">
                <td colspan="7" class="px-3 py-2">
                  <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-400">{{
                    JSON.stringify(row.detail, null, 2)
                  }}</pre>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
