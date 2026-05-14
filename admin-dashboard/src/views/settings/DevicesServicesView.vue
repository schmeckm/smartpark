<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { getAdapterOpsDashboard, getInstalledAdapters } from '@/api/client'
import type { AdapterOpsGridRow } from '@/api/client'
import type { AdapterPackageDto, AdapterPackagesResponse } from '@/types/api'
import { useToast } from '@/composables/useToast'
import ProviderSelectDialog from './ProviderSelectDialog.vue'

const router = useRouter()
const { push } = useToast()

const search = ref('')
const loading = ref(true)
const response = ref<AdapterPackagesResponse | null>(null)
const addOpen = ref(false)
/** Per-adapter: hide broken logo URLs and show initial letter instead. */
const logoFailedByKey = ref<Record<string, boolean>>({})

/** Live ops telemetry, keyed by adapterKey. Empty when telemetry endpoint is unavailable. */
const opsByKey = ref<Record<string, AdapterOpsGridRow>>({})
const opsLoading = ref(false)
const opsFailed = ref(false)
/** Forces relativeTime() recomputation every minute so "2m ago" doesn't go stale. */
const nowTick = ref(Date.now())
let nowInterval: ReturnType<typeof setInterval> | null = null
let opsInterval: ReturnType<typeof setInterval> | null = null

const integrations = computed(() => response.value?.packages ?? [])
const opsSummary = computed(() => {
  const keys = integrations.value.map((pkg) => pkg.adapterKey)
  if (!keys.length) return null
  let live = 0
  let stale = 0
  let error = 0
  let disabled = 0
  let seen = 0
  for (const key of keys) {
    const row = opsByKey.value[key]
    if (!row) continue
    seen += 1
    if (!row.enabled) {
      disabled += 1
      continue
    }
    if ((row.status || '').toLowerCase() === 'failed' || (row.errorsCount > 0 && (row.successRate ?? 1) < 0.5)) {
      error += 1
      continue
    }
    if (!row.lastRun) {
      stale += 1
      continue
    }
    const lastTs = Date.parse(row.lastRun)
    if (!Number.isFinite(lastTs)) {
      stale += 1
      continue
    }
    const ageMs = nowTick.value - lastTs
    if (ageMs < 10 * 60_000 && row.active) live += 1
    else stale += 1
  }
  return { total: keys.length, seen, live, stale, error, disabled }
})

function markLogoFailed(adapterKey: string) {
  if (logoFailedByKey.value[adapterKey]) return
  logoFailedByKey.value = { ...logoFailedByKey.value, [adapterKey]: true }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return integrations.value
  return integrations.value.filter((p) => {
    const tags = (p.ui?.tags || []).join(' ')
    return [p.name, p.adapterKey, p.description, tags].join(' ').toLowerCase().includes(q)
  })
})

async function load() {
  loading.value = true
  try {
    response.value = await getInstalledAdapters()
    logoFailedByKey.value = {}
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load integrations', 'error')
  } finally {
    loading.value = false
  }
}

async function loadOps() {
  opsLoading.value = true
  try {
    const dash = await getAdapterOpsDashboard()
    const map: Record<string, AdapterOpsGridRow> = {}
    for (const row of dash.adapters || []) {
      if (row?.adapterKey) map[row.adapterKey] = row
    }
    opsByKey.value = map
    opsFailed.value = false
  } catch {
    // Telemetry is optional — degrade gracefully (e.g. missing permission, dev env).
    opsFailed.value = true
  } finally {
    opsLoading.value = false
  }
}

function openCard(pkg: AdapterPackageDto) {
  const id = encodeURIComponent(pkg.id || pkg.adapterKey)
  router.push({ name: 'integration-detail', params: { id } })
}

function titleCase(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function statusBadge(pkg: AdapterPackageDto) {
  const s = (pkg.status || '').toUpperCase()
  if (s === 'ERROR') {
    return { label: 'Error', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-200' }
  }
  if (s === 'ACTIVE' || s === 'INSTALLED') {
    return { label: 'Active', cls: 'border-slate-700 bg-slate-800/60 text-slate-200' }
  }
  return {
    label: s ? titleCase(s) : 'Unknown',
    cls: 'border-slate-700 bg-slate-800/60 text-slate-400',
  }
}

function iotBadge(iot: string | null | undefined) {
  if (!iot) return null
  return {
    label: titleCase(iot),
    cls: 'border-slate-700 bg-slate-800/60 text-slate-300',
  }
}

function tierClass(t: string | null | undefined) {
  if (t === 'CORE') return 'border-sky-500/40 bg-sky-500/10 text-sky-200'
  if (t === 'VERIFIED') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (t === 'COMMUNITY') return 'border-violet-500/40 bg-violet-500/10 text-violet-200'
  return 'border-slate-600 bg-slate-800 text-slate-300'
}

function hasCounts(pkg: AdapterPackageDto): boolean {
  return pkg.deviceCount != null || pkg.entityCount != null || pkg.serviceCount != null
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  // nowTick is read so the computed re-runs on the 1-min interval.
  const diffMs = nowTick.value - t
  if (diffMs < 0) return 'just now'
  const sec = Math.round(diffMs / 1000)
  if (sec < 45) return 'just now'
  if (sec < 90) return '1m ago'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  return `${day}d ago`
}

type LiveTone = 'live' | 'idle' | 'warn' | 'error' | 'off' | 'unknown'

interface LiveState {
  tone: LiveTone
  label: string
  detail: string
  /** ARIA description used by screen readers. */
  aria: string
}

function formatAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  return new Date(ts).toLocaleString()
}

function liveState(pkg: AdapterPackageDto): LiveState {
  const ops = opsByKey.value[pkg.adapterKey]
  if (!ops) {
    if (opsLoading.value) return { tone: 'unknown', label: '…', detail: '', aria: 'Loading telemetry' }
    if (opsFailed.value) return { tone: 'unknown', label: 'No telemetry', detail: '', aria: 'Telemetry unavailable' }
    return { tone: 'off', label: 'Idle', detail: '', aria: 'No runs recorded' }
  }
  if (!ops.enabled) {
    return { tone: 'off', label: 'Disabled', detail: relativeTime(ops.lastRun), aria: 'Adapter disabled' }
  }
  if (
    (ops.status || '').toLowerCase() === 'failed' ||
    (ops.errorsCount > 0 && (ops.successRate ?? 1) < 0.5)
  ) {
    return {
      tone: 'error',
      label: 'Error',
      detail: relativeTime(ops.lastRun),
      aria: `Errors detected, last run ${relativeTime(ops.lastRun) || 'unknown'}`,
    }
  }
  if (!ops.lastRun) {
    return { tone: 'idle', label: 'Awaiting first run', detail: '', aria: 'Awaiting first run' }
  }
  const lastTs = Date.parse(ops.lastRun)
  if (!Number.isFinite(lastTs)) {
    return { tone: 'idle', label: 'Idle', detail: '', aria: 'Idle' }
  }
  const ageMs = nowTick.value - lastTs
  const msgsBit = ops.messagesProcessed > 0 ? ` · ${ops.messagesProcessed} msgs` : ''
  if (ageMs < 10 * 60_000 && ops.active) {
    return {
      tone: 'live',
      label: 'Live',
      detail: `${relativeTime(ops.lastRun)}${msgsBit}`,
      aria: `Receiving data, last update ${relativeTime(ops.lastRun)}`,
    }
  }
  if (ageMs < 60 * 60_000) {
    return {
      tone: 'idle',
      label: 'Idle',
      detail: relativeTime(ops.lastRun),
      aria: `Idle, last run ${relativeTime(ops.lastRun)}`,
    }
  }
  return {
    tone: 'warn',
    label: 'Stale',
    detail: relativeTime(ops.lastRun),
    aria: `No recent data, last run ${relativeTime(ops.lastRun)}`,
  }
}

function liveDotClass(tone: LiveTone): string {
  switch (tone) {
    case 'live':
      return 'bg-emerald-400 ring-2 ring-emerald-400/30 animate-pulse'
    case 'warn':
      return 'bg-amber-400'
    case 'error':
      return 'bg-rose-500'
    case 'off':
      return 'bg-slate-600'
    case 'unknown':
      return 'bg-slate-500'
    case 'idle':
    default:
      return 'bg-slate-400'
  }
}

function liveTextClass(tone: LiveTone): string {
  switch (tone) {
    case 'live':
      return 'text-emerald-300'
    case 'warn':
      return 'text-amber-300'
    case 'error':
      return 'text-rose-300'
    case 'off':
      return 'text-slate-500'
    case 'unknown':
      return 'text-slate-500'
    case 'idle':
    default:
      return 'text-slate-300'
  }
}

function liveStateHelpText(pkg: AdapterPackageDto): string {
  const state = liveState(pkg)
  const ops = opsByKey.value[pkg.adapterKey]
  const lastRunAbs = formatAbsoluteTime(ops?.lastRun)
  const lastRunBit = lastRunAbs ? ` Last run: ${lastRunAbs}.` : ''
  return `State help: Live = active and updated in the last 10 minutes. Idle = last run is 10-60 minutes ago. Stale = last run older than 60 minutes. Awaiting first run = no run yet. Disabled = adapter disabled. Current: ${state.label}.${lastRunBit}`
}

function onInstalled() {
  void load()
  void loadOps()
}

onMounted(() => {
  void load()
  void loadOps()
  nowInterval = setInterval(() => {
    nowTick.value = Date.now()
  }, 60_000)
  opsInterval = setInterval(() => {
    void loadOps()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (nowInterval) clearInterval(nowInterval)
  if (opsInterval) clearInterval(opsInterval)
})
</script>

<template>
  <div class="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="font-display text-xl font-semibold text-white">Adapter</h1>
        <p class="mt-1 text-sm text-slate-400">Manage integrations and installed adapter packages.</p>
        <p v-if="opsSummary" class="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-slate-500">Telemetry</span>
          <span class="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
            {{ opsSummary.live }} live
          </span>
          <span class="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-rose-300">
            {{ opsSummary.error }} error
          </span>
          <span class="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-300">
            {{ opsSummary.stale }} stale
          </span>
          <span class="rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-slate-300">
            {{ opsSummary.disabled }} disabled
          </span>
          <span class="text-slate-500">{{ opsSummary.seen }}/{{ opsSummary.total }} with signals</span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative">
          <svg
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 3 3" stroke-linecap="round" />
          </svg>
          <input
            v-model="search"
            type="search"
            placeholder="Search…"
            class="min-w-[220px] rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <RouterLink
          to="/settings/adapter-pipeline-log"
          class="inline-flex items-center rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-slate-100"
        >
          Operations center
        </RouterLink>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-500"
          @click="addOpen = true"
        >
          <span aria-hidden="true">+</span>
          <span>Integration</span>
        </button>
      </div>
    </div>

    <div
      v-if="loading"
      class="rounded-xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-500"
    >
      Loading…
    </div>
    <div
      v-else-if="!filtered.length"
      class="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500"
    >
      No integrations yet. Use
      <strong class="text-slate-300">+ Integration</strong>
      to add a local adapter package.
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <button
        v-for="pkg in filtered"
        :key="pkg.adapterKey"
        type="button"
        class="group flex w-full flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left shadow-panel transition hover:-translate-y-0.5 hover:border-brand-500/50 hover:bg-slate-900/90"
        @click="openCard(pkg)"
      >
        <div class="flex items-start gap-3">
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
          >
            <img
              v-if="pkg.logoAssetUrl && !logoFailedByKey[pkg.adapterKey]"
              :src="pkg.logoAssetUrl"
              alt=""
              class="h-full w-full object-contain p-1.5"
              @error="markLogoFailed(pkg.adapterKey)"
            />
            <span v-else class="font-display text-lg font-semibold text-slate-400">
              {{ pkg.name.slice(0, 1) }}
            </span>
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="truncate font-display text-base font-semibold leading-tight text-slate-50">
              {{ pkg.name }}
            </h2>
            <p class="mt-1 line-clamp-2 text-xs leading-snug text-slate-400">
              {{ pkg.description || pkg.ui?.description || '—' }}
            </p>
          </div>
          <svg
            class="h-4 w-4 shrink-0 text-slate-600 opacity-0 transition group-hover:translate-x-0.5 group-hover:text-brand-400 group-hover:opacity-100"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <path d="m7 4 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>

        <div
          class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
          :title="liveStateHelpText(pkg)"
          :aria-label="liveState(pkg).aria"
        >
          <span
            class="inline-flex h-2 w-2 shrink-0 rounded-full"
            :class="liveDotClass(liveState(pkg).tone)"
            aria-hidden="true"
          />
          <span class="font-medium" :class="liveTextClass(liveState(pkg).tone)">
            {{ liveState(pkg).label }}
          </span>
          <span v-if="liveState(pkg).detail" class="text-slate-500">
            · {{ liveState(pkg).detail }}
          </span>
          <span
            class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] font-semibold text-slate-400"
            :title="liveStateHelpText(pkg)"
            aria-hidden="true"
          >
            ?
          </span>
        </div>

        <div class="flex flex-wrap gap-1">
          <span
            v-if="pkg.ui?.qualityTier"
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="tierClass(pkg.ui.qualityTier)"
          >
            {{ titleCase(pkg.ui.qualityTier) }}
          </span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="statusBadge(pkg).cls"
          >
            {{ statusBadge(pkg).label }}
          </span>
          <span
            v-if="iotBadge(pkg.iotClass)"
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="iotBadge(pkg.iotClass)!.cls"
          >
            {{ iotBadge(pkg.iotClass)!.label }}
          </span>
        </div>

        <div
          v-if="hasCounts(pkg)"
          class="mt-auto flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-800/80 pt-2 text-[11px] text-slate-500"
        >
          <span v-if="pkg.deviceCount != null">{{ pkg.deviceCount }} devices</span>
          <span v-if="pkg.entityCount != null">{{ pkg.entityCount }} entities</span>
          <span v-if="pkg.serviceCount != null">{{ pkg.serviceCount }} services</span>
        </div>
      </button>
    </div>

    <ProviderSelectDialog v-model:open="addOpen" @installed="onInstalled" />
  </div>
</template>
