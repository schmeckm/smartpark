<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

const expanded = ref<Record<string, boolean>>({})

function toggleRow(id: string) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

const rows = computed(() => data.value?.entries ?? [])
const events = computed(() => dash.value?.events ?? [])
const adapters = computed(() => dash.value?.adapters ?? [])
const kpis = computed(() => dash.value?.kpis ?? null)

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
  return 'text-emerald-300'
}

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
  if (!canManageIntegrations.value) return
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
  } catch (e) {
    push(e instanceof Error ? e.message : `${label} failed`, 'error')
  } finally {
    actionBusyKey.value = null
  }
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
        class="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-50"
        :disabled="dashboardLoading || loading"
        @click="refreshAll()"
      >
        Refresh all
      </button>
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

    <!-- KPI cards -->
    <div
      v-if="kpis"
      class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total adapters</div>
        <div class="font-mono text-lg text-white">{{ kpis.totalAdapters }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Active</div>
        <div class="font-mono text-lg text-emerald-300">{{ kpis.activeAdapters }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Healthy</div>
        <div class="font-mono text-lg text-emerald-200">{{ kpis.healthyAdapters }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Warning</div>
        <div class="font-mono text-lg text-amber-300">{{ kpis.warningAdapters }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Failed</div>
        <div class="font-mono text-lg text-rose-300">{{ kpis.failedAdapters }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Paused</div>
        <div class="font-mono text-lg text-slate-400">{{ kpis.pausedAdapters }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Runs today</div>
        <div class="font-mono text-lg text-white">{{ kpis.runsToday }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">MQTT publish errors today</div>
        <div class="font-mono text-lg text-rose-300">{{ kpis.mqttPublishErrorsToday }}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Avg runtime (today)</div>
        <div class="font-mono text-lg text-brand-300">
          {{ kpis.avgRuntimeSecToday != null ? `${kpis.avgRuntimeSecToday}s` : '—' }}
        </div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Last scheduler row</div>
        <div
          class="truncate font-mono text-[11px] text-slate-300"
          :title="kpis.lastSchedulerRun || undefined"
        >
          {{ kpis.lastSchedulerRun ? formatDateTime(kpis.lastSchedulerRun) : '—' }}
        </div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
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
      </div>
    </div>

    <!-- Adapter grid -->
    <div class="rounded-xl border border-slate-800 bg-slate-900/30">
      <div class="border-b border-slate-800 px-3 py-2 text-sm font-semibold text-slate-200">Adapter status</div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[1100px] border-collapse text-left text-xs">
          <thead>
            <tr class="border-b border-slate-800 bg-slate-950/80 text-[10px] uppercase tracking-wide text-slate-500">
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
            <tr v-else-if="!adapters.length">
              <td colspan="13" class="px-3 py-6 text-center text-slate-500">No installed adapters.</td>
            </tr>
            <tr
              v-for="row in adapters"
              :key="row.adapterKey"
              class="cursor-pointer border-b border-slate-800/80 hover:bg-slate-900/50"
              @click="openDrawer(row.adapterKey)"
            >
              <td class="max-w-[140px] truncate px-2 py-1.5 font-medium text-slate-100">{{ row.name }}</td>
              <td class="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-brand-300">{{ row.adapterKey }}</td>
              <td class="px-2 py-1.5 text-slate-400">{{ row.adapterType || '—' }}</td>
              <td class="px-2 py-1.5 text-slate-400">{{ row.provider || '—' }}</td>
              <td class="whitespace-nowrap px-2 py-1.5 font-semibold" :class="gridStatusClass(row.status)">
                {{ row.status }}
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
                    @click="runAction('Run now', postAdapterOpsRunNow, row)"
                  >
                    Run
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
                    @click="runAction('Paused', postAdapterOpsPause, row)"
                  >
                    Pause
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
                    @click="runAction('Activated', postAdapterOpsActivate, row)"
                  >
                    Activate
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
                    @click="runAction('Disabled', postAdapterOpsDisable, row)"
                  >
                    Disable
                  </button>
                  <RouterLink
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                    :to="{ name: 'integration-detail', params: { id: encodeURIComponent(row.adapterKey) } }"
                  >
                    Config
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
      <div class="max-h-52 overflow-y-auto divide-y divide-slate-800/80">
        <div v-if="!events.length" class="px-3 py-6 text-center text-xs text-slate-500">No recent merged events.</div>
        <div v-for="(ev, i) in events" :key="i + ev.ts + (ev.adapterKey || '')" class="flex flex-wrap gap-2 px-3 py-1.5 text-[11px]">
          <span class="font-mono text-slate-500" :title="ev.ts">{{ formatDateTime(ev.ts) }}</span>
          <span class="font-mono text-brand-400">{{ ev.adapterKey || '—' }}</span>
          <span class="rounded border px-1 py-0.5 text-[10px] font-semibold" :class="eventLevelClass(ev.level)">{{
            ev.level
          }}</span>
          <span class="min-w-0 flex-1 text-slate-300">{{ ev.message }}</span>
        </div>
      </div>
    </div>

    <!-- Detail drawer -->
    <Teleport to="body">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-[1px]"
        role="presentation"
        @click.self="closeDrawer"
      >
        <div
          class="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
          role="dialog"
          aria-modal="true"
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
