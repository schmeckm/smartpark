<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getPlatformAssets } from '@/api/client'
import type { PlatformAsset } from '@/types/api'
import { useParkContextStore } from '@/stores/parkContext'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import PredictiveMaintenanceAssetPanel from '@/components/operations/PredictiveMaintenanceAssetPanel.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const parkCtx = useParkContextStore()
const auth = useAuthStore()
const { push } = useToast()

const assets = ref<PlatformAsset[]>([])
const assetsLoading = ref(false)
const selectedAssetId = ref('')

const parkId = computed(() => parkCtx.activeParkId)
const canUpdate = computed(() => auth.hasPermission('rides', 'update'))

function assetLabel(a: PlatformAsset): string {
  const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : ''
  const id = typeof a.assetId === 'string' ? a.assetId : ''
  return name || id || '—'
}

function assetId(a: PlatformAsset): string {
  return typeof a.assetId === 'string' ? a.assetId : ''
}

async function loadAssets() {
  if (!parkId.value) {
    assets.value = []
    selectedAssetId.value = ''
    return
  }
  assetsLoading.value = true
  try {
    const list = await getPlatformAssets({
      parkId: parkId.value,
      assetTypeCode: 'RIDE',
      limit: 500,
    })
    assets.value = Array.isArray(list) ? list : []
    const qId = typeof route.query.assetId === 'string' ? route.query.assetId : ''
    const valid = qId && assets.value.some((x) => assetId(x) === qId)
    if (valid) {
      selectedAssetId.value = qId
    } else if (assets.value.length) {
      const first = assetId(assets.value[0]!)
      selectedAssetId.value = first
      const nextQ = { ...route.query } as Record<string, string | string[] | undefined>
      nextQ.assetId = first
      router.replace({ query: nextQ }).catch(() => {})
    } else {
      selectedAssetId.value = ''
    }
  } catch {
    assets.value = []
    selectedAssetId.value = ''
    push(t('pdmPage.assetsLoadFailed'), 'error')
  } finally {
    assetsLoading.value = false
  }
}

function onSelectAsset(ev: Event) {
  const el = ev.target as HTMLSelectElement
  const id = el.value
  selectedAssetId.value = id
  const nextQ = { ...route.query } as Record<string, string | string[] | undefined>
  if (id) nextQ.assetId = id
  else delete nextQ.assetId
  router.replace({ query: nextQ }).catch(() => {})
}

watch(parkId, () => {
  void loadAssets()
})

watch(
  () => route.query.assetId,
  (q) => {
    const id = typeof q === 'string' ? q : ''
    if (id && id !== selectedAssetId.value && assets.value.some((a) => assetId(a) === id)) {
      selectedAssetId.value = id
    }
  }
)

onMounted(() => {
  void loadAssets()
})
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 text-slate-100 sm:px-6">
    <div class="mb-6">
      <h1 class="font-display text-2xl font-semibold tracking-tight text-white">{{ t('pdmPage.title') }}</h1>
      <p class="mt-1 max-w-2xl text-sm text-slate-400">{{ t('pdmPage.subtitle') }}</p>
      <p class="mt-3 text-xs text-slate-500">
        <RouterLink class="text-brand-400 hover:underline" to="/operations/addon-board">{{ t('pdmPage.linkAddonBoard') }}</RouterLink>
      </p>
    </div>

    <div v-if="!parkId" class="rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-200">
      {{ t('pdmPage.noPark') }}
    </div>

    <template v-else>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <label for="pdm-asset-select" class="text-sm font-medium text-white">{{ t('pdmPage.selectAsset') }}</label>
        <select
          id="pdm-asset-select"
          :value="selectedAssetId"
          class="min-w-[14rem] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          :disabled="assetsLoading || !assets.length"
          @change="onSelectAsset"
        >
          <option value="">{{ assetsLoading ? '…' : t('pdmPage.selectPlaceholder') }}</option>
          <option v-for="a in assets" :key="assetId(a)" :value="assetId(a)">{{ assetLabel(a) }}</option>
        </select>
      </div>

      <p v-if="!assetsLoading && !assets.length" class="text-sm text-slate-500">{{ t('pdmPage.assetsEmpty') }}</p>

      <template v-else-if="selectedAssetId">
        <PredictiveMaintenanceAssetPanel :asset-id="selectedAssetId" :can-update="canUpdate" />
        <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4">
          <RouterLink
            to="/"
            class="rounded-lg border border-brand-600/50 bg-brand-600/10 px-4 py-2 text-sm font-medium text-brand-100 hover:border-brand-500 hover:bg-brand-600/20"
          >
            {{ t('pdmPage.footerClose') }}
          </RouterLink>
        </div>
      </template>
    </template>
  </div>
</template>
