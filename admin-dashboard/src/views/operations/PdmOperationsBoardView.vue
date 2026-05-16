<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getParkPdmOperationsOverview, type PdmOperationsOverviewPayload } from '@/api/client'
import { useParkContextStore } from '@/stores/parkContext'
import { useToast } from '@/composables/useToast'
import { pdmIndustrialPlatformEnabled } from '@/config/featureFlags'

const { t } = useI18n()
const parkCtx = useParkContextStore()
const { push } = useToast()

const data = ref<PdmOperationsOverviewPayload | null>(null)
const loading = ref(false)

const parkId = computed(() => parkCtx.activeParkId)

async function load() {
  if (!parkId.value || !pdmIndustrialPlatformEnabled) {
    data.value = null
    return
  }
  loading.value = true
  try {
    data.value = await getParkPdmOperationsOverview(parkId.value, { limit: 48 })
  } catch {
    data.value = null
    push(t('pdmOperationsBoardPage.loadFailed'), 'error')
  } finally {
    loading.value = false
  }
}

watch(parkId, () => {
  void load()
})

onMounted(() => {
  void load()
})

const rows = computed(() => (data.value?.assets?.length ? data.value.assets : []))
const enabled = computed(() => Boolean(data.value?.industrialPlatformEnabled))
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 text-slate-100 sm:px-6">
    <h1 class="font-display text-2xl font-semibold tracking-tight text-white">{{ t('pdmOperationsBoardPage.title') }}</h1>
    <p class="mt-1 max-w-3xl text-sm text-slate-400">{{ t('pdmOperationsBoardPage.subtitle') }}</p>
    <p class="mt-3 text-xs text-slate-500">
      <RouterLink class="text-brand-400 hover:underline" to="/operations/predictive-maintenance">{{ t('pdmPage.title') }}</RouterLink>
    </p>

    <div v-if="!pdmIndustrialPlatformEnabled" class="mt-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-200">
      Set <code class="rounded bg-slate-900 px-1">VITE_PDM_INDUSTRIAL_PLATFORM=true</code> for this view and
      <code class="rounded bg-slate-900 px-1">PDM_INDUSTRIAL_PLATFORM_ENABLED=true</code> on the API.
    </div>

    <div v-else-if="!parkId" class="mt-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-200">
      {{ t('pdmPage.noPark') }}
    </div>

    <template v-else>
      <p v-if="loading" class="mt-6 text-sm text-slate-500">…</p>
      <p v-else-if="!enabled || !rows.length" class="mt-6 text-sm text-slate-500">{{ t('pdmOperationsBoardPage.disabled') }}</p>
      <div v-else class="mt-6 overflow-x-auto rounded-lg border border-slate-800">
        <table class="min-w-full text-left text-sm">
          <thead class="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th class="px-3 py-2">{{ t('pdmOperationsBoardPage.colAsset') }}</th>
              <th class="px-3 py-2">{{ t('pdmOperationsBoardPage.colRisk') }}</th>
              <th class="px-3 py-2">{{ t('pdmOperationsBoardPage.colHealth') }}</th>
              <th class="px-3 py-2">{{ t('pdmOperationsBoardPage.colTelemetry') }}</th>
              <th class="px-3 py-2">{{ t('pdmOperationsBoardPage.colFailure') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/80 text-slate-300">
            <tr v-for="r in rows" :key="r.assetId">
              <td class="px-3 py-2">
                <RouterLink
                  class="text-brand-400 hover:underline"
                  :to="{ path: '/operations/predictive-maintenance', query: { assetId: r.assetId } }"
                >
                  {{ r.name || r.slug || r.assetId }}
                </RouterLink>
              </td>
              <td class="px-3 py-2 font-mono text-xs">{{ r.riskLevel }}</td>
              <td class="px-3 py-2">
                <span v-if="r.healthScore != null" class="font-semibold text-white">{{ r.healthScore }}</span>
                <span v-else class="text-slate-500">—</span>
                <span v-if="r.healthState" class="ml-2 text-xs text-slate-500">{{ r.healthState }} / {{ r.healthTrend }}</span>
              </td>
              <td class="px-3 py-2 text-xs">{{ r.telemetryOverall || '—' }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ r.topFailureMode || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
