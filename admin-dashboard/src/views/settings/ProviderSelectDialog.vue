<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getAdapterPackages, postInstallLocalAdapter } from '@/api/client'
import AdapterUiBanner from '@/components/adapter/AdapterUiBanner.vue'
import type { AdapterPackageDto, AdapterPackagesResponse } from '@/types/api'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'installed', pkg: AdapterPackageDto): void
}>()

const { push } = useToast()
const loading = ref(false)
const installing = ref<string | null>(null)
const search = ref('')
const catalog = ref<AdapterPackagesResponse | null>(null)
const logoFailedByKey = ref<Record<string, boolean>>({})

const packages = computed(() => catalog.value?.packages ?? [])

function markLogoFailed(adapterKey: string) {
  if (logoFailedByKey.value[adapterKey]) return
  logoFailedByKey.value = { ...logoFailedByKey.value, [adapterKey]: true }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return packages.value
  return packages.value.filter((p) => {
    const tags = (p.ui?.tags || []).join(' ')
    return [p.name, p.adapterKey, p.description, p.ui?.category, tags].join(' ').toLowerCase().includes(q)
  })
})

async function loadCatalog() {
  loading.value = true
  try {
    catalog.value = await getAdapterPackages()
    logoFailedByKey.value = {}
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load adapters', 'error')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) void loadCatalog()
  }
)

function close() {
  emit('update:open', false)
}

async function install(pkg: AdapterPackageDto) {
  installing.value = pkg.adapterKey
  try {
    const out = await postInstallLocalAdapter({
      adapterKey: pkg.adapterKey,
      name: pkg.name,
      configJson: {},
      contextJson: { parkSlug: 'europapark' },
      outputProfiles: ['UNS_JSON', 'CANONICAL_HISTORIAN'],
      emitEnabled: false,
      scheduleCron: null,
    })
    push(`Installed ${pkg.name}`, 'success')
    emit('installed', out)
    close()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Install failed', 'error')
  } finally {
    installing.value = null
  }
}

function tierClass(t: string | null | undefined) {
  if (t === 'CORE') return 'border-sky-500/40 bg-sky-500/10 text-sky-200'
  if (t === 'VERIFIED') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  if (t === 'COMMUNITY') return 'border-violet-500/40 bg-violet-500/10 text-violet-200'
  return 'border-slate-600 bg-slate-800 text-slate-300'
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add integration"
      @click.self="close"
    >
      <div
        class="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
        @click.stop
      >
        <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 class="font-display text-lg font-semibold text-white">Add integration</h2>
          <button type="button" class="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white" @click="close">
            ✕
          </button>
        </div>
        <div class="border-b border-slate-800 px-4 py-2">
          <input
            v-model="search"
            type="search"
            placeholder="Search adapters…"
            class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-2">
          <p v-if="loading" class="p-4 text-center text-sm text-slate-500">Loading catalog…</p>
          <ul v-else class="space-y-1">
            <li v-for="pkg in filtered" :key="pkg.adapterKey">
              <button
                type="button"
                class="flex w-full flex-col overflow-hidden rounded-lg border border-transparent text-left hover:border-slate-700 hover:bg-slate-900/80 disabled:opacity-50"
                :disabled="installing !== null"
                @click="install(pkg)"
              >
                <AdapterUiBanner :src="pkg.bannerAssetUrl" :title="pkg.name" size="sm" rounded="rounded-none" />
                <div class="flex items-center gap-3 px-2 py-2">
                <div
                  class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900"
                >
                  <img
                    v-if="pkg.logoAssetUrl && !logoFailedByKey[pkg.adapterKey]"
                    :src="pkg.logoAssetUrl"
                    :alt="''"
                    class="h-full w-full object-contain p-1"
                    @error="markLogoFailed(pkg.adapterKey)"
                  />
                  <span v-else class="text-lg text-slate-500">{{ (pkg.ui?.icon || pkg.name).slice(0, 2) }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-white">{{ pkg.name }}</p>
                  <p class="truncate font-mono text-[11px] text-brand-300">{{ pkg.adapterKey }}</p>
                  <p v-if="pkg.ui?.category" class="truncate text-[11px] text-slate-500">{{ pkg.ui.category }}</p>
                </div>
                <span
                  v-if="pkg.ui?.qualityTier"
                  class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase"
                  :class="tierClass(pkg.ui.qualityTier)"
                >
                  {{ pkg.ui.qualityTier }}
                </span>
                <span v-if="installing === pkg.adapterKey" class="shrink-0 text-xs text-brand-300">…</span>
                </div>
              </button>
            </li>
            <li v-if="!loading && !filtered.length" class="p-6 text-center text-sm text-slate-500">No adapters match.</li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
