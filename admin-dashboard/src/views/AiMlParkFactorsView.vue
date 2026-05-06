<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getMlParkFactors, type MlParkFactorRow } from '@/api/client'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'
import { useParkContextStore } from '@/stores/parkContext'

const { t } = useI18n()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const parkCtx = useParkContextStore()
const rows = ref<MlParkFactorRow[]>([])
const loading = ref(false)

const parkId = computed(() => parkCtx.activeParkId || '')

async function load() {
  if (!parkId.value) {
    rows.value = []
    return
  }
  loading.value = true
  try {
    rows.value = await getMlParkFactors(parkId.value)
  } catch (e) {
    rows.value = []
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(parkId, () => void load())
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiMl.back') }}</RouterLink>
    <h1 :class="ui.title">{{ t('aiMl.parkTitle') }}</h1>
    <p :class="ui.subtitle">{{ t('aiMl.parkSubtitle') }}</p>
    <div v-if="!parkId" :class="ui.card" class="text-amber-600">{{ t('aiMl.needPark') }}</div>
    <template v-else>
      <div :class="ui.card" class="flex gap-2">
        <button
          type="button"
          class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="loading"
          @click="load()"
        >
          {{ t('btn.refresh') }}
        </button>
      </div>
      <div :class="ui.card" class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr :class="ui.muted">
              <th class="py-2 pr-2">{{ t('aiMl.colActive') }}</th>
              <th class="py-2 pr-2">{{ t('aiMl.colCode') }}</th>
              <th class="py-2 pr-2">{{ t('aiMl.colParkWeight') }}</th>
              <th class="py-2 pr-2">{{ t('aiMl.colCurrent') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="String(r.id)" class="border-t border-slate-700/50">
              <td class="py-2 pr-2">{{ r.activeFlag ? '✓' : '—' }}</td>
              <td class="py-2 pr-2 font-mono text-xs">{{ r.factorCode }}</td>
              <td class="py-2 pr-2 font-mono">{{ r.weightOverride ?? '—' }}</td>
              <td class="py-2 pr-2 font-mono">{{ r.currentValue ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!loading && !rows.length" :class="ui.muted" class="mt-2">{{ t('aiMl.empty') }}</p>
      </div>
    </template>
  </div>
</template>
