<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ApiRequestError,
  getMdmRideExtensions,
  getPlatformAssetExtensions,
  patchMdmRideExtensions,
  patchPlatformAssetExtensions,
} from '@/api/client'
import type {
  RideMasterExtensionsRead,
  RideMasterExtensionsCapabilities,
  RideMasterExtensionsSignalEntry,
} from '@/types/api'
import { UNS_EXTENSION_DOMAINS } from '@/lib/unsExtensionDomains'
import { useToast } from '@/composables/useToast'

const props = withDefaults(
  defineProps<{
    entityType: 'ride' | 'park_asset'
    entityId: string | number
    /** When true, show editors and Save / Discard (requires API `rides.update`). */
    editable?: boolean
  }>(),
  { editable: false }
)

const { t } = useI18n()
const { push } = useToast()

const loading = ref(true)
const notFound = ref(false)
const data = ref<RideMasterExtensionsRead | null>(null)

/** Working copy for editable mode (full replace on save via `replaceSignals`). */
const draft = ref<{
  domains: string[]
  capabilities: RideMasterExtensionsCapabilities
  signals: Record<string, RideMasterExtensionsSignalEntry>
} | null>(null)

const newSignalKey = ref('')
const saveBusy = ref(false)

const idStr = computed(() => String(props.entityId ?? '').trim())
const isEdit = computed(() => Boolean(props.editable))

const CAP_ORDER: (keyof RideMasterExtensionsCapabilities)[] = [
  'hasQueueSignal',
  'hasCycleSignal',
  'hasEnergyMetering',
  'supportsGreenOptimization',
]

const capabilityKeys = computed(() => {
  const c = data.value?.capabilities
  if (!c) return [] as (keyof RideMasterExtensionsCapabilities)[]
  return CAP_ORDER.filter((k) => k in c)
})

const signalRows = computed(() => {
  const sigs = isEdit.value && draft.value ? draft.value.signals : data.value?.signals
  if (!sigs) return [] as Array<{ key: string; domain: string; metric: string; greenRelevant: boolean; entry: RideMasterExtensionsSignalEntry }>
  const rows: Array<{
    key: string
    domain: string
    metric: string
    greenRelevant: boolean
    entry: RideMasterExtensionsSignalEntry
  }> = []
  for (const key of Object.keys(sigs).sort((a, b) => a.localeCompare(b))) {
    const { domain, metric } = parseSignalKey(key)
    rows.push({
      key,
      domain,
      metric,
      greenRelevant: domain === 'green',
      entry: sigs[key],
    })
  }
  return rows
})

function allCapabilitiesFalse(c: RideMasterExtensionsCapabilities | undefined) {
  if (!c) return true
  return !c.hasQueueSignal && !c.hasCycleSignal && !c.hasEnergyMetering && !c.supportsGreenOptimization
}

const isEmptyConfigured = computed(() => {
  const src = data.value
  if (!src) return false
  const dom = src.domains?.length ?? 0
  const sigCount = Object.keys(src.signals ?? {}).length
  return dom === 0 && sigCount === 0 && allCapabilitiesFalse(src.capabilities)
})

function parseSignalKey(key: string): { domain: string; metric: string } {
  const i = key.indexOf('.')
  if (i <= 0) return { domain: '—', metric: key }
  return { domain: key.slice(0, i), metric: key.slice(i + 1) }
}

function boolLabel(v: boolean) {
  return v ? t('signalsCapabilities.yes') : t('signalsCapabilities.no')
}

function cloneForDraft(d: RideMasterExtensionsRead) {
  return {
    domains: [...d.domains],
    capabilities: { ...d.capabilities },
    signals: JSON.parse(JSON.stringify(d.signals)) as Record<string, RideMasterExtensionsSignalEntry>,
  }
}

function domainSelected(domain: string) {
  return draft.value ? draft.value.domains.includes(domain) : false
}

function toggleDomain(domain: string) {
  if (!draft.value) return
  const i = draft.value.domains.indexOf(domain)
  if (i >= 0) draft.value.domains.splice(i, 1)
  else draft.value.domains.push(domain)
}

function removeSignal(key: string) {
  if (!draft.value) return
  delete draft.value.signals[key]
}

const SIGNAL_KEY_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/

function addSignalRow() {
  const key = newSignalKey.value.trim().toLowerCase()
  if (!draft.value) return
  const m = key.match(SIGNAL_KEY_RE)
  if (!m) {
    push(t('signalsCapabilities.invalidSignalKey'), 'warning')
    return
  }
  const dom = m[1]
  if (!UNS_EXTENSION_DOMAINS.includes(dom as (typeof UNS_EXTENSION_DOMAINS)[number])) {
    push(t('signalsCapabilities.invalidSignalKey'), 'warning')
    return
  }
  if (draft.value.signals[key]) {
    push(t('signalsCapabilities.duplicateSignalKey'), 'warning')
    return
  }
  draft.value.signals[key] = { enabled: false, mlEligible: false, boardEligible: false }
  newSignalKey.value = ''
}

async function load() {
  const id = idStr.value
  if (!id) {
    loading.value = false
    notFound.value = true
    data.value = null
    draft.value = null
    return
  }
  loading.value = true
  notFound.value = false
  data.value = null
  draft.value = null
  try {
    const payload =
      props.entityType === 'ride' ? await getMdmRideExtensions(id) : await getPlatformAssetExtensions(id)
    data.value = payload
    if (props.editable) {
      draft.value = cloneForDraft(payload)
    }
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      notFound.value = true
    } else {
      const msg = e instanceof Error ? e.message : t('signalsCapabilities.loadFailed')
      push(msg, 'warning')
    }
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!draft.value || !idStr.value) return
  saveBusy.value = true
  try {
    const body = {
      domains: [...draft.value.domains],
      capabilities: { ...draft.value.capabilities },
      replaceSignals: true as const,
      signals: { ...draft.value.signals },
    }
    if (props.entityType === 'ride') {
      await patchMdmRideExtensions(idStr.value, body)
    } else {
      await patchPlatformAssetExtensions(idStr.value, body)
    }
    push(t('signalsCapabilities.saved'), 'success')
    await load()
  } catch (e) {
    const msg = e instanceof Error ? e.message : t('signalsCapabilities.saveFailed')
    push(msg, 'warning')
  } finally {
    saveBusy.value = false
  }
}

async function discard() {
  newSignalKey.value = ''
  await load()
}

watch(
  () => [props.entityType, idStr.value] as const,
  () => void load(),
  { immediate: true }
)

watch(
  () => props.editable,
  (ed) => {
    if (ed && data.value) draft.value = cloneForDraft(data.value)
    else if (!ed) draft.value = null
  }
)

watch(
  () => data.value,
  (d) => {
    if (props.editable && d) draft.value = cloneForDraft(d)
  }
)
</script>

<template>
  <section class="space-y-4">
    <div>
      <h3 class="text-sm font-semibold text-white">{{ t('signalsCapabilities.sectionTitle') }}</h3>
      <p class="mt-0.5 text-xs text-slate-500">
        {{ isEdit ? t('signalsCapabilities.sectionHintEdit') : t('signalsCapabilities.sectionHint') }}
      </p>
    </div>

    <div v-if="loading" class="text-xs text-slate-500">{{ t('signalsCapabilities.loading') }}</div>
    <p v-else-if="notFound" class="text-sm text-amber-200/90">{{ t('signalsCapabilities.notFound') }}</p>

    <!-- Read-only (default) -->
    <template v-else-if="data && !isEdit">
      <div v-if="isEmptyConfigured" class="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-400">
        {{ t('signalsCapabilities.empty') }}
      </div>

      <template v-else>
        <div>
          <h4 class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('signalsCapabilities.domains') }}</h4>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="d in data.domains"
              :key="d"
              class="rounded-full border border-brand-500/40 bg-brand-600/20 px-2.5 py-0.5 text-xs font-medium text-brand-100"
            >
              {{ d }}
            </span>
            <span v-if="!data.domains.length" class="text-xs text-slate-500">—</span>
          </div>
        </div>

        <div>
          <h4 class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('signalsCapabilities.capabilities') }}</h4>
          <ul class="mt-2 grid gap-2 sm:grid-cols-2">
            <li
              v-for="k in capabilityKeys"
              :key="k"
              class="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs"
            >
              <span class="text-slate-300">{{ t(`signalsCapabilities.cap.${k}`) }}</span>
              <span
                class="shrink-0 rounded px-2 py-0.5 font-medium"
                :class="data.capabilities[k] ? 'bg-emerald-900/50 text-emerald-200' : 'bg-slate-800 text-slate-500'"
              >
                {{ boolLabel(!!data.capabilities[k]) }}
              </span>
            </li>
          </ul>
        </div>

        <div class="overflow-x-auto">
          <h4 class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('signalsCapabilities.signals') }}</h4>
          <table class="mt-2 w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-700 text-slate-500">
                <th class="py-2 pr-3 font-medium">{{ t('signalsCapabilities.colSignalKey') }}</th>
                <th class="py-2 pr-3 font-medium">{{ t('signalsCapabilities.colDomain') }}</th>
                <th class="py-2 pr-3 font-medium">{{ t('signalsCapabilities.colMetric') }}</th>
                <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colEnabled') }}</th>
                <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colBoard') }}</th>
                <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colMl') }}</th>
                <th class="py-2 font-medium">{{ t('signalsCapabilities.colGreen') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in signalRows" :key="row.key" class="border-b border-slate-800/80 text-slate-200">
                <td class="py-2 pr-3 font-mono text-[11px] text-brand-100/90">{{ row.key }}</td>
                <td class="py-2 pr-3">{{ row.domain }}</td>
                <td class="py-2 pr-3 font-mono text-[11px] text-slate-400">{{ row.metric }}</td>
                <td class="py-2 pr-2">{{ boolLabel(row.entry.enabled) }}</td>
                <td class="py-2 pr-2">{{ boolLabel(row.entry.boardEligible) }}</td>
                <td class="py-2 pr-2">{{ boolLabel(row.entry.mlEligible) }}</td>
                <td class="py-2">{{ boolLabel(row.greenRelevant) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!signalRows.length" class="mt-2 text-xs text-slate-500">{{ t('signalsCapabilities.noSignalsInTable') }}</p>
        </div>
      </template>
    </template>

    <!-- Editable -->
    <template v-else-if="data && isEdit && draft">
      <div v-if="isEmptyConfigured" class="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-100/90">
        {{ t('signalsCapabilities.emptyEdit') }}
      </div>

      <div>
        <h4 class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('signalsCapabilities.domains') }}</h4>
        <div class="mt-2 flex flex-wrap gap-3">
          <label v-for="d in UNS_EXTENSION_DOMAINS" :key="d" class="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
            <input type="checkbox" class="rounded border-slate-600" :checked="domainSelected(d)" @change="toggleDomain(d)" />
            {{ d }}
          </label>
        </div>
      </div>

      <div>
        <h4 class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('signalsCapabilities.capabilities') }}</h4>
        <ul class="mt-2 grid gap-2 sm:grid-cols-2">
          <li
            v-for="k in CAP_ORDER"
            :key="k"
            class="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs"
          >
            <span class="text-slate-300">{{ t(`signalsCapabilities.cap.${k}`) }}</span>
            <input v-model="draft.capabilities[k]" type="checkbox" class="rounded border-slate-600" />
          </li>
        </ul>
      </div>

      <div class="overflow-x-auto">
        <h4 class="text-xs font-medium uppercase tracking-wide text-slate-400">{{ t('signalsCapabilities.signals') }}</h4>
        <table class="mt-2 w-full min-w-[720px] border-collapse text-left text-xs">
          <thead>
            <tr class="border-b border-slate-700 text-slate-500">
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colSignalKey') }}</th>
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colDomain') }}</th>
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colMetric') }}</th>
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colEnabled') }}</th>
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colBoard') }}</th>
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colMl') }}</th>
              <th class="py-2 pr-2 font-medium">{{ t('signalsCapabilities.colGreen') }}</th>
              <th class="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in signalRows" :key="row.key" class="border-b border-slate-800/80 text-slate-200">
              <td class="py-2 pr-2 font-mono text-[11px] text-brand-100/90">{{ row.key }}</td>
              <td class="py-2 pr-2">{{ row.domain }}</td>
              <td class="py-2 pr-2 font-mono text-[11px] text-slate-400">{{ row.metric }}</td>
              <td class="py-2 pr-2">
                <input v-model="draft.signals[row.key].enabled" type="checkbox" class="rounded border-slate-600" />
              </td>
              <td class="py-2 pr-2">
                <input v-model="draft.signals[row.key].boardEligible" type="checkbox" class="rounded border-slate-600" />
              </td>
              <td class="py-2 pr-2">
                <input v-model="draft.signals[row.key].mlEligible" type="checkbox" class="rounded border-slate-600" />
              </td>
              <td class="py-2 pr-2 text-slate-500">{{ boolLabel(row.greenRelevant) }}</td>
              <td class="py-2">
                <button type="button" class="text-rose-400 hover:text-rose-300" @click="removeSignal(row.key)">×</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <label class="block min-w-[12rem] flex-1 text-xs text-slate-500">
            {{ t('signalsCapabilities.newSignalKey') }}
            <input
              v-model="newSignalKey"
              type="text"
              class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-white"
              :placeholder="t('signalsCapabilities.newSignalPlaceholder')"
            />
          </label>
          <button
            type="button"
            class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="addSignalRow"
          >
            {{ t('signalsCapabilities.addSignal') }}
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="saveBusy"
          @click="save"
        >
          {{ t('signalsCapabilities.save') }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          :disabled="saveBusy"
          @click="discard"
        >
          {{ t('signalsCapabilities.discard') }}
        </button>
      </div>
    </template>
  </section>
</template>
