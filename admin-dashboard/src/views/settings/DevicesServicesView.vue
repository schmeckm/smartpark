<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { getInstalledAdapters } from '@/api/client'
import type { AdapterPackageDto, AdapterPackagesResponse } from '@/types/api'
import { useToast } from '@/composables/useToast'
import AdapterUiBanner from '@/components/adapter/AdapterUiBanner.vue'
import ProviderSelectDialog from './ProviderSelectDialog.vue'

const router = useRouter()
const { push } = useToast()

const search = ref('')
const loading = ref(true)
const response = ref<AdapterPackagesResponse | null>(null)
const addOpen = ref(false)
/** Per-adapter: hide broken logo URLs and show initial letter instead. */
const logoFailedByKey = ref<Record<string, boolean>>({})

const integrations = computed(() => response.value?.packages ?? [])

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

function openCard(pkg: AdapterPackageDto) {
  const id = encodeURIComponent(pkg.id || pkg.adapterKey)
  router.push({ name: 'integration-detail', params: { id } })
}

function statusBadge(pkg: AdapterPackageDto) {
  const s = (pkg.status || '').toUpperCase()
  if (s === 'ACTIVE' || s === 'INSTALLED') return { label: 'active', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' }
  if (s === 'ERROR') return { label: 'error', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-200' }
  return { label: s ? s.toLowerCase() : 'unknown', cls: 'border-slate-600 bg-slate-800 text-slate-400' }
}

function iotBadge(iot: string | null | undefined) {
  if (!iot) return null
  const v = iot.toLowerCase()
  if (v.includes('cloud')) return { label: 'cloud_polling', cls: 'border-sky-500/35 bg-sky-500/10 text-sky-200' }
  if (v.includes('local') && v.includes('poll')) return { label: 'local_polling', cls: 'border-amber-500/35 bg-amber-500/10 text-amber-200' }
  if (v.includes('push')) return { label: 'local_push', cls: 'border-teal-500/35 bg-teal-500/10 text-teal-200' }
  return { label: iot, cls: 'border-slate-600 bg-slate-800 text-slate-400' }
}

function formatCount(v: number | null | undefined) {
  return v == null ? '—' : String(v)
}

function tierClass(t: string | null | undefined) {
  if (t === 'CORE') return 'border-sky-500/40 bg-sky-500/10 text-sky-200'
  if (t === 'VERIFIED') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (t === 'COMMUNITY') return 'border-violet-500/40 bg-violet-500/10 text-violet-200'
  return 'border-slate-600 bg-slate-800 text-slate-300'
}

function onInstalled() {
  void load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Devices &amp; Services</h1>
        <p class="mt-1 text-sm text-slate-400">Manage integrations and installed adapter packages.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="Search…"
          class="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 sm:max-w-xs"
        />
        <RouterLink
          to="/settings/adapter-pipeline-log"
          class="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Adapter operations center
        </RouterLink>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-500"
          @click="addOpen = true"
        >
          + Integration
        </button>
      </div>
    </div>

    <div v-if="loading" class="rounded-xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-500">
      Loading…
    </div>
    <div v-else-if="!filtered.length" class="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
      No integrations yet. Use <strong class="text-slate-300">+ Integration</strong> to add a local adapter package.
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="pkg in filtered"
          :key="pkg.adapterKey"
          type="button"
          class="group flex w-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 text-left shadow-panel transition hover:border-slate-600 hover:bg-slate-900/90"
          @click="openCard(pkg)"
        >
          <AdapterUiBanner :src="pkg.bannerAssetUrl" :title="pkg.name" size="md" rounded="rounded-none" />
          <div class="flex gap-3 p-4">
            <div
              class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
            >
              <img
                v-if="pkg.logoAssetUrl && !logoFailedByKey[pkg.adapterKey]"
                :src="pkg.logoAssetUrl"
                alt=""
                class="h-full w-full object-contain p-1.5"
                @error="markLogoFailed(pkg.adapterKey)"
              />
              <span v-else class="text-xl text-slate-500">{{ pkg.name.slice(0, 1) }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h2 class="truncate font-medium text-white">{{ pkg.name }}</h2>
                <span class="shrink-0 text-slate-500 transition group-hover:text-brand-400">›</span>
              </div>
              <p class="mt-0.5 line-clamp-2 text-xs text-slate-400">{{ pkg.description || pkg.ui?.description || '—' }}</p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-1 px-4">
            <span
              v-if="pkg.ui?.qualityTier"
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
              :class="tierClass(pkg.ui.qualityTier)"
            >
              {{ pkg.ui.qualityTier }}
            </span>
            <span
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
              :class="statusBadge(pkg).cls"
            >
              {{ statusBadge(pkg).label }}
            </span>
            <span
              v-if="iotBadge(pkg.iotClass)"
              class="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
              :class="iotBadge(pkg.iotClass)!.cls"
            >
              {{ iotBadge(pkg.iotClass)!.label }}
            </span>
          </div>
          <div class="mt-3 flex gap-4 border-t border-slate-800/80 px-4 pb-4 pt-2 text-[11px] text-slate-500">
            <span>{{ formatCount(pkg.deviceCount) }} devices</span>
            <span>{{ formatCount(pkg.entityCount) }} entities</span>
            <span>{{ formatCount(pkg.serviceCount) }} services</span>
          </div>
        </button>
    </div>

    <p class="text-center text-xs text-slate-600">
      <RouterLink to="/integrations/adapters" class="text-brand-500 hover:underline">Legacy adapter packages URL</RouterLink>
      redirects here.
    </p>

    <ProviderSelectDialog v-model:open="addOpen" @installed="onInstalled" />
  </div>
</template>
