<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError, getMdmRideExtensions, getPlatformAssetExtensions } from '@/api/client'
import type { RideMasterExtensionsRead } from '@/types/api'
import { useToast } from '@/composables/useToast'

type MlSignalRow = {
  signalKey: string
  domain: string
  metric: string
}

const props = withDefaults(
  defineProps<{
    entityType: 'ride' | 'park_asset'
    entityId: string | number
    /** Selected ML-eligible signal keys (multi-select). */
    modelValue?: string[]
    /** When set, replaces the default empty-state copy (e.g. parent-specific wording). */
    emptyHint?: string
  }>(),
  { modelValue: () => [], emptyHint: undefined }
)

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  select: [value: string[]]
}>()

const { t } = useI18n()
const { push } = useToast()

const loading = ref(false)
const loadError = ref(false)
const data = ref<RideMasterExtensionsRead | null>(null)
const localKeys = ref<string[]>([...(props.modelValue ?? [])])

const idStr = computed(() => String(props.entityId ?? '').trim())

function parseSignalKey(key: string): { domain: string; metric: string } {
  const i = key.indexOf('.')
  if (i <= 0) return { domain: '—', metric: key }
  return { domain: key.slice(0, i), metric: key.slice(i + 1) }
}

const mlEligibleSources = computed((): MlSignalRow[] => {
  const sigs = data.value?.signals
  if (!sigs) return []
  const out: MlSignalRow[] = []
  for (const signalKey of Object.keys(sigs)) {
    const entry = sigs[signalKey]
    if (!entry?.enabled || !entry.mlEligible) continue
    const { domain, metric } = parseSignalKey(signalKey)
    out.push({ signalKey, domain, metric })
  }
  out.sort((a, b) => a.signalKey.localeCompare(b.signalKey))
  return out
})

const groupedByDomain = computed(() => {
  const map = new Map<string, MlSignalRow[]>()
  for (const row of mlEligibleSources.value) {
    const list = map.get(row.domain) ?? []
    list.push(row)
    map.set(row.domain, list)
  }
  const domains = [...map.keys()].sort((a, b) => a.localeCompare(b))
  return domains.map((domain) => ({ domain, rows: map.get(domain)! }))
})

function isChecked(signalKey: string): boolean {
  return localKeys.value.includes(signalKey)
}

watch(
  () => props.modelValue,
  (v) => {
    localKeys.value = [...(v ?? [])]
  },
  { deep: true }
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
      const msg = e instanceof Error ? e.message : t('mlSignalPicker.loadFailed')
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

function toggle(signalKey: string) {
  const set = new Set(localKeys.value)
  if (set.has(signalKey)) set.delete(signalKey)
  else set.add(signalKey)
  const next = [...set].sort((a, b) => a.localeCompare(b))
  localKeys.value = next
  emit('update:modelValue', next)
  emit('select', next)
}
</script>

<template>
  <div class="space-y-3" data-testid="ml-signal-source-picker-root">
    <div>
      <h4 class="text-sm font-semibold text-white">{{ t('mlSignalPicker.title') }}</h4>
      <p class="mt-0.5 text-xs text-slate-500">{{ t('mlSignalPicker.hintMulti') }}</p>
    </div>

    <div v-if="loading" class="text-xs text-slate-500">{{ t('mlSignalPicker.loading') }}</div>
    <p v-else-if="loadError && !data" class="text-sm text-amber-200/90">{{ t('mlSignalPicker.loadFailed') }}</p>
    <p
      v-else-if="!mlEligibleSources.length"
      class="rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-400"
    >
      {{ props.emptyHint && props.emptyHint.trim() ? props.emptyHint : t('mlSignalPicker.empty') }}
    </p>

    <template v-else>
      <fieldset class="space-y-4">
        <legend class="sr-only">{{ t('mlSignalPicker.title') }}</legend>
        <div v-for="g in groupedByDomain" :key="g.domain" class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-wide text-slate-500">{{ g.domain }}</div>
          <ul class="space-y-1.5 pl-0.5">
            <li v-for="row in g.rows" :key="row.signalKey">
              <label
                class="flex cursor-pointer items-start gap-2 rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm hover:border-slate-600"
                :class="isChecked(row.signalKey) ? 'border-cyan-600/50 bg-cyan-950/20' : ''"
              >
                <input
                  class="mt-1 shrink-0 rounded border-slate-600"
                  type="checkbox"
                  :checked="isChecked(row.signalKey)"
                  @change="toggle(row.signalKey)"
                />
                <span class="min-w-0 flex-1 font-mono text-xs text-cyan-100/90">{{ row.signalKey }}</span>
              </label>
            </li>
          </ul>
        </div>
      </fieldset>
      <p v-if="localKeys.length" class="text-xs text-slate-500" data-testid="ml-signal-source-selected">
        {{ t('mlSignalPicker.selectedCount', { n: localKeys.length }) }}:
        <span class="font-mono text-slate-300">{{ localKeys.join(', ') }}</span>
      </p>
    </template>
  </div>
</template>
