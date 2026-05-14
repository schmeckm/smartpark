<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  applyMasterDataTemplate,
  createManualMasterDataAsset,
  getEffectiveMlConfig,
  getEntityTypeTemplate,
  getMasterDataDetail,
  getMlProfiles,
  getPlatformParkZones,
  getRideSignalCapabilities,
  listEntityTypeTemplates,
  patchMasterData,
  putAssetMlProfile,
  type EntityTypeTemplateRow,
  type MlProfileRow,
  type PlatformParkZoneRow,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import type { PlatformPark } from '@/types/api'
import {
  buildPatchPayload,
  computeWizardKpis,
  draftStorageKey,
  emptyWizardState,
  flattenWizardProfileForTemplate,
  hydrateWizardFromDetail,
  KNOWN_RIDE_PROFILE_RIDE_TYPES,
  missingTemplateRequiredKeys,
  profileCompletenessLabel,
  templateApplyPreview,
  validateStaffingChain,
  WIZARD_CAPACITY_UI_TO_PROFILE_KEY,
  WIZARD_STAFFING_UI_TO_PROFILE_KEY,
  type WizardEntityTab,
  type WizardFormState,
} from './masterDataWizard.utils'
import RideSignalCapabilitiesPanel from './RideSignalCapabilitiesPanel.vue'
import type { RideSignalCapsPanelExpose } from './rideSignalCapabilitiesPanel.types'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    open: boolean
    tab: WizardEntityTab
    mode: 'create' | 'edit'
    entityId: string | null
    parks: PlatformPark[]
    /** After manual create, parent can pass resolved id for subsequent saves. */
    initialParkId?: string
  }>(),
  { initialParkId: '', entityId: null }
)

const emit = defineEmits<{
  'update:open': [v: boolean]
  saved: []
}>()

const { push } = useToast()
const auth = useAuthStore()
const canRefreshAi = () => auth.hasPermission('ai', 'refresh')

/** API entity type for ML profile list (wizard has no shop tab). */
const mlListEntityType = computed(() => {
  if (props.tab === 'rides') return 'RIDE'
  if (props.tab === 'shows') return 'SHOW'
  if (props.tab === 'restaurants') return 'RESTAURANT'
  return ''
})

const effectiveMlPreviewJson = computed(() => {
  if (!effectiveMl.value) return ''
  try {
    return JSON.stringify(effectiveMl.value, null, 2)
  } catch {
    return ''
  }
})

const mlProfileOptions = ref<MlProfileRow[]>([])
const selectedMlProfileId = ref('')
const effectiveMl = ref<Record<string, unknown> | null>(null)
const mlStepLoading = ref(false)
const signalUsageLoading = ref(false)
const signalUsageCounts = ref<{ ml: number; forecast: number } | null>(null)

async function loadMlStep(force = false) {
  if (props.tab === 'parks') return
  if (!force && step.value !== 5) return
  if (!effectiveId.value) {
    mlProfileOptions.value = []
    effectiveMl.value = null
    selectedMlProfileId.value = ''
    return
  }
  mlStepLoading.value = true
  try {
    const et = mlListEntityType.value
    if (!et) {
      mlProfileOptions.value = []
      return
    }
    mlProfileOptions.value = await getMlProfiles({ entityType: et, activeFlag: true })
    effectiveMl.value = (await getEffectiveMlConfig(effectiveId.value)) as Record<string, unknown>
    if (props.tab === 'rides') {
      signalUsageLoading.value = true
      try {
        const caps = await getRideSignalCapabilities(effectiveId.value)
        let ml = 0
        let forecast = 0
        for (const row of caps.signals || []) {
          const useForMl = typeof row.useForMl === 'boolean' ? row.useForMl : row.signalSource === 'ML'
          const useForForecast = typeof row.useForForecast === 'boolean' ? row.useForForecast : useForMl
          if (useForMl) ml += 1
          if (useForForecast) forecast += 1
        }
        signalUsageCounts.value = { ml, forecast }
      } catch {
        signalUsageCounts.value = null
      } finally {
        signalUsageLoading.value = false
      }
    } else {
      signalUsageCounts.value = null
      signalUsageLoading.value = false
    }
    const prof = effectiveMl.value?.profile as { id?: string } | undefined
    selectedMlProfileId.value = prof?.id ? String(prof.id) : ''
  } catch {
    mlProfileOptions.value = []
    effectiveMl.value = null
    selectedMlProfileId.value = ''
    signalUsageCounts.value = null
    signalUsageLoading.value = false
  } finally {
    mlStepLoading.value = false
  }
}

/** Enterprise ML catalog assignment (not part of master_profile PATCH). */
async function writeCatalogMlProfileIfSelected(): Promise<void> {
  if (props.tab === 'parks') return
  const aid = effectiveId.value
  if (!aid) return
  const pid = String(selectedMlProfileId.value || '').trim()
  if (!pid) return
  if (!canRefreshAi()) {
    push(t('wizardMl.needAiRefresh'), 'warning')
    return
  }
  await putAssetMlProfile(aid, { profileId: pid })
}

async function saveMlProfileAssignment() {
  if (!effectiveId.value || !String(selectedMlProfileId.value || '').trim() || !canRefreshAi()) return
  mlStepLoading.value = true
  try {
    await writeCatalogMlProfileIfSelected()
    push(t('wizardMl.toastSaved'), 'success')
    await loadMlStep()
  } catch (e) {
    push(e instanceof Error ? e.message : t('wizardMl.toastSaveFailed'), 'error')
  } finally {
    mlStepLoading.value = false
  }
}

type WizardStepDef = { id: number; label: string; labelI18n?: string }

const STEPS: readonly WizardStepDef[] = [
  { id: 1, label: 'Basic Info' },
  { id: 2, label: 'Template' },
  { id: 3, label: 'Capacity' },
  { id: 4, label: 'Staffing' },
  { id: 5, label: 'Forecast behavior', labelI18n: 'wizardMl.stepNav' },
  { id: 6, label: 'Review' },
]

function sortPlatformZones(rows: PlatformParkZoneRow[]): PlatformParkZoneRow[] {
  return rows.slice().sort((a, b) => {
    const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    if (so !== 0) return so
    return (a.name || '').localeCompare(b.name || '')
  })
}

const step = ref(1)
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref<string | null>(null)
const detail = ref<Record<string, unknown> | null>(null)
const state = ref<WizardFormState>(emptyWizardState('rides'))
const baseline = ref('')
const templateOptions = ref<EntityTypeTemplateRow[]>([])
const templateDetail = ref<EntityTypeTemplateRow | null>(null)
const zones = ref<PlatformParkZoneRow[]>([])
const advOpen = ref(false)
const resolvedEntityId = ref<string | null>(null)
const rideSignalCapsPanelRef = ref<RideSignalCapsPanelExpose | null>(null)

const effectiveId = computed(() => resolvedEntityId.value || props.entityId)

const typeBadge = computed(() => {
  const m: Record<WizardEntityTab, string> = {
    parks: 'PARK',
    rides: 'RIDE',
    shows: 'SHOW',
    restaurants: 'RESTAURANT',
  }
  return m[props.tab]
})

const entityTitle = computed(() => state.value.basic.name || (props.mode === 'create' ? 'New entity' : '—'))

const completeness = computed(() => profileCompletenessLabel(detail.value))

const presentation = computed(() => (detail.value?.masterDataPresentation || {}) as Record<string, unknown>)

const providerBlock = computed(() => presentation.value.providerReadOnly as Record<string, unknown> | undefined)

const rawPayload = computed(() => presentation.value.raw_payload_json)

const selectedTemplate = computed(() => templateOptions.value.find((t) => t.id === state.value.templateId) || null)

const preview = computed(() =>
  templateApplyPreview(selectedTemplate.value, state.value.baseMasterProfile, state.value.templateApplyMode)
)

const kpis = computed(() => computeWizardKpis(props.tab, state.value))

/** Template `requiredFieldsJson` (detail fetch or template dropdown row). */
const templateRequiredKeysList = computed((): string[] => {
  const tpl = templateDetail.value || selectedTemplate.value
  const raw = tpl?.requiredFieldsJson
  if (!Array.isArray(raw)) return []
  return raw.map((x) => String(x))
})

const templateRequiredKeySet = computed(
  () => new Set(templateRequiredKeysList.value.map((k) => k.trim().toLowerCase()))
)

const parkRowForTemplateCompleteness = computed(() => {
  if (props.tab !== 'parks') return null
  return { name: state.value.basic.name, timezone: state.value.basic.timezone || null }
})

/** Missing required master-profile keys from current wizard state (all steps). */
const missingTemplateKeysLive = computed(() => {
  if (!state.value.templateId || templateRequiredKeysList.value.length === 0) return []
  try {
    const flat = flattenWizardProfileForTemplate(props.tab, state.value)
    return missingTemplateRequiredKeys(templateRequiredKeysList.value, flat, parkRowForTemplateCompleteness.value)
  } catch {
    return []
  }
})

function profileKeyRequired(snakeKey: string): boolean {
  return templateRequiredKeySet.value.has(snakeKey.trim().toLowerCase())
}

function reqStarUi(uiField: string, map: Record<string, string>): string {
  const pk = map[uiField]
  return pk && profileKeyRequired(pk) ? ' *' : ''
}

function serializeForDirty(): string {
  return JSON.stringify({
    step: step.value,
    s: state.value,
  })
}

const isDirty = computed(() => baseline.value !== '' && serializeForDirty() !== baseline.value)

function setBaseline() {
  baseline.value = serializeForDirty()
}

watch([step, effectiveId, () => props.tab, mlListEntityType], () => {
  void loadMlStep()
})

const templateEntityQuery = computed(() => {
  const m: Record<WizardEntityTab, string> = {
    parks: 'PARK',
    rides: 'RIDE',
    shows: 'SHOW',
    restaurants: 'RESTAURANT',
  }
  return m[props.tab]
})

async function loadTemplates() {
  try {
    templateOptions.value = await listEntityTypeTemplates(templateEntityQuery.value)
  } catch {
    templateOptions.value = []
  }
}

watch(
  () => state.value.templateId,
  async (id) => {
    if (!id) {
      templateDetail.value = null
      return
    }
    try {
      templateDetail.value = await getEntityTypeTemplate(id)
    } catch {
      templateDetail.value = null
    }
  }
)

watch(
  () => state.value.basic.parkId,
  async (parkKey) => {
    if (!parkKey || props.tab === 'parks') {
      zones.value = []
      return
    }
    try {
      const rows = await getPlatformParkZones(parkKey)
      zones.value = sortPlatformZones(rows)
    } catch {
      zones.value = []
    }
  }
)

async function loadDetailIntoState() {
  errorMsg.value = null
  const id = effectiveId.value
  if (!id || props.mode === 'create') {
    detail.value = null
    state.value = emptyWizardState(props.tab)
    if (props.initialParkId) state.value.basic.parkId = props.initialParkId
    await loadTemplates()
    setBaseline()
    return
  }
  loading.value = true
  try {
    const d = await getMasterDataDetail(props.tab, id)
    detail.value = d
    state.value = hydrateWizardFromDetail(d, props.tab)
    await loadTemplates()
    if (state.value.templateId) {
      try {
        templateDetail.value = await getEntityTypeTemplate(state.value.templateId)
      } catch {
        templateDetail.value = null
      }
    }
    if (state.value.basic.parkId) {
      try {
        const rows = await getPlatformParkZones(state.value.basic.parkId)
        zones.value = sortPlatformZones(rows)
      } catch {
        zones.value = []
      }
    }
    setBaseline()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  async (o) => {
    if (!o) return
    step.value = 1
    resolvedEntityId.value = props.entityId
    await loadDetailIntoState()
    tryLoadDraft()
    /** Draft overwrote hydrated state — rebaseline so ✕ close does not warn without further edits. */
    setBaseline()
  }
)

watch(
  () => props.tab,
  () => {
    if (props.open) void loadDetailIntoState()
  }
)

function tryLoadDraft() {
  const key = draftStorageKey(props.tab, effectiveId.value, props.mode)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw) as { step?: number; state?: WizardFormState }
    if (parsed.state) {
      state.value = { ...emptyWizardState(props.tab), ...parsed.state, basic: { ...emptyWizardState(props.tab).basic, ...parsed.state.basic } }
    }
    if (parsed.step && parsed.step >= 1 && parsed.step <= 6) step.value = parsed.step
  } catch {
    /* ignore */
  }
}

function close() {
  emit('update:open', false)
}

async function requestClose() {
  if (isDirty.value) {
    const ok = await askConfirm({
      message: t('wizardMl.closeUnsavedMessage'),
      confirmLabel: t('wizardMl.closeConfirmDiscard'),
      cancelLabel: t('wizardMl.closeConfirmStay'),
      variant: 'danger',
    })
    if (!ok) return
  }
  close()
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!props.open || !isDirty.value) return
  e.preventDefault()
  e.returnValue = ''
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', onBeforeUnload)
}
onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

function saveDraft() {
  const key = draftStorageKey(props.tab, effectiveId.value, props.mode)
  try {
    localStorage.setItem(key, JSON.stringify({ step: step.value, state: state.value }))
    push('Draft saved locally', 'success')
  } catch {
    push('Could not save draft', 'error')
  }
}

const stepDone = computed(() => {
  const s = state.value
  const parkHoursOk =
    props.tab !== 'parks' ||
    !s.basic.masterOperatingHoursEnabled ||
    s.basic.masterOperatingType === 'CLOSED' ||
    !!(s.basic.masterOpeningTime.trim() && s.basic.masterClosingTime.trim())
  const ok1 = !!(s.basic.name.trim() && parkHoursOk && (props.tab === 'parks' || props.mode === 'edit' || s.basic.parkId.trim()))
  const ok4 = validateStaffingChain(props.tab, s.staffing) === null
  return [ok1, true, true, ok4, true, true]
})

async function applyTemplateDefaults() {
  const tid = state.value.templateId
  const id = effectiveId.value
  if (!tid || !id || props.mode === 'create') {
    push('Select a template and save the entity first to apply server-side defaults.', 'error')
    return
  }
  saving.value = true
  errorMsg.value = null
  try {
    await applyMasterDataTemplate(props.tab, id, tid, { mode: state.value.templateApplyMode })
    push('Template defaults applied', 'success')
    await loadDetailIntoState()
    step.value = 2
  } catch (e) {
    push(e instanceof Error ? e.message : 'Apply failed', 'error')
  } finally {
    saving.value = false
  }
}

/** Client-side preview merge for create mode / preview only */
function mergeDefaultsLocal() {
  const tpl = selectedTemplate.value
  if (!tpl?.defaultValuesJson) return
  const defs = tpl.defaultValuesJson as Record<string, unknown>
  const mp = { ...state.value.baseMasterProfile }
  const mode = state.value.templateApplyMode
  for (const [k, v] of Object.entries(defs)) {
    if (mode === 'fill_empty') {
      const cur = mp[k]
      if (cur === undefined || cur === null || cur === '') mp[k] = v
    } else {
      mp[k] = v
    }
  }
  state.value.baseMasterProfile = mp
  if (props.tab === 'rides') {
    const mergedRt = mp.ride_type
    if (mergedRt !== undefined && mergedRt !== null && String(mergedRt).trim() !== '') {
      state.value.basic.rideType = String(mergedRt).trim()
    }
  }
  push('Defaults merged into profile (local). Use Save to persist.', 'success')
}

async function persist() {
  const patch = buildPatchPayload(props.tab, state.value)
  if (props.tab === 'parks') {
    await patchMasterData('parks', effectiveId.value!, patch)
    return
  }
  const et = props.tab as 'rides' | 'shows' | 'restaurants'
  await patchMasterData(et, effectiveId.value!, patch)
}

async function saveAll(final: boolean) {
  errorMsg.value = null
  const staffErr = validateStaffingChain(props.tab, state.value.staffing)
  if (staffErr) {
    errorMsg.value = staffErr
    step.value = 4
    return
  }
  saving.value = true
  try {
    if (props.mode === 'create' && props.tab !== 'parks') {
      if (!state.value.basic.parkId.trim() || !state.value.basic.name.trim()) {
        errorMsg.value = 'Park and name are required.'
        step.value = 1
        return
      }
      if (!effectiveId.value) {
        const created = await createManualMasterDataAsset(props.tab, {
          parkId: state.value.basic.parkId.trim(),
          name: state.value.basic.name.trim(),
          slug: state.value.basic.slug.trim() || undefined,
        })
        const assetRow = created.asset as Record<string, unknown> | undefined
        const aid = assetRow?.assetId ?? assetRow?.id
        if (typeof aid !== 'string' || !aid) throw new Error('Create response missing asset id')
        resolvedEntityId.value = String(aid)
      }
      await persist()
    } else {
      if (!effectiveId.value) throw new Error('Missing entity id')
      await persist()
    }
    await nextTick()
    if (props.tab === 'rides' && effectiveId.value) {
      const flush = rideSignalCapsPanelRef.value?.flushSignalCapabilitiesIfDirty
      if (flush) {
        const signalOk = await flush()
        if (!signalOk) throw new Error(t('wizardMl.signalCapsSaveFailed'))
      }
    }
    let mlSaveFailed: string | null = null
    try {
      await writeCatalogMlProfileIfSelected()
    } catch (e) {
      mlSaveFailed = e instanceof Error ? e.message : String(e)
    }
    if (mlSaveFailed) {
      push(t('wizardMl.toastMasterSavedMlFailed', { detail: mlSaveFailed }), 'error')
    } else {
      push(final ? 'Saved' : 'Saved', 'success')
    }
    setBaseline()
    emit('saved')
    if (final) close()
    else {
      await loadDetailIntoState()
      if (props.tab !== 'parks' && effectiveId.value) await loadMlStep(true)
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    push(errorMsg.value, 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mdw-title"
    >
      <div
        class="flex h-[96vh] min-h-[36rem] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl sm:h-[92vh] lg:h-[88vh]"
        @click.stop
      >
        <header class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 id="mdw-title" class="text-base font-semibold text-white">
              {{ mode === 'create' ? 'Create' : 'Edit' }} master data: {{ entityTitle }}
            </h2>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-brand-300">{{ typeBadge }}</span>
              <span
                class="text-slate-500"
                :title="
                  missingTemplateKeysLive.length
                    ? `${t('masterDataWizard.requiredFieldsBanner')} ${missingTemplateKeysLive.join(', ')}`
                    : undefined
                "
              >
                Profile: {{ completeness }}
              </span>
              <span v-if="isDirty" class="text-amber-400">Unsaved changes</span>
            </div>
          </div>
          <button type="button" class="text-slate-400 hover:text-white" aria-label="Close" @click="requestClose">✕</button>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-[11rem_1fr]">
          <nav class="border-b border-slate-800 p-3 md:sticky md:top-0 md:max-h-full md:self-start md:overflow-y-auto md:border-b-0 md:border-r md:border-slate-800">
            <ol class="space-y-1 text-sm">
              <li v-for="(st, idx) in STEPS" :key="st.id">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
                  :class="step === st.id ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-slate-800'"
                  @click="step = st.id"
                >
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
                    :class="stepDone[idx] ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-500'"
                  >
                    {{ stepDone[idx] ? '✓' : st.id }}
                  </span>
                  <span>{{ st.labelI18n ? t(st.labelI18n) : st.label }}</span>
                </button>
              </li>
            </ol>
          </nav>

          <div class="min-h-0 overflow-y-auto p-4">
            <p v-if="loading" class="text-sm text-slate-500">Loading…</p>
            <p v-if="errorMsg" class="text-sm text-rose-400">{{ errorMsg }}</p>

            <div v-if="!loading" class="space-y-4">
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div
                  v-for="k in kpis"
                  :key="k.label"
                  class="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400"
                >
                  <div class="text-[10px] uppercase tracking-wide text-slate-500">
                    {{ k.label }}<span v-if="k.requiredProfileKey && profileKeyRequired(k.requiredProfileKey)" class="text-amber-400"> *</span>
                  </div>
                  <div class="mt-1 font-mono text-sm text-white">{{ k.value }}</div>
                </div>
              </div>

              <div
                v-if="state.templateId && templateRequiredKeysList.length && missingTemplateKeysLive.length"
                class="rounded-lg border border-amber-800/50 bg-amber-950/35 px-3 py-2 text-xs text-amber-100"
                role="status"
              >
                <span class="font-medium text-amber-50">{{ t('masterDataWizard.requiredFieldsBanner') }}</span>
                <span class="mt-1 block font-mono text-[11px] leading-snug text-amber-200/95">{{ missingTemplateKeysLive.join(', ') }}</span>
                <p class="mt-1 text-[10px] leading-snug text-amber-200/75">{{ t('masterDataWizard.requiredFieldsHint') }}</p>
              </div>

              <!-- Step 1 -->
              <section v-show="step === 1" class="space-y-3">
                <h3 class="text-sm font-medium text-slate-200">Basic Info</h3>
                <p v-if="templateRequiredKeysList.length" class="text-[11px] text-slate-500">{{ t('masterDataWizard.requiredStarMeaning') }}</p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="block text-xs text-slate-500">
                    Name *
                    <input v-model="state.basic.name" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                  <label class="block text-xs text-slate-500">
                    Display name<span v-if="profileKeyRequired('display_name')" class="text-amber-400"> *</span>
                    <input v-model="state.basic.displayName" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                  <label class="block text-xs text-slate-500">
                    Internal code<span v-if="profileKeyRequired('internal_code')" class="text-amber-400"> *</span>
                    <input v-model="state.basic.internalCode" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                  <label class="block text-xs text-slate-500">
                    Slug<span v-if="profileKeyRequired('slug')" class="text-amber-400"> *</span>
                    <input v-model="state.basic.slug" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                  <label v-if="tab !== 'parks'" class="block text-xs text-slate-500">
                    Park * (UUID, slug, or external id)
                    <input v-model="state.basic.parkId" list="mdw-parks" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                    <datalist id="mdw-parks">
                      <option v-for="p in parks" :key="p.id" :value="p.slug || p.id">{{ p.name }}</option>
                    </datalist>
                  </label>
                  <label v-if="tab !== 'parks'" class="block text-xs text-slate-500">
                    Zone
                    <select v-model="state.basic.zoneId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
                      <option value="">— None —</option>
                      <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
                    </select>
                  </label>
                  <label v-if="tab !== 'parks'" class="block text-xs text-slate-500">
                    Parent asset id
                    <input v-model="state.basic.parentAssetId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                  <label v-if="tab === 'parks'" class="block text-xs text-slate-500">
                    Timezone<span v-if="profileKeyRequired('timezone')" class="text-amber-400"> *</span>
                    <input v-model="state.basic.timezone" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                  <template v-if="tab === 'parks'">
                    <div class="sm:col-span-2 rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
                      <p class="text-xs font-medium text-slate-200">{{ t('wizardParkOperating.sectionTitle') }}</p>
                      <p class="mt-1 text-[11px] leading-snug text-slate-500">{{ t('wizardParkOperating.sectionHint') }}</p>
                      <label class="mt-3 flex items-center gap-2 text-xs text-slate-300">
                        <input v-model="state.basic.masterOperatingHoursEnabled" type="checkbox" class="rounded border-slate-600" />
                        {{ t('wizardParkOperating.useMaster') }}
                      </label>
                      <label v-if="state.basic.masterOperatingHoursEnabled" class="mt-3 block text-xs text-slate-500">
                        {{ t('wizardParkOperating.dayMode') }}
                        <select
                          v-model="state.basic.masterOperatingType"
                          class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                        >
                          <option value="OPERATING">{{ t('wizardParkOperating.modeOpen') }}</option>
                          <option value="CLOSED">{{ t('wizardParkOperating.modeClosed') }}</option>
                        </select>
                      </label>
                      <div
                        v-if="state.basic.masterOperatingHoursEnabled && state.basic.masterOperatingType === 'OPERATING'"
                        class="mt-3 grid gap-3 sm:grid-cols-2"
                      >
                        <label class="block text-xs text-slate-500">
                          {{ t('wizardParkOperating.open') }}
                          <input
                            v-model="state.basic.masterOpeningTime"
                            type="text"
                            class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-sm text-white"
                            placeholder="09:00"
                          />
                        </label>
                        <label class="block text-xs text-slate-500">
                          {{ t('wizardParkOperating.close') }}
                          <input
                            v-model="state.basic.masterClosingTime"
                            type="text"
                            class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-sm text-white"
                            placeholder="20:00"
                          />
                        </label>
                      </div>
                    </div>
                  </template>
                  <label class="flex items-center gap-2 text-xs text-slate-400 sm:col-span-2">
                    <input v-model="state.basic.activeFlag" type="checkbox" class="rounded border-slate-600" />
                    Active
                  </label>
                  <label v-if="tab === 'rides'" class="block text-xs text-slate-500">
                    {{ t('masterDataWizard.rideType') }}<span v-if="profileKeyRequired('ride_type')" class="text-amber-400"> *</span>
                    <input
                      v-model="state.basic.rideType"
                      list="mdw-ride-type-suggestions"
                      class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white"
                      :placeholder="t('masterDataWizard.rideTypePlaceholder')"
                      autocomplete="off"
                    />
                    <datalist id="mdw-ride-type-suggestions">
                      <option v-for="rt in KNOWN_RIDE_PROFILE_RIDE_TYPES" :key="rt" :value="rt" />
                    </datalist>
                    <p class="mt-0.5 text-[10px] text-slate-500">{{ t('masterDataWizard.rideTypeHint') }}</p>
                  </label>
                  <label class="block text-xs text-slate-500">
                    Indoor / outdoor<span v-if="profileKeyRequired('indoor_outdoor')" class="text-amber-400"> *</span>
                    <input v-model="state.basic.indoorOutdoor" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" placeholder="INDOOR / OUTDOOR" />
                  </label>
                  <label class="block text-xs text-slate-500 sm:col-span-2">
                    Notes<span v-if="profileKeyRequired('notes')" class="text-amber-400"> *</span>
                    <textarea v-model="state.basic.notes" rows="2" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                </div>
              </section>

              <!-- Step 2 -->
              <section v-show="step === 2" class="space-y-3">
                <h3 class="text-sm font-medium text-slate-200">Template</h3>
                <label class="block text-xs text-slate-500">
                  Template
                  <select v-model="state.templateId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white">
                    <option value="">— None —</option>
                    <option v-for="t in templateOptions" :key="t.id" :value="t.id">{{ t.templateCode }} — {{ t.templateName }}</option>
                  </select>
                </label>
                <p v-if="templateDetail?.description" class="text-xs text-slate-400">{{ templateDetail.description }}</p>
                <label class="block text-xs text-slate-500">
                  Apply mode
                  <select
                    v-model="state.templateApplyMode"
                    class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                  >
                    <option value="fill_empty">Fill empty fields only</option>
                    <option value="override">Override existing curated values</option>
                  </select>
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-if="mode === 'edit' && effectiveId"
                    type="button"
                    class="rounded-md bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50"
                    :disabled="saving || !state.templateId"
                    @click="applyTemplateDefaults"
                  >
                    Apply template (server)
                  </button>
                  <button type="button" class="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200" @click="mergeDefaultsLocal">
                    Merge defaults (local preview)
                  </button>
                </div>
                <div class="rounded border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
                  <p class="font-semibold text-slate-300">Preview</p>
                  <p class="mt-1">Filled / new: {{ preview.filled.join(', ') || '—' }}</p>
                  <p class="mt-1">Unchanged (fill-empty only): {{ preview.unchanged.join(', ') || '—' }}</p>
                  <p class="mt-1 text-amber-200">Required still missing: {{ preview.missing.join(', ') || '—' }}</p>
                  <p v-if="state.templateId && templateRequiredKeysList.length" class="mt-1 text-amber-100/95">
                    {{ t('masterDataWizard.requiredStillMissingLive') }} {{ missingTemplateKeysLive.join(', ') || '—' }}
                  </p>
                </div>
              </section>

              <!-- Step 3 Capacity -->
              <section v-show="step === 3" class="space-y-3">
                <h3 class="text-sm font-medium text-slate-200">Capacity & throughput</h3>
                <p v-if="templateRequiredKeysList.length" class="text-[11px] text-slate-500">{{ t('masterDataWizard.requiredStarMeaning') }}</p>
                <div v-if="tab === 'rides'" class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['theoreticalCapacityPerHour','targetThroughputPerHour','dispatchIntervalSec','seatsPerVehicle','vehiclesCount','loadingStations','loadTimeAvgSec','unloadTimeAvgSec']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_CAPACITY_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.capacity[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
                <div v-else-if="tab === 'shows'" class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['venueCapacity','showDurationMin','turnoverTimeMin','showsPerDayTarget','avgFillRatePercent']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_CAPACITY_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.capacity[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
                <div v-else-if="tab === 'restaurants'" class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['seatingCapacity','serviceCapacityPerHour','avgServiceTimeMin','cashRegisters','kitchenStations','tableTurnoverTimeMin']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_CAPACITY_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.capacity[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
                <div v-else class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['maxDailyCapacity','expectedDailyVisitors','parkingCapacity','hotelRooms']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_CAPACITY_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.capacity[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
              </section>

              <!-- Step 4 Staffing -->
              <section v-show="step === 4" class="space-y-3">
                <h3 class="text-sm font-medium text-slate-200">Staffing</h3>
                <p v-if="templateRequiredKeysList.length" class="text-[11px] text-slate-500">{{ t('masterDataWizard.requiredStarMeaning') }}</p>
                <div v-if="tab === 'rides'" class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['employeesRequiredMin','employeesRequiredNormal','employeesRequiredPeak','operatorSkillLevel']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_STAFFING_UI_TO_PROFILE_KEY) }}
                    <input
                      v-if="lbl !== 'operatorSkillLevel'"
                      v-model="state.staffing[lbl]"
                      type="text"
                      class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white"
                    />
                    <input v-else v-model="state.staffing[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
                  </label>
                  <label class="flex items-center gap-2 text-xs text-slate-400 sm:col-span-2">
                    <input v-model="state.staffing.supervisorRequiredFlag" type="checkbox" class="rounded border-slate-600" />
                    supervisorRequiredFlag<span v-if="profileKeyRequired('supervisor_required_flag')" class="text-amber-400"> *</span>
                  </label>
                </div>
                <div v-else-if="tab === 'shows'" class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['employeesRequiredMin','employeesRequiredNormal','employeesRequiredPeak','performersRequired','technicalStaffRequired']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_STAFFING_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.staffing[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
                <div v-else-if="tab === 'restaurants'" class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['employeesRequiredMin','employeesRequiredNormal','employeesRequiredPeak','kitchenStaffRequired','serviceStaffRequired','cashierStaffRequired']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_STAFFING_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.staffing[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
                <div v-else class="grid gap-3 sm:grid-cols-2">
                  <label v-for="lbl in ['operationsStaffTarget','securityStaffTarget','cleaningStaffTarget']" :key="lbl" class="block text-xs text-slate-500">
                    {{ lbl }}{{ reqStarUi(lbl, WIZARD_STAFFING_UI_TO_PROFILE_KEY) }}
                    <input v-model="state.staffing[lbl]" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs text-white" />
                  </label>
                </div>
              </section>

              <!-- Step 5 ML -->
              <section v-show="step === 5" class="space-y-3">
                <h3 class="text-sm font-medium text-slate-200">{{ t('wizardMl.stepTitle') }}</h3>
                <p v-if="tab === 'parks'" class="text-xs text-slate-500">{{ t('wizardMl.parksHint') }}</p>
                <template v-else>
                  <p v-if="!effectiveId" class="text-xs text-amber-500">{{ t('wizardMl.saveBasicsFirst') }}</p>
                  <div v-else class="space-y-3 rounded border border-slate-700/60 bg-slate-950/40 p-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="text-[11px] uppercase tracking-wide text-slate-500">{{ mlListEntityType }}</span>
                      <RouterLink
                        v-if="mlListEntityType"
                        :to="{ name: 'ai-ml-profiles', query: { entity: mlListEntityType } }"
                        class="text-xs font-medium text-brand-400 hover:text-brand-300"
                      >
                        {{ t('wizardMl.openMlProfiles') }} →
                      </RouterLink>
                    </div>
                    <div v-if="mlStepLoading" class="text-xs text-slate-500">{{ t('wizardMl.loadingMl') }}</div>
                    <template v-else>
                      <label class="block text-xs text-slate-500">
                        {{ t('wizardMl.profileSelectLabel') }}
                        <select
                          v-model="selectedMlProfileId"
                          class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-white"
                        >
                          <option value="">—</option>
                          <option v-for="p in mlProfileOptions" :key="p.id" :value="p.id">
                            {{ p.profileCode }} — {{ p.profileName }}
                          </option>
                        </select>
                      </label>
                      <div v-if="effectiveMl" class="text-xs text-slate-400">
                        <div>{{ t('wizardMl.sourceLabel') }} {{ String(effectiveMl.source || '—') }}</div>
                        <div v-if="tab === 'rides'">
                          {{
                            signalUsageLoading
                              ? 'Signal usage: loading...'
                              : signalUsageCounts
                                ? `Signal usage: ${signalUsageCounts.ml} ML / ${signalUsageCounts.forecast} Forecast`
                                : 'Signal usage: —'
                          }}
                        </div>
                        <div v-if="effectiveMl.warnings && (effectiveMl.warnings as string[]).length" class="mt-1 text-amber-400">
                          {{ (effectiveMl.warnings as string[]).join('; ') }}
                        </div>
                      </div>
                      <div v-if="effectiveMlPreviewJson" class="space-y-1">
                        <div class="text-[11px] font-medium text-slate-500">{{ t('wizardMl.effectivePreviewTitle') }}</div>
                        <pre
                          class="max-h-48 overflow-auto rounded border border-slate-800 bg-slate-950/80 p-2 font-mono text-[10px] leading-relaxed text-slate-400"
                        >{{ effectiveMlPreviewJson }}</pre>
                      </div>
                      <button
                        type="button"
                        class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                        :disabled="!canRefreshAi() || !selectedMlProfileId || mlStepLoading"
                        @click="saveMlProfileAssignment()"
                      >
                        {{ t('wizardMl.saveAssignment') }}
                      </button>
                      <p class="text-[11px] text-slate-500">{{ t('wizardMl.mainSaveIncludesMl') }}</p>
                      <p v-if="!canRefreshAi()" class="text-xs text-slate-500">{{ t('wizardMl.needAiRefresh') }}</p>
                    </template>
                  </div>
                  <div v-if="tab === 'rides'" class="rounded border border-slate-700/60 bg-slate-950/40 p-3">
                    <div class="mb-2">
                      <p class="text-xs font-medium text-slate-300">Realtime signals (UNS / MQTT)</p>
                      <p class="text-[11px] text-slate-500">
                        Configure which ride signals come from UNS/MQTT/manual sources. This controls what data is actively provided to downstream consumers.
                      </p>
                    </div>
                    <RideSignalCapabilitiesPanel
                      v-if="effectiveId"
                      ref="rideSignalCapsPanelRef"
                      :ride-asset-id="effectiveId"
                      :asset-slug="String(state.basic.slug || '').trim()"
                    />
                    <p v-else class="text-xs text-amber-500">Save basic data first to configure signal usage.</p>
                  </div>
                </template>
              </section>

              <!-- Step 6 Review -->
              <section v-show="step === 6" class="space-y-3">
                <h3 class="text-sm font-medium text-slate-200">Review & save</h3>
                <dl class="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                  <dt class="text-slate-500">Name</dt>
                  <dd class="font-mono text-slate-200">{{ state.basic.name }}</dd>
                  <dt class="text-slate-500">Template</dt>
                  <dd class="font-mono text-slate-200">{{ selectedTemplate?.templateCode || '—' }}</dd>
                  <dt class="text-slate-500">Required missing</dt>
                  <dd class="text-amber-200">{{ preview.missing.join(', ') || '—' }}</dd>
                </dl>
                <pre class="max-h-40 overflow-auto rounded border border-slate-800 bg-slate-900 p-2 text-[10px] text-slate-500">{{
                  JSON.stringify(buildPatchPayload(tab, state), null, 2)
                }}</pre>

                <details
                  class="rounded border border-slate-800 bg-slate-900/40"
                  :open="advOpen"
                  @toggle="advOpen = ($event.target as HTMLDetailsElement).open"
                >
                  <summary class="cursor-pointer px-3 py-2 text-xs text-slate-400">Advanced: provider-managed (read-only)</summary>
                  <div class="space-y-2 border-t border-slate-800 p-3">
                    <pre v-if="providerBlock" class="max-h-40 overflow-auto text-[10px] text-slate-500">{{ JSON.stringify(providerBlock, null, 2) }}</pre>
                    <pre v-if="rawPayload" class="max-h-40 overflow-auto text-[10px] text-slate-600">{{ JSON.stringify(rawPayload, null, 2) }}</pre>
                  </div>
                </details>
              </section>
            </div>
          </div>
        </div>

        <footer class="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-slate-950/75">
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300" @click="requestClose">Cancel</button>
            <button type="button" class="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300" @click="saveDraft">Save draft</button>
            <button
              type="button"
              class="rounded-md bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              :disabled="saving || (mode === 'create' && tab === 'parks')"
              @click="saveAll(false)"
            >
              Save
            </button>
            <button
              type="button"
              class="rounded-md bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              :disabled="saving || (mode === 'create' && tab === 'parks')"
              @click="saveAll(true)"
            >
              Save & close
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
