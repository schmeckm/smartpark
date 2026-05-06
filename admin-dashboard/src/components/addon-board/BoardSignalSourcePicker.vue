<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError, getMdmRideExtensions, getPlatformAssetExtensions } from '@/api/client'
import type { AddonBoardSignalSourceCandidate, RideMasterExtensionsRead } from '@/types/api'
import { useToast } from '@/composables/useToast'

const props = withDefaults(
  defineProps<{
    entityType: 'ride' | 'park_asset'
    entityId: string | number
    /** Optional controlled selection (signal key). */
    modelValue?: string | null
  }>(),
  { modelValue: null }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [value: string]
}>()

const { t } = useI18n()
const { push } = useToast()

const loading = ref(false)
const loadError = ref(false)
const data = ref<RideMasterExtensionsRead | null>(null)
const localSelected = ref<string | null>(props.modelValue ?? null)

const idStr = computed(() => String(props.entityId ?? '').trim())

function parseSignalKey(key: string): { domain: string; metric: string } {
  const i = key.indexOf('.')
  if (i <= 0) return { domain: '—', metric: key }
  return { domain: key.slice(0, i), metric: key.slice(i + 1) }
}

const boardEligibleSources = computed((): AddonBoardSignalSourceCandidate[] => {
  const sigs = data.value?.signals
  if (!sigs) return []
  const out: AddonBoardSignalSourceCandidate[] = []
  for (const signalKey of Object.keys(sigs)) {
    const entry = sigs[signalKey]
    if (!entry?.enabled || !entry.boardEligible) continue
    const { domain, metric } = parseSignalKey(signalKey)
    out.push({
      signalKey,
      domain,
      metric,
      sourceType: 'SIGNAL_METADATA',
      boardEligible: true,
      enabled: true,
      mlEligible: Boolean(entry.mlEligible),
    })
  }
  out.sort((a, b) => a.signalKey.localeCompare(b.signalKey))
  return out
})

const groupedByDomain = computed(() => {
  const map = new Map<string, AddonBoardSignalSourceCandidate[]>()
  for (const row of boardEligibleSources.value) {
    const list = map.get(row.domain) ?? []
    list.push(row)
    map.set(row.domain, list)
  }
  const domains = [...map.keys()].sort((a, b) => a.localeCompare(b))
  return domains.map((domain) => ({ domain, rows: map.get(domain)! }))
})

const radioName = computed(() => `board-signal-source-${props.entityType}-${idStr.value}`)

watch(
  () => props.modelValue,
  (v) => {
    localSelected.value = v ?? null
  }
)

async function load() {
  const id = idStr.value
  if (!id) {
    data.value = null
    return
  }
  loading.value = true
  loadError.value = false
  data.value = null
  try {
    const payload =
      props.entityType === 'ride' ? await getMdmRideExtensions(id) : await getPlatformAssetExtensions(id)
    data.value = payload
  } catch (e) {
    loadError.value = true
    if (!(e instanceof ApiRequestError && e.status === 404)) {
      const msg = e instanceof Error ? e.message : t('addonBoard.signalSourceLoadFailed')
      push(msg, 'warning')
    }
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.entityType, idStr.value] as const,
  () => void load(),
  { immediate: true }
)

function onPick(signalKey: string) {
  localSelected.value = signalKey
  emit('update:modelValue', signalKey)
  emit('select', signalKey)
}
</script>

<template>
  <div class="space-y-3" data-testid="board-signal-source-picker-root">
    <div>
      <h4 class="text-sm font-semibold text-white">{{ t('addonBoard.signalSourcePickerTitle') }}</h4>
      <p class="mt-0.5 text-xs text-slate-500">{{ t('addonBoard.signalSourcePickerHint') }}</p>
    </div>

    <div v-if="loading" class="text-xs text-slate-500">{{ t('addonBoard.signalSourceLoading') }}</div>
    <p v-else-if="loadError && !data" class="text-sm text-amber-200/90">{{ t('addonBoard.signalSourceLoadFailed') }}</p>
    <p v-else-if="!boardEligibleSources.length" class="rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-400">
      {{ t('addonBoard.signalSourceEmpty') }}
    </p>

    <template v-else>
      <fieldset class="space-y-4">
        <legend class="sr-only">{{ t('addonBoard.signalSourcePickerTitle') }}</legend>
        <div v-for="g in groupedByDomain" :key="g.domain" class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ g.domain }}</div>
          <ul class="space-y-1.5 pl-0.5">
            <li v-for="row in g.rows" :key="row.signalKey">
              <label
                class="flex cursor-pointer items-start gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm hover:border-slate-600"
                :class="localSelected === row.signalKey ? 'border-brand-500/60 bg-brand-950/20' : ''"
              >
                <input
                  class="mt-1 shrink-0 rounded border-slate-600"
                  type="radio"
                  :name="radioName"
                  :value="row.signalKey"
                  :checked="localSelected === row.signalKey"
                  @change="onPick(row.signalKey)"
                />
                <span class="min-w-0 flex-1">
                  <span class="font-mono text-xs text-brand-100/90">{{ row.signalKey }}</span>
                  <span class="mt-0.5 block text-[11px] text-slate-500">
                    {{ t('addonBoard.signalSourceMlEligible') }}: {{ row.mlEligible ? t('addonBoard.signalSourceYes') : t('addonBoard.signalSourceNo') }}
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </div>
      </fieldset>
      <p v-if="localSelected" class="text-xs text-slate-500" data-testid="board-signal-source-selected">
        {{ t('addonBoard.signalSourceSelected') }}:
        <span class="font-mono text-slate-300">{{ localSelected }}</span>
      </p>
    </template>
  </div>
</template>
