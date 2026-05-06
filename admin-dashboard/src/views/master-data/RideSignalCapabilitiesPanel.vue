<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getRideSignalCapabilities,
  putRideSignalCapabilities,
  postPrepareRideUnsTopics,
  postPrepareRideSparkplugMetrics,
  getRideTopicActivationStatus,
  postActivatePreparedRideUnsTopics,
  postDeactivatePreparedRideUnsTopics,
  postActivatePreparedRideSparkplugMetrics,
  postDeactivatePreparedRideSparkplugMetrics,
  getRegistryPublisherStatus,
  getRegistryPublisherHealth,
  getRegistryPublisherEvents,
  postRegistryPublisherDryRun,
  postRegistryPublisherPublishOnce,
  postRegistryPublisherDisablePilot,
  getRegistrySignalDeprecations,
  postRegistrySignalDeprecate,
  postRegistrySignalReactivate,
  type RideSignalCapabilitiesPayload,
  type RideSignalCapabilitySignalRow,
  type RideSignalSource,
  type RideTopicActivationStatus,
  type RegistryPublisherStatus,
  type RegistryPublisherHealth,
  type RegistryPublishEventRow,
  type RegistrySignalDeprecationsPayload,
  type RegistrySignalDeprecationListRow,
} from '@/api/client'
import { useToast } from '@/composables/useToast'

const props = defineProps<{ rideAssetId: string }>()

const { t } = useI18n()
const { push } = useToast()

const busy = ref(false)
const payload = ref<RideSignalCapabilitiesPayload | null>(null)
const draft = ref<Record<string, RideSignalSource>>({})
const draftValueType = ref<Record<string, string>>({})
const activationStatus = ref<RideTopicActivationStatus | null>(null)

const regPubStatus = ref<RegistryPublisherStatus | null>(null)
const regPubHealth = ref<RegistryPublisherHealth | null>(null)
const regPubEvents = ref<RegistryPublishEventRow[]>([])
const regPubBusy = ref(false)

const deprecationBundle = ref<RegistrySignalDeprecationsPayload | null>(null)
const depBusy = ref(false)

const sources: RideSignalSource[] = [
  'NOT_AVAILABLE',
  'MASTER_DATA',
  'MANUAL',
  'ADAPTER',
  'MQTT_EDGE',
  'SIMULATION',
  'ML',
]

const dirty = computed(() => {
  if (!payload.value) return false
  for (const s of payload.value.signals) {
    const d = draft.value[s.signalCatalogId]
    if (d && d !== s.signalSource) return true
    const vt = String(draftValueType.value[s.signalCatalogId] ?? '').trim() || s.valueType || 'number'
    if (vt !== String(s.valueType || 'number')) return true
  }
  return false
})

function initDraftFromPayload(p: RideSignalCapabilitiesPayload) {
  const next: Record<string, RideSignalSource> = {}
  const vt: Record<string, string> = {}
  for (const s of p.signals) {
    next[s.signalCatalogId] = s.signalSource
    vt[s.signalCatalogId] = s.valueType || 'number'
  }
  draft.value = next
  draftValueType.value = vt
}

async function loadActivationStatus() {
  if (!props.rideAssetId) return
  try {
    activationStatus.value = await getRideTopicActivationStatus(props.rideAssetId)
  } catch {
    activationStatus.value = null
    push(t('rideSignalCaps.pilotStatusLoadFailed'), 'warning')
  }
}

function rideOnRegistryAllowList(status: RegistryPublisherStatus | null): boolean {
  if (!status?.allowedRideAssetIds?.length || !props.rideAssetId) return false
  const id = props.rideAssetId.trim().toLowerCase()
  return status.allowedRideAssetIds.some((x) => String(x).trim().toLowerCase() === id)
}

function formatIsoShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  return iso.length >= 19 ? iso.slice(0, 19).replace('T', ' ') : iso
}

async function loadRegistryPublisher() {
  if (!props.rideAssetId) return
  try {
    const [status, health, events] = await Promise.all([
      getRegistryPublisherStatus(),
      getRegistryPublisherHealth(),
      getRegistryPublisherEvents({ rideAssetId: props.rideAssetId, limit: 25 }),
    ])
    regPubStatus.value = status
    regPubHealth.value = health
    regPubEvents.value = events
  } catch {
    regPubStatus.value = null
    regPubHealth.value = null
    regPubEvents.value = []
    push(t('rideSignalCaps.regPubLoadFailed'), 'warning')
  }
}

async function registryDryRun() {
  if (!props.rideAssetId) return
  regPubBusy.value = true
  try {
    const r = await postRegistryPublisherDryRun(props.rideAssetId)
    push(
      t('rideSignalCaps.regPubDryRunDone', {
        skipped: r.skipped,
        warnings: r.warnings?.length ?? 0,
      }),
      'success'
    )
    await loadRegistryPublisher()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Dry run failed', 'error')
  } finally {
    regPubBusy.value = false
  }
}

async function registryPublishOnce() {
  if (!props.rideAssetId) return
  regPubBusy.value = true
  try {
    const r = await postRegistryPublisherPublishOnce(props.rideAssetId)
    push(
      t('rideSignalCaps.regPubPublishDone', {
        uns: r.unsPublished,
        spark: r.sparkPublished,
        failed: r.failed,
      }),
      'success'
    )
    await loadRegistryPublisher()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Publish once failed', 'error')
  } finally {
    regPubBusy.value = false
  }
}

async function registryDisablePilot() {
  if (!props.rideAssetId) return
  regPubBusy.value = true
  try {
    const r = await postRegistryPublisherDisablePilot(props.rideAssetId)
    push(
      t('rideSignalCaps.regPubDisablePilotDone', {
        uns: r.unsDeactivated,
        spark: r.sparkplugDeactivated,
      }),
      'success'
    )
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Disable pilot failed', 'error')
  } finally {
    regPubBusy.value = false
  }
}

async function loadSignalDeprecation() {
  if (!props.rideAssetId) return
  try {
    deprecationBundle.value = await getRegistrySignalDeprecations(props.rideAssetId)
  } catch {
    deprecationBundle.value = null
    push(t('rideSignalCaps.signalDeprecationLoadFailed'), 'warning')
  }
}

function healthTooltip(row: RegistrySignalDeprecationListRow): string {
  if (row.health.ok) return t('rideSignalCaps.signalDeprecationHealthOk')
  return row.health.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.id}: ${c.detail}`)
    .join('\n')
}

function registryPathActiveLabel(row: RegistrySignalDeprecationListRow): string {
  if (row.signalSource === 'MQTT_EDGE') {
    return row.isActiveSparkplug ? t('rideSignalCaps.signalDeprecationYes') : t('rideSignalCaps.signalDeprecationNo')
  }
  return row.isActiveTopic ? t('rideSignalCaps.signalDeprecationYes') : t('rideSignalCaps.signalDeprecationNo')
}

async function deprecateFromPanel(body: {
  signalKey: string
  registryAuthoritative?: boolean
  disableLegacyFallback?: boolean
  legacyPublishDisabled?: boolean
}) {
  if (!props.rideAssetId) return
  depBusy.value = true
  try {
    await postRegistrySignalDeprecate(props.rideAssetId, body)
    push(t('rideSignalCaps.signalDeprecationUpdated'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Deprecation update failed', 'error')
  } finally {
    depBusy.value = false
  }
}

async function markAuthoritative(signalKey: string) {
  await deprecateFromPanel({ signalKey, registryAuthoritative: true })
}

async function disableLegacyFallback(signalKey: string) {
  if (
    !confirm(
      t('rideSignalCaps.signalDeprecationConfirmFallback', {
        signal: signalKey,
      })
    )
  ) {
    return
  }
  await deprecateFromPanel({ signalKey, registryAuthoritative: true, disableLegacyFallback: true })
}

async function storeLegacyPublishDisabled(signalKey: string) {
  if (!confirm(t('rideSignalCaps.signalDeprecationConfirmPublish', { signal: signalKey }))) return
  await deprecateFromPanel({ signalKey, legacyPublishDisabled: true })
}

async function enableLegacyFallback(signalKey: string) {
  await deprecateFromPanel({ signalKey, disableLegacyFallback: false })
}

async function clearAuthoritative(signalKey: string) {
  await deprecateFromPanel({ signalKey, registryAuthoritative: false })
}

async function fullReactivateSignal(signalKey: string) {
  if (!confirm(t('rideSignalCaps.signalDeprecationConfirmFullReactivate', { signal: signalKey }))) return
  if (!props.rideAssetId) return
  depBusy.value = true
  try {
    await postRegistrySignalReactivate(props.rideAssetId, { signalKey })
    push(t('rideSignalCaps.signalDeprecationFullReactivated'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Reactivate failed', 'error')
  } finally {
    depBusy.value = false
  }
}

async function load() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const p = await getRideSignalCapabilities(props.rideAssetId)
    payload.value = p
    initDraftFromPayload(p)
    await Promise.all([loadActivationStatus(), loadRegistryPublisher(), loadSignalDeprecation()])
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load signal capabilities', 'error')
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!props.rideAssetId || !payload.value) return
  busy.value = true
  try {
    const capabilities = payload.value.signals.map((s) => ({
      signalCatalogId: s.signalCatalogId,
      signalSource: draft.value[s.signalCatalogId] ?? s.signalSource,
      valueType: draftValueType.value[s.signalCatalogId] || s.valueType,
    }))
    const p = await putRideSignalCapabilities(props.rideAssetId, { capabilities })
    payload.value = p
    initDraftFromPayload(p)
    push(t('rideSignalCaps.saved'), 'success')
    await loadActivationStatus()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    busy.value = false
  }
}

async function prepareTopics() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postPrepareRideUnsTopics(props.rideAssetId)
    push(t('rideSignalCaps.preparedTopics', { created: r.created, updated: r.updated }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Prepare failed', 'error')
  } finally {
    busy.value = false
  }
}

async function prepareSparkplug() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postPrepareRideSparkplugMetrics(props.rideAssetId)
    push(t('rideSignalCaps.preparedSparkplug', { created: r.created, updated: r.updated }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Prepare failed', 'error')
  } finally {
    busy.value = false
  }
}

async function pilotActivateUns() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postActivatePreparedRideUnsTopics(props.rideAssetId)
    push(t('rideSignalCaps.pilotActivatedUns', { activated: r.activated, skipped: r.skipped }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Activation failed', 'error')
  } finally {
    busy.value = false
  }
}

async function pilotDeactivateUns() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postDeactivatePreparedRideUnsTopics(props.rideAssetId)
    push(t('rideSignalCaps.pilotDeactivatedUns', { deactivated: r.deactivated }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Deactivation failed', 'error')
  } finally {
    busy.value = false
  }
}

async function pilotActivateSpark() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postActivatePreparedRideSparkplugMetrics(props.rideAssetId)
    push(t('rideSignalCaps.pilotActivatedSpark', { activated: r.activated, skipped: r.skipped }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Activation failed', 'error')
  } finally {
    busy.value = false
  }
}

async function pilotDeactivateSpark() {
  if (!props.rideAssetId) return
  busy.value = true
  try {
    const r = await postDeactivatePreparedRideSparkplugMetrics(props.rideAssetId)
    push(t('rideSignalCaps.pilotDeactivatedSpark', { deactivated: r.deactivated }), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Deactivation failed', 'error')
  } finally {
    busy.value = false
  }
}

const TOPIC_SOURCES = new Set(['MANUAL', 'ADAPTER', 'SIMULATION', 'ML', 'MQTT_EDGE'])

function statusLabel(row: RideSignalCapabilitySignalRow): string {
  const src = draft.value[row.signalCatalogId] ?? row.signalSource
  if (src !== row.signalSource) return t('rideSignalCaps.statusUnsaved')
  if (src === 'NOT_AVAILABLE') return t('rideSignalCaps.statusNotAvailable')
  if (src === 'MASTER_DATA') return t('rideSignalCaps.statusMasterData')
  if (TOPIC_SOURCES.has(src)) {
    if (row.isPreparedTopic && !row.isActiveTopic) {
      if (src === 'MQTT_EDGE' && !row.isPreparedSparkplug) {
        return t('rideSignalCaps.statusPreparedUnsNoSparkplug')
      }
      return t('rideSignalCaps.statusPreparedInactive')
    }
    if (row.isPreparedTopic && row.isActiveTopic) {
      if (src === 'MQTT_EDGE' && !row.isActiveSparkplug) {
        return t('rideSignalCaps.statusUnsActiveSparkplugInactive')
      }
      return t('rideSignalCaps.statusActive')
    }
    return t('rideSignalCaps.statusNotPrepared')
  }
  return t('rideSignalCaps.statusDraft')
}

onMounted(() => {
  void load()
})

watch(
  () => props.rideAssetId,
  () => {
    void load()
  }
)
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-3">
      <p class="text-xs text-slate-400">{{ t('rideSignalCaps.intro') }}</p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          :disabled="busy || !dirty"
          @click="save"
        >
          {{ t('rideSignalCaps.save') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-brand-700/60 bg-brand-950/40 px-2.5 py-1.5 text-[11px] text-brand-100 hover:bg-brand-900/50 disabled:opacity-50"
          :disabled="busy"
          @click="prepareTopics"
        >
          {{ t('rideSignalCaps.prepareTopics') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-amber-800/60 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
          :disabled="busy"
          @click="prepareSparkplug"
        >
          {{ t('rideSignalCaps.prepareSparkplug') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800"
          :disabled="busy"
          @click="load"
        >
          {{ t('rideSignalCaps.reload') }}
        </button>
      </div>
      <div v-if="busy && !payload" class="text-xs text-slate-500">{{ t('rideSignalCaps.loading') }}</div>
      <div v-else-if="!payload?.signals?.length" class="text-xs text-slate-500">{{ t('rideSignalCaps.empty') }}</div>
      <div v-else class="overflow-x-auto rounded-lg border border-slate-800">
        <table class="min-w-full text-left text-[11px] text-slate-200">
          <thead class="bg-slate-900/80 text-[10px] uppercase text-slate-500">
            <tr>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colSignal') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colDescription') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colUnit') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colValueType') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colSource') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colUnsPreview') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colSparkplugPreview') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.colStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in payload.signals" :key="row.signalCatalogId" class="border-t border-slate-800/80">
              <td class="px-2 py-1.5 font-mono text-brand-100/90">{{ row.signalCode }}</td>
              <td class="max-w-[10rem] truncate px-2 py-1.5 text-slate-400" :title="row.description || ''">
                {{ row.description || '—' }}
              </td>
              <td class="px-2 py-1.5 text-slate-400">{{ row.unit || '—' }}</td>
              <td class="px-2 py-1.5">
                <input
                  v-model="draftValueType[row.signalCatalogId]"
                  type="text"
                  class="w-16 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 font-mono text-[10px]"
                />
              </td>
              <td class="px-2 py-1.5">
                <div class="grid max-w-[16rem] grid-cols-2 gap-x-1 gap-y-0.5">
                  <label v-for="src in sources" :key="src" class="flex cursor-pointer items-center gap-0.5 text-[9px]">
                    <input
                      v-model="draft[row.signalCatalogId]"
                      type="radio"
                      class="border-slate-600"
                      :name="`sig-src-${row.signalCatalogId}`"
                      :value="src"
                    />
                    <span class="truncate" :title="src">{{ src }}</span>
                  </label>
                </div>
              </td>
              <td class="max-w-[12rem] truncate px-2 py-1.5 font-mono text-[10px] text-slate-400" :title="row.unsTopicPreview || ''">
                {{ row.unsTopicPreview || '—' }}
              </td>
              <td class="max-w-[10rem] truncate px-2 py-1.5 text-[10px] text-amber-200/80" :title="row.sparkplugMetricPreview || ''">
                {{ row.sparkplugMetricPreview || '—' }}
              </td>
              <td class="px-2 py-1.5 text-[10px] text-slate-300">{{ statusLabel(row) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="rounded-lg border border-sky-900/50 bg-sky-950/20 p-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-wide text-sky-200/90">
        {{ t('rideSignalCaps.signalDeprecationTitle') }}
      </h3>
      <p class="mt-1 text-[10px] leading-relaxed text-slate-400">{{ t('rideSignalCaps.signalDeprecationIntro') }}</p>
      <p class="mt-2 text-[10px] font-medium text-amber-200/90">{{ t('rideSignalCaps.signalDeprecationWarnStored') }}</p>
      <p class="mt-1 text-[10px] text-slate-500">{{ t('rideSignalCaps.signalDeprecationWarnData') }}</p>

      <div v-if="!deprecationBundle?.signals?.length" class="mt-2 text-[10px] text-slate-600">
        {{ t('rideSignalCaps.signalDeprecationEmpty') }}
      </div>
      <div v-else class="mt-3 overflow-x-auto rounded-lg border border-sky-900/40">
        <table class="min-w-full text-left text-[11px] text-slate-200">
          <thead class="bg-slate-900/80 text-[10px] uppercase text-slate-500">
            <tr>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColSignal') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColRegistry') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColAuth') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColFallback') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColPublish') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColHealth') }}</th>
              <th class="px-2 py-1.5">{{ t('rideSignalCaps.signalDeprecationColActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in deprecationBundle.signals"
              :key="row.signalCatalogId"
              class="border-t border-slate-800/80"
            >
              <td class="px-2 py-1.5 font-mono text-sky-100/90">{{ row.signalKey }}</td>
              <td class="px-2 py-1.5">{{ registryPathActiveLabel(row) }}</td>
              <td class="px-2 py-1.5">{{ row.deprecation.registryAuthoritative ? t('rideSignalCaps.signalDeprecationYes') : t('rideSignalCaps.signalDeprecationNo') }}</td>
              <td class="px-2 py-1.5">{{ row.deprecation.legacyFallbackDisabled ? t('rideSignalCaps.signalDeprecationOff') : t('rideSignalCaps.signalDeprecationOn') }}</td>
              <td class="px-2 py-1.5">{{ row.deprecation.legacyPublishDisabled ? t('rideSignalCaps.signalDeprecationOff') : t('rideSignalCaps.signalDeprecationOn') }}</td>
              <td class="px-2 py-1.5">
                <span
                  class="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium"
                  :class="row.health.ok ? 'bg-emerald-950/80 text-emerald-200' : 'bg-rose-950/80 text-rose-200'"
                  :title="healthTooltip(row)"
                >
                  {{ row.health.ok ? t('rideSignalCaps.signalDeprecationHealthPass') : t('rideSignalCaps.signalDeprecationHealthFail') }}
                </span>
              </td>
              <td class="px-2 py-1.5">
                <div class="flex flex-wrap gap-1">
                  <button
                    type="button"
                    class="rounded border border-sky-800/70 px-1.5 py-0.5 text-[9px] text-sky-100 hover:bg-sky-950/50 disabled:opacity-40"
                    :disabled="busy || depBusy"
                    @click="markAuthoritative(row.signalKey)"
                  >
                    {{ t('rideSignalCaps.signalDeprecationActAuth') }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-amber-900/60 px-1.5 py-0.5 text-[9px] text-amber-100 hover:bg-amber-950/40 disabled:opacity-40"
                    :disabled="busy || depBusy || !row.health.ok || row.deprecation.legacyFallbackDisabled"
                    @click="disableLegacyFallback(row.signalKey)"
                  >
                    {{ t('rideSignalCaps.signalDeprecationActNoFallback') }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-fuchsia-900/60 px-1.5 py-0.5 text-[9px] text-fuchsia-100 hover:bg-fuchsia-950/40 disabled:opacity-40"
                    :disabled="busy || depBusy || row.deprecation.legacyPublishDisabled"
                    @click="storeLegacyPublishDisabled(row.signalKey)"
                  >
                    {{ t('rideSignalCaps.signalDeprecationActNoPublish') }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[9px] text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                    :disabled="busy || depBusy || !row.deprecation.legacyFallbackDisabled"
                    @click="enableLegacyFallback(row.signalKey)"
                  >
                    {{ t('rideSignalCaps.signalDeprecationActFallbackOn') }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-slate-700 px-1.5 py-0.5 text-[9px] text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                    :disabled="busy || depBusy || !row.deprecation.registryAuthoritative"
                    @click="clearAuthoritative(row.signalKey)"
                  >
                    {{ t('rideSignalCaps.signalDeprecationActClearAuth') }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-rose-900/50 px-1.5 py-0.5 text-[9px] text-rose-100 hover:bg-rose-950/40 disabled:opacity-40"
                    :disabled="busy || depBusy"
                    @click="fullReactivateSignal(row.signalKey)"
                  >
                    {{ t('rideSignalCaps.signalDeprecationActFullReactivate') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-wide text-emerald-200/90">{{ t('rideSignalCaps.pilotTitle') }}</h3>
      <p class="mt-1 text-[10px] leading-relaxed text-slate-400">{{ t('rideSignalCaps.pilotIntro') }}</p>
      <p class="mt-2 text-[10px] font-medium text-amber-200/90">{{ t('rideSignalCaps.pilotWarning') }}</p>

      <dl v-if="activationStatus" class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-300">
        <dt class="text-slate-500">{{ t('rideSignalCaps.pilotUnsPrepared') }}</dt>
        <dd>{{ activationStatus.preparedUnsTopicCount }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.pilotUnsActive') }}</dt>
        <dd>{{ activationStatus.activeUnsTopicCount }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.pilotSparkPrepared') }}</dt>
        <dd>{{ activationStatus.preparedSparkplugMetricCount }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.pilotSparkActive') }}</dt>
        <dd>{{ activationStatus.activeSparkplugMetricCount }}</dd>
      </dl>
      <div v-if="activationStatus" class="mt-2">
        <p class="text-[10px] text-slate-500">{{ t('rideSignalCaps.pilotActiveKeys') }}</p>
        <p class="mt-0.5 font-mono text-[10px] text-emerald-100/80">
          {{ activationStatus.activeSignalKeys.length ? activationStatus.activeSignalKeys.join(', ') : '—' }}
        </p>
      </div>
      <div v-if="activationStatus?.warnings?.length" class="mt-2 rounded border border-amber-900/40 bg-amber-950/20 p-2">
        <p class="text-[10px] font-semibold text-amber-200/90">{{ t('rideSignalCaps.pilotWarnings') }}</p>
        <ul class="mt-1 list-inside list-disc text-[10px] text-amber-100/80">
          <li v-for="(w, i) in activationStatus.warnings" :key="i">{{ w.message }}</li>
        </ul>
      </div>
      <p v-else-if="activationStatus" class="mt-2 text-[10px] text-slate-600">{{ t('rideSignalCaps.pilotNoWarnings') }}</p>

      <div class="mt-3 flex flex-wrap gap-2 border-t border-emerald-900/30 pt-3">
        <button
          type="button"
          class="rounded-md border border-emerald-700/70 bg-emerald-950/50 px-2.5 py-1.5 text-[11px] text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-50"
          :disabled="busy"
          @click="pilotActivateUns"
        >
          {{ t('rideSignalCaps.pilotActivateUns') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          :disabled="busy"
          @click="pilotDeactivateUns"
        >
          {{ t('rideSignalCaps.pilotDeactivateUns') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-teal-700/70 bg-teal-950/40 px-2.5 py-1.5 text-[11px] text-teal-100 hover:bg-teal-900/35 disabled:opacity-50"
          :disabled="busy"
          @click="pilotActivateSpark"
        >
          {{ t('rideSignalCaps.pilotActivateSpark') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          :disabled="busy"
          @click="pilotDeactivateSpark"
        >
          {{ t('rideSignalCaps.pilotDeactivateSpark') }}
        </button>
      </div>
    </div>

    <div class="rounded-lg border border-slate-700/80 bg-slate-950/40 p-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-wide text-slate-200/90">
        {{ t('rideSignalCaps.regPubHealthTitle') }}
      </h3>
      <p class="mt-1 text-[10px] leading-relaxed text-slate-500">{{ t('rideSignalCaps.regPubHealthHint') }}</p>
      <dl v-if="regPubHealth" class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-300">
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubFlagEnabled') }}</dt>
        <dd>{{ regPubHealth.registryPublishEnabled ? 'true' : 'false' }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubMode') }}</dt>
        <dd class="font-mono">{{ regPubHealth.registryPublishMode }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubHealthAllowedCount') }}</dt>
        <dd>{{ regPubHealth.allowedRideCount }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubMqtt') }}</dt>
        <dd>
          {{ regPubHealth.mqttEnabled ? 'on' : 'off' }} /
          {{ regPubHealth.mqttConnected ? t('rideSignalCaps.regPubHealthMqttOk') : t('rideSignalCaps.regPubHealthMqttNo') }}
        </dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubHealthLastDryRun') }}</dt>
        <dd class="font-mono">{{ formatIsoShort(regPubHealth.lastDryRunAt) }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubHealthLastPublish') }}</dt>
        <dd class="font-mono">{{ formatIsoShort(regPubHealth.lastPublishAt) }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubHealthFailures24h') }}</dt>
        <dd :class="regPubHealth.failedEventsLast24h > 0 ? 'text-amber-300/90' : ''">{{ regPubHealth.failedEventsLast24h }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubHealthSkipped24h') }}</dt>
        <dd>{{ regPubHealth.skippedEventsLast24h }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubHealthPublished24h') }}</dt>
        <dd>{{ regPubHealth.publishedEventsLast24h }}</dd>
      </dl>
      <p v-else class="mt-2 text-[10px] text-slate-600">{{ t('rideSignalCaps.regPubHealthLoadFailed') }}</p>
      <div class="mt-3 border-t border-slate-800 pt-3">
        <button
          type="button"
          class="rounded-md border border-rose-900/70 bg-rose-950/40 px-2.5 py-1.5 text-[11px] text-rose-100 hover:bg-rose-900/35 disabled:opacity-50"
          :disabled="busy || regPubBusy"
          @click="registryDisablePilot"
        >
          {{ t('rideSignalCaps.regPubDisablePilot') }}
        </button>
        <p class="mt-1.5 text-[9px] text-slate-500">{{ t('rideSignalCaps.regPubDisablePilotHint') }}</p>
      </div>
    </div>

    <div class="rounded-lg border border-violet-900/50 bg-violet-950/20 p-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-wide text-violet-200/90">{{ t('rideSignalCaps.regPubTitle') }}</h3>
      <p class="mt-1 text-[10px] leading-relaxed text-slate-400">{{ t('rideSignalCaps.regPubIntro') }}</p>
      <p class="mt-2 text-[10px] font-medium text-amber-200/90">{{ t('rideSignalCaps.regPubWarnLegacy') }}</p>
      <p class="mt-1 text-[10px] font-medium text-amber-200/90">{{ t('rideSignalCaps.regPubWarnAllowlist') }}</p>

      <dl v-if="regPubStatus" class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-300">
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubFlagEnabled') }}</dt>
        <dd>{{ regPubStatus.registryPublishEnabled ? 'true' : 'false' }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubMode') }}</dt>
        <dd class="font-mono">{{ regPubStatus.registryPublishMode }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubSparkFormat') }}</dt>
        <dd class="font-mono">{{ regPubStatus.registrySparkplugFormat }}</dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubMqtt') }}</dt>
        <dd>
          {{ regPubStatus.mqttEnabled ? 'enabled' : 'disabled' }} /
          {{ regPubStatus.mqttConnected ? 'connected' : 'disconnected' }}
        </dd>
        <dt class="text-slate-500">{{ t('rideSignalCaps.regPubAllowed') }}</dt>
        <dd :class="rideOnRegistryAllowList(regPubStatus) ? 'text-emerald-300/90' : 'text-amber-200/90'">
          {{ rideOnRegistryAllowList(regPubStatus) ? t('rideSignalCaps.regPubAllowedYes') : t('rideSignalCaps.regPubAllowedNo') }}
        </dd>
      </dl>
      <p v-else class="mt-2 text-[10px] text-slate-600">{{ t('rideSignalCaps.regPubLoadFailed') }}</p>

      <div class="mt-3 flex flex-wrap gap-2 border-t border-violet-900/30 pt-3">
        <button
          type="button"
          class="rounded-md border border-violet-700/70 bg-violet-950/50 px-2.5 py-1.5 text-[11px] text-violet-100 hover:bg-violet-900/40 disabled:opacity-50"
          :disabled="busy || regPubBusy || !rideOnRegistryAllowList(regPubStatus)"
          @click="registryDryRun"
        >
          {{ t('rideSignalCaps.regPubDryRun') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-fuchsia-800/70 bg-fuchsia-950/40 px-2.5 py-1.5 text-[11px] text-fuchsia-100 hover:bg-fuchsia-900/35 disabled:opacity-50"
          :disabled="busy || regPubBusy || !regPubStatus?.registryPublishEnabled || !rideOnRegistryAllowList(regPubStatus)"
          @click="registryPublishOnce"
        >
          {{ t('rideSignalCaps.regPubPublishOnce') }}
        </button>
      </div>

      <div class="mt-3 border-t border-violet-900/30 pt-3">
        <p class="text-[10px] font-semibold text-violet-200/80">{{ t('rideSignalCaps.regPubEvents') }}</p>
        <ul v-if="regPubEvents.length" class="mt-2 max-h-40 space-y-1 overflow-y-auto font-mono text-[9px] text-slate-400">
          <li v-for="ev in regPubEvents" :key="ev.id" class="truncate" :title="ev.topic">
            <span class="text-slate-500">{{ ev.createdAt?.slice?.(0, 19) ?? ev.createdAt }}</span>
            <span class="ml-1 text-slate-300">{{ ev.status }}</span>
            <span class="ml-1">{{ ev.publishFormat }}</span>
            <span class="ml-1 truncate">{{ ev.topic }}</span>
          </li>
        </ul>
        <p v-else class="mt-2 text-[10px] text-slate-600">{{ t('rideSignalCaps.regPubNoEvents') }}</p>
      </div>
    </div>
  </div>
</template>
