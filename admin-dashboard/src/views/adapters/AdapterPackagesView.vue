<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getAdapterPackages, postAdapterPackageHealth } from '@/api/client'
import type { AdapterPackageDto, AdapterPackagesResponse } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'

const { formatDateTime } = useRegionalDateTime()

function dataSummary(pkg: AdapterPackageDto): string {
  const bits: string[] = []
  const dom = pkg.providedDomains?.filter(Boolean) ?? []
  const met = pkg.providedMetrics?.filter(Boolean) ?? []
  if (dom.length) bits.push(`UNS domains: ${dom.join(', ')}`)
  if (met.length) bits.push(`metrics: ${met.join(', ')}`)
  const caps = pkg.capabilities ?? []
  const pipe: string[] = []
  if (caps.includes('UNS_OUTPUT')) pipe.push('UNS-shaped observations')
  if (caps.includes('CANONICAL_OUTPUT')) pipe.push('canonical integration pipeline')
  if (caps.includes('POLLING')) pipe.push('polling / live')
  if (caps.includes('DISCOVERY')) pipe.push('discovery')
  if (pipe.length) bits.push(`outputs: ${pipe.join(', ')}`)
  if (!bits.length) return 'No declared domains/metrics in manifest; see capabilities below.'
  return bits.join(' · ')
}

const { push } = useToast()

const loading = ref(true)
const errorMessage = ref('')
const response = ref<AdapterPackagesResponse | null>(null)
const search = ref('')

type HealthRow = { state: 'idle' | 'loading' | 'ok' | 'error'; message?: string; checkedAt?: string }
const healthByKey = ref<Record<string, HealthRow>>({})

const packages = computed(() => response.value?.packages ?? [])

const filteredPackages = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return packages.value
  return packages.value.filter((p) => {
    const hay = [
      p.name,
      p.adapterKey,
      p.version,
      p.adapterType,
      p.runtime,
      p.iotClass || '',
      p.status || '',
      p.sourcePath || '',
      p.sourceType || '',
      p.description || '',
      ...(p.capabilities || []),
      ...(p.providedDomains || []),
      ...(p.providedMetrics || []),
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

async function load() {
  loading.value = true
  errorMessage.value = ''
  healthByKey.value = {}
  try {
    response.value = await getAdapterPackages()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load adapter packages'
    errorMessage.value = msg
    response.value = null
    push(msg, 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

function chipClass(kind: 'cap' | 'domain' | 'metric') {
  if (kind === 'domain') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (kind === 'metric') return 'border-violet-500/30 bg-violet-500/10 text-violet-200'
  return 'border-slate-600 bg-slate-800/80 text-slate-200'
}

function healthRow(key: string): HealthRow {
  return healthByKey.value[key] || { state: 'idle' }
}

function sourceSummary(pkg: AdapterPackageDto): string {
  if (pkg.source === 'scan') {
    const hasDb = pkg.status != null || pkg.enabled !== undefined || pkg.sourcePath != null
    return hasDb ? 'Filesystem + DB registry' : 'Filesystem scan only'
  }
  return 'DB registry only'
}

async function runPackageHealth(adapterKey: string) {
  healthByKey.value = { ...healthByKey.value, [adapterKey]: { state: 'loading' } }
  try {
    const data = await postAdapterPackageHealth(adapterKey, {})
    const ok = Boolean(data.ok)
    const msg =
      (typeof data.message === 'string' && data.message) ||
      (typeof data.error === 'string' && data.error) ||
      (ok ? 'Reachable' : 'Not OK')
    healthByKey.value = {
      ...healthByKey.value,
      [adapterKey]: { state: ok ? 'ok' : 'error', message: msg, checkedAt: new Date().toISOString() },
    }
    push(msg, ok ? 'success' : 'error')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Health check failed'
    healthByKey.value = {
      ...healthByKey.value,
      [adapterKey]: { state: 'error', message: msg, checkedAt: new Date().toISOString() },
    }
    push(msg, 'error')
  }
}
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Adapter packages</h1>
        <p class="mt-1 text-sm text-slate-400">
          Local Node.js adapter packages available in the platform (registry and filesystem scan).
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="Search name, key, capabilities…"
          class="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 sm:max-w-xs"
        />
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          :disabled="loading"
          @click="load"
        >
          Refresh packages
        </button>
      </div>
    </div>

    <div
      v-if="errorMessage"
      class="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <div v-if="loading" class="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
      Loading adapter packages…
    </div>

    <template v-else>
      <p v-if="!filteredPackages.length" class="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
        No packages match your search.
        <span v-if="!packages.length"> No adapter packages were returned from the API.</span>
      </p>

      <div
        v-else
        class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <article
          v-for="pkg in filteredPackages"
          :key="pkg.adapterKey"
          class="flex flex-col rounded-xl border bg-slate-900/60 p-4 shadow-panel"
          :class="
            pkg.source === 'scan' && pkg.manifestValid === false
              ? 'border-amber-500/40'
              : 'border-slate-800'
          "
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 class="truncate font-display text-base font-semibold text-white">{{ pkg.name }}</h2>
              <p class="mt-1 font-mono text-xs text-brand-200">{{ pkg.adapterKey }}</p>
            </div>
            <span
              v-if="pkg.source === 'scan' && pkg.manifestValid === false"
              class="shrink-0 rounded border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-200"
            >
              Manifest issues
            </span>
          </div>

          <p class="mt-2 text-[11px] text-slate-500">
            {{ sourceSummary(pkg) }}
            <span v-if="pkg.enabled === false" class="text-amber-300"> · disabled in DB</span>
          </p>

          <div class="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Adapter detail</p>
            <p class="mt-1 text-xs font-medium text-slate-200">
              <span class="text-slate-400">Version</span>
              {{ ' ' }}
              <span class="text-white">{{ pkg.version || '—' }}</span>
            </p>
            <p class="mt-2 text-xs leading-relaxed text-slate-300">
              {{ pkg.description || 'No description in manifest. Add a "description" field to manifest.json or reload packages after upgrading the backend.' }}
            </p>
            <p class="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Declared data</p>
            <p class="mt-1 text-xs leading-relaxed text-slate-400">{{ dataSummary(pkg) }}</p>
          </div>

          <div class="mt-3 rounded-lg border border-slate-800 bg-slate-950/50 p-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Connectivity health</p>
                <p class="mt-0.5 truncate text-[11px] text-slate-400">
                  <template v-if="healthRow(pkg.adapterKey).state === 'idle'">Not checked yet — uses adapter runtime health (e.g. HTTP to provider).</template>
                  <template v-else-if="healthRow(pkg.adapterKey).state === 'loading'">Running…</template>
                  <template v-else>{{ healthRow(pkg.adapterKey).message }}</template>
                </p>
                <p v-if="healthRow(pkg.adapterKey).checkedAt" class="mt-0.5 text-[10px] text-slate-600">
                  {{ formatDateTime(healthRow(pkg.adapterKey).checkedAt!) }}
                </p>
              </div>
              <span
                class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
                :class="{
                  'border-emerald-500/40 bg-emerald-500/10 text-emerald-200': healthRow(pkg.adapterKey).state === 'ok',
                  'border-rose-500/40 bg-rose-500/10 text-rose-200': healthRow(pkg.adapterKey).state === 'error',
                  'border-slate-600 text-slate-500': healthRow(pkg.adapterKey).state === 'idle',
                  'border-brand-500/40 text-brand-200': healthRow(pkg.adapterKey).state === 'loading',
                }"
              >
                {{
                  healthRow(pkg.adapterKey).state === 'idle'
                    ? 'Unknown'
                    : healthRow(pkg.adapterKey).state === 'loading'
                      ? '…'
                      : healthRow(pkg.adapterKey).state === 'ok'
                        ? 'OK'
                        : 'Fail'
                }}
              </span>
            </div>
            <button
              type="button"
              class="mt-2 w-full rounded-lg border border-brand-600/50 bg-brand-600/20 px-3 py-1.5 text-xs font-medium text-brand-100 hover:bg-brand-600/30 disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="healthRow(pkg.adapterKey).state === 'loading'"
              @click="runPackageHealth(pkg.adapterKey)"
            >
              Run connectivity health
            </button>
          </div>

          <details class="mt-2 rounded-lg border border-slate-800 bg-slate-950/30 px-2 py-1 text-xs text-slate-400">
            <summary class="cursor-pointer select-none text-brand-300 hover:text-brand-200">Technical paths + DB</summary>
            <dl class="mt-2 space-y-1.5 border-t border-slate-800/80 pt-2 pb-1">
              <div v-if="pkg.packageDir" class="grid gap-0.5">
                <dt class="text-slate-500">Package dir (scan)</dt>
                <dd class="break-all font-mono text-[10px] text-slate-300">{{ pkg.packageDir }}</dd>
              </div>
              <div v-if="pkg.sourcePath" class="grid gap-0.5">
                <dt class="text-slate-500">DB source path</dt>
                <dd class="break-all font-mono text-[10px] text-slate-300">{{ pkg.sourcePath }}</dd>
              </div>
              <div v-if="pkg.sourceType" class="flex justify-between gap-2">
                <dt class="text-slate-500">DB source type</dt>
                <dd class="text-slate-200">{{ pkg.sourceType }}</dd>
              </div>
              <div v-if="pkg.status" class="flex justify-between gap-2">
                <dt class="text-slate-500">DB status</dt>
                <dd class="text-slate-200">{{ pkg.status }}</dd>
              </div>
              <div v-if="pkg.enabled !== undefined" class="flex justify-between gap-2">
                <dt class="text-slate-500">Enabled (DB)</dt>
                <dd class="text-slate-200">{{ pkg.enabled ? 'yes' : 'no' }}</dd>
              </div>
              <p v-if="!pkg.packageDir && !pkg.sourcePath && pkg.status == null && pkg.enabled === undefined" class="text-slate-500">
                No extra registry paths on this row.
              </p>
            </dl>
          </details>

          <dl class="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-400">
            <dt class="text-slate-500">Runtime</dt>
            <dd class="text-right font-mono text-slate-200">{{ pkg.runtime || '—' }}</dd>
            <dt class="text-slate-500">Type</dt>
            <dd class="text-right text-slate-200">{{ pkg.adapterType || '—' }}</dd>
            <dt v-if="pkg.iotClass" class="text-slate-500">IoT class</dt>
            <dd v-if="pkg.iotClass" class="text-right text-slate-200">{{ pkg.iotClass }}</dd>
          </dl>

          <div v-if="pkg.capabilities?.length" class="mt-3">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Capabilities</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="c in pkg.capabilities"
                :key="c"
                class="inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium"
                :class="chipClass('cap')"
              >
                {{ c }}
              </span>
            </div>
          </div>

          <div v-if="pkg.providedDomains?.length" class="mt-2">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Domains</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="d in pkg.providedDomains"
                :key="d"
                class="inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium"
                :class="chipClass('domain')"
              >
                {{ d }}
              </span>
            </div>
          </div>

          <div v-if="pkg.providedMetrics?.length" class="mt-2">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Metrics</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="m in pkg.providedMetrics"
                :key="m"
                class="inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium"
                :class="chipClass('metric')"
              >
                {{ m }}
              </span>
            </div>
          </div>

          <div v-if="pkg.manifestErrors?.length" class="mt-2 text-[11px] text-amber-200/90">
            {{ pkg.manifestErrors.join('; ') }}
          </div>

          <div class="mt-4 flex flex-wrap gap-2 border-t border-slate-800/80 pt-3">
            <button
              type="button"
              disabled
              class="cursor-not-allowed rounded-lg border border-slate-700/80 bg-slate-950/50 px-3 py-1.5 text-xs text-slate-500"
              title="Next step"
            >
              View details — Next step
            </button>
            <button
              type="button"
              disabled
              class="cursor-not-allowed rounded-lg border border-slate-700/80 bg-slate-950/50 px-3 py-1.5 text-xs text-slate-500"
              title="Next step"
            >
              Run preview — Next step
            </button>
            <button
              type="button"
              disabled
              class="cursor-not-allowed rounded-lg border border-slate-700/80 bg-slate-950/50 px-3 py-1.5 text-xs text-slate-500"
              title="Next step"
            >
              Install — Next step
            </button>
          </div>
        </article>
      </div>

      <section
        v-if="response?.meta && Object.keys(response.meta).length"
        class="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
      >
        <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">Raw meta (debug)</h3>
        <pre class="mt-2 max-h-48 overflow-auto text-[11px] text-slate-400">{{ JSON.stringify(response.meta, null, 2) }}</pre>
      </section>
    </template>
  </div>
</template>
