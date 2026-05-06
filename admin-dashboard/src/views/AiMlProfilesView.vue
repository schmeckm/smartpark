<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  deleteMlProfile,
  getMlProfiles,
  patchMlProfile,
  postMlProfile,
  type MlProfilePatchBody,
  type MlProfileRow,
  type MlProfileWriteBody,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const canEdit = computed(() => auth.hasPermission('ai', 'refresh'))

const rows = ref<MlProfileRow[]>([])
const loading = ref(false)
const saveLoading = ref(false)
const saveError = ref<string | null>(null)

const searchInput = ref('')
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchDebounced.value = v.trim()
  }, 300)
})

const entityFilter = ref<string>('')
const activeFilter = ref<'all' | 'true' | 'false'>('all')

const modalOpen = ref(false)
const modalMode = ref<'create' | 'edit' | 'duplicate'>('create')

type FormState = {
  id: string
  profileCode: string
  profileName: string
  entityType: string
  category: string
  activeFlag: boolean
  modelType: string
  featureSetCode: string
  weatherSensitive: boolean
  rainSensitive: boolean
  windSensitive: boolean
  heatSensitive: boolean
  weatherSensitivityScore: string
  rainImpactScore: string
  windImpactScore: string
  heatImpactScore: string
  queueElasticityScore: string
  capacityElasticityScore: string
  staffDependencyScore: string
  downtimeRiskScore: string
  maintenanceCriticality: string
  downtimeImpactLevel: string
  maxQueueTargetMin: string
  availabilityTargetPercent: string
  targetThroughputFactor: string
  notes: string
}

function emptyForm(): FormState {
  return {
    id: '',
    profileCode: '',
    profileName: '',
    entityType: 'RIDE',
    category: '',
    activeFlag: true,
    modelType: 'BASELINE',
    featureSetCode: 'DEFAULT_V1',
    weatherSensitive: false,
    rainSensitive: false,
    windSensitive: false,
    heatSensitive: false,
    weatherSensitivityScore: '',
    rainImpactScore: '',
    windImpactScore: '',
    heatImpactScore: '',
    queueElasticityScore: '',
    capacityElasticityScore: '',
    staffDependencyScore: '',
    downtimeRiskScore: '',
    maintenanceCriticality: '',
    downtimeImpactLevel: '',
    maxQueueTargetMin: '',
    availabilityTargetPercent: '',
    targetThroughputFactor: '',
    notes: '',
  }
}

const form = ref<FormState>(emptyForm())

function numOrNull(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function rowToForm(r: MlProfileRow): FormState {
  const x = r as Record<string, unknown>
  const str = (k: string) => (x[k] != null && x[k] !== '' ? String(x[k]) : '')
  return {
    id: String(r.id),
    profileCode: String(r.profileCode ?? ''),
    profileName: String(r.profileName ?? ''),
    entityType: String(r.entityType ?? 'RIDE'),
    category: str('category'),
    activeFlag: Boolean(r.activeFlag ?? x.active_flag ?? true),
    modelType: String(r.modelType ?? x.model_type ?? 'BASELINE'),
    featureSetCode: String(r.featureSetCode ?? x.feature_set_code ?? 'DEFAULT_V1'),
    weatherSensitive: Boolean(r.weatherSensitive ?? x.weather_sensitive ?? false),
    rainSensitive: Boolean(r.rainSensitive ?? x.rain_sensitive ?? false),
    windSensitive: Boolean(r.windSensitive ?? x.wind_sensitive ?? false),
    heatSensitive: Boolean(r.heatSensitive ?? x.heat_sensitive ?? false),
    weatherSensitivityScore: str('weatherSensitivityScore') || str('weather_sensitivity_score'),
    rainImpactScore: str('rainImpactScore') || str('rain_impact_score'),
    windImpactScore: str('windImpactScore') || str('wind_impact_score'),
    heatImpactScore: str('heatImpactScore') || str('heat_impact_score'),
    queueElasticityScore: str('queueElasticityScore') || str('queue_elasticity_score'),
    capacityElasticityScore: str('capacityElasticityScore') || str('capacity_elasticity_score'),
    staffDependencyScore: str('staffDependencyScore') || str('staff_dependency_score'),
    downtimeRiskScore: str('downtimeRiskScore') || str('downtime_risk_score'),
    maintenanceCriticality: str('maintenanceCriticality') || str('maintenance_criticality'),
    downtimeImpactLevel: str('downtimeImpactLevel') || str('downtime_impact_level'),
    maxQueueTargetMin: str('maxQueueTargetMin') || str('max_queue_target_min'),
    availabilityTargetPercent: str('availabilityTargetPercent') || str('availability_target_percent'),
    targetThroughputFactor: str('targetThroughputFactor') || str('target_throughput_factor'),
    notes: str('notes'),
  }
}

function suggestDuplicateCode(base: string): string {
  const b = base.replace(/_COPY\d*$/i, '')
  return `${b}_COPY`
}

async function load() {
  loading.value = true
  try {
    const params: { entityType?: string; activeFlag?: boolean; search?: string } = {}
    if (entityFilter.value) params.entityType = entityFilter.value
    if (activeFilter.value !== 'all') params.activeFlag = activeFilter.value === 'true'
    if (searchDebounced.value) params.search = searchDebounced.value
    rows.value = await getMlProfiles(params)
  } catch (e) {
    rows.value = []
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

watch([entityFilter, activeFilter, searchDebounced], () => {
  void load()
})

onMounted(() => {
  const q = String(route.query.entity || '').trim().toUpperCase()
  if (q && ['RIDE', 'SHOW', 'RESTAURANT', 'SHOP'].includes(q)) entityFilter.value = q
  void load()
})

function openCreate() {
  modalMode.value = 'create'
  form.value = emptyForm()
  saveError.value = null
  modalOpen.value = true
}

function openEdit(r: MlProfileRow) {
  modalMode.value = 'edit'
  form.value = rowToForm(r)
  saveError.value = null
  modalOpen.value = true
}

function openDuplicate(r: MlProfileRow) {
  modalMode.value = 'duplicate'
  const f = rowToForm(r)
  f.id = ''
  f.profileCode = suggestDuplicateCode(f.profileCode)
  f.profileName = `${f.profileName} (copy)`
  f.activeFlag = true
  form.value = f
  saveError.value = null
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
  saveError.value = null
}

function validateForm(): string | null {
  const f = form.value
  if (!/^[A-Z0-9_]+$/.test(f.profileCode.trim())) return t('mlProfilesAdmin.errCode')
  if (!f.profileName.trim()) return t('mlProfilesAdmin.errName')
  if (!f.entityType.trim()) return t('mlProfilesAdmin.errEntity')
  const scores = [
    f.weatherSensitivityScore,
    f.rainImpactScore,
    f.windImpactScore,
    f.heatImpactScore,
    f.queueElasticityScore,
    f.capacityElasticityScore,
    f.staffDependencyScore,
    f.downtimeRiskScore,
    f.maintenanceCriticality,
  ]
  for (const s of scores) {
    if (s.trim() === '') continue
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0 || n > 1) return t('mlProfilesAdmin.errScoreRange')
  }
  const mq = f.maxQueueTargetMin.trim()
  if (mq !== '' && (!Number.isFinite(Number(mq)) || Number(mq) < 0)) return t('mlProfilesAdmin.errQueueMin')
  const av = f.availabilityTargetPercent.trim()
  if (av !== '') {
    const n = Number(av)
    if (!Number.isFinite(n) || n < 0 || n > 100) return t('mlProfilesAdmin.errAvail')
  }
  const tf = f.targetThroughputFactor.trim()
  if (tf !== '') {
    const n = Number(tf)
    if (!Number.isFinite(n) || n < 0 || n > 1.5) return t('mlProfilesAdmin.errThroughput')
  }
  return null
}

function buildPayload(): MlProfileWriteBody {
  const f = form.value
  return {
    profileCode: f.profileCode.trim().toUpperCase(),
    profileName: f.profileName.trim(),
    entityType: f.entityType.trim(),
    category: f.category.trim() || null,
    activeFlag: f.activeFlag,
    modelType: f.modelType.trim() || 'BASELINE',
    featureSetCode: f.featureSetCode.trim() || 'DEFAULT_V1',
    weatherSensitive: f.weatherSensitive,
    rainSensitive: f.rainSensitive,
    windSensitive: f.windSensitive,
    heatSensitive: f.heatSensitive,
    weatherSensitivityScore: numOrNull(f.weatherSensitivityScore),
    rainImpactScore: numOrNull(f.rainImpactScore),
    windImpactScore: numOrNull(f.windImpactScore),
    heatImpactScore: numOrNull(f.heatImpactScore),
    queueElasticityScore: numOrNull(f.queueElasticityScore),
    capacityElasticityScore: numOrNull(f.capacityElasticityScore),
    staffDependencyScore: numOrNull(f.staffDependencyScore),
    downtimeRiskScore: numOrNull(f.downtimeRiskScore),
    maintenanceCriticality: numOrNull(f.maintenanceCriticality),
    downtimeImpactLevel: f.downtimeImpactLevel.trim() || null,
    maxQueueTargetMin: numOrNull(f.maxQueueTargetMin),
    availabilityTargetPercent: numOrNull(f.availabilityTargetPercent),
    targetThroughputFactor: numOrNull(f.targetThroughputFactor),
    notes: f.notes.trim() || null,
  }
}

function buildPatchPayload(): MlProfilePatchBody {
  const full = buildPayload()
  const { profileCode: _omitCode, ...rest } = full
  return rest
}

async function saveModal() {
  if (!canEdit.value) return
  const err = validateForm()
  if (err) {
    saveError.value = err
    return
  }
  saveLoading.value = true
  saveError.value = null
  try {
    if (modalMode.value === 'edit' && form.value.id) {
      await patchMlProfile(form.value.id, buildPatchPayload())
      push(t('mlProfilesAdmin.saved'), 'success')
    } else {
      await postMlProfile(buildPayload())
      push(t('mlProfilesAdmin.created'), 'success')
    }
    closeModal()
    await load()
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Error'
  } finally {
    saveLoading.value = false
  }
}

async function deactivate(r: MlProfileRow) {
  if (!canEdit.value) return
  if (r.activeFlag === false) return
  // eslint-disable-next-line no-alert
  if (!window.confirm(t('mlProfilesAdmin.confirmDeactivate', { code: r.profileCode }))) return
  saveLoading.value = true
  try {
    await deleteMlProfile(String(r.id))
    push(t('mlProfilesAdmin.deactivated'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    saveLoading.value = false
  }
}

const entityTypes = ['RIDE', 'SHOW', 'RESTAURANT', 'SHOP'] as const
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiMl.back') }}</RouterLink>
    <h1 :class="ui.title">{{ t('aiMl.profilesTitle') }}</h1>
    <p :class="ui.subtitle">{{ t('mlProfilesAdmin.subtitle') }}</p>
    <p v-if="!canEdit" class="rounded-lg border border-amber-700/40 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/90">
      {{ t('mlProfilesAdmin.readOnlyHint') }}
    </p>

    <div :class="ui.card" class="flex flex-wrap items-end gap-3">
      <div class="min-w-[10rem] flex-1">
        <label class="mb-1 block text-xs font-medium text-slate-400" for="mlp-search">{{ t('mlProfilesAdmin.search') }}</label>
        <input
          id="mlp-search"
          v-model="searchInput"
          type="search"
          class="w-full rounded-md border border-slate-600 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100"
          :placeholder="t('mlProfilesAdmin.searchPh')"
        />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-slate-400" for="mlp-et">{{ t('mlProfilesAdmin.filterEntity') }}</label>
        <select id="mlp-et" v-model="entityFilter" class="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white">
          <option value="">{{ t('mlProfilesAdmin.allEntities') }}</option>
          <option v-for="et in entityTypes" :key="et" :value="et">{{ et }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-slate-400" for="mlp-act">{{ t('mlProfilesAdmin.filterActive') }}</label>
        <select id="mlp-act" v-model="activeFilter" class="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white">
          <option value="all">{{ t('mlProfilesAdmin.allActive') }}</option>
          <option value="true">{{ t('mlProfilesAdmin.activeOnly') }}</option>
          <option value="false">{{ t('mlProfilesAdmin.inactiveOnly') }}</option>
        </select>
      </div>
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        :disabled="loading"
        @click="load()"
      >
        {{ t('btn.refresh') }}
      </button>
      <button
        v-if="canEdit"
        type="button"
        class="rounded-md border border-brand-500 px-3 py-1.5 text-sm text-brand-200 hover:bg-brand-950/40"
        @click="openCreate()"
      >
        {{ t('mlProfilesAdmin.create') }}
      </button>
    </div>

    <div :class="ui.card" class="overflow-x-auto">
      <table class="w-full min-w-[960px] text-left text-sm">
        <thead>
          <tr :class="ui.muted">
            <th class="py-2 pr-2">{{ t('aiMl.colActive') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colCode') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colName') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colEntity') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colModel') }}</th>
            <th v-if="canEdit" class="py-2 pr-2 text-right">{{ t('mlProfilesAdmin.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="String(r.id)" class="border-t border-slate-700/50">
            <td class="py-2 pr-2">{{ r.activeFlag === true ? '✓' : '—' }}</td>
            <td class="py-2 pr-2 font-mono text-xs">{{ r.profileCode }}</td>
            <td class="py-2 pr-2">{{ r.profileName }}</td>
            <td class="py-2 pr-2">{{ r.entityType }}</td>
            <td class="py-2 pr-2 font-mono text-xs">{{ r.modelType }}</td>
            <td v-if="canEdit" class="py-2 pr-2 text-right">
              <button type="button" class="mr-2 text-xs text-brand-400 hover:text-brand-300" @click="openEdit(r)">{{ t('mlProfilesAdmin.edit') }}</button>
              <button type="button" class="mr-2 text-xs text-slate-400 hover:text-slate-200" @click="openDuplicate(r)">{{ t('mlProfilesAdmin.duplicate') }}</button>
              <button
                v-if="r.activeFlag === true"
                type="button"
                class="text-xs text-amber-500 hover:text-amber-300"
                :disabled="saveLoading"
                @click="deactivate(r)"
              >
                {{ t('mlProfilesAdmin.deactivate') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && !rows.length" :class="ui.muted" class="mt-2">{{ t('aiMl.empty') }}</p>
    </div>

    <!-- Modal -->
    <div
      v-if="modalOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      @click.self="closeModal()"
    >
      <div
        :class="ui.card"
        class="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-slate-600 p-4 shadow-xl"
        @click.stop
      >
        <div class="mb-3 flex items-start justify-between gap-2">
          <h2 class="text-lg font-semibold text-white">
            {{
              modalMode === 'edit'
                ? t('mlProfilesAdmin.modalEdit')
                : modalMode === 'duplicate'
                  ? t('mlProfilesAdmin.modalDuplicate')
                  : t('mlProfilesAdmin.modalCreate')
            }}
          </h2>
          <button type="button" class="rounded px-2 text-slate-400 hover:text-white" @click="closeModal()">✕</button>
        </div>
        <p v-if="saveError" class="mb-2 rounded border border-rose-700/50 bg-rose-950/30 px-2 py-1 text-xs text-rose-200">{{ saveError }}</p>
        <div class="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 text-sm sm:grid-cols-2">
          <label class="block sm:col-span-2">
            <span class="text-xs text-slate-400">{{ t('aiMl.colCode') }} *</span>
            <input
              v-model="form.profileCode"
              :disabled="modalMode === 'edit'"
              class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white disabled:opacity-60"
            />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-xs text-slate-400">{{ t('aiMl.colName') }} *</span>
            <input v-model="form.profileName" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">{{ t('aiMl.colEntity') }} *</span>
            <select v-model="form.entityType" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white">
              <option v-for="et in entityTypes" :key="et" :value="et">{{ et }}</option>
            </select>
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">{{ t('mlProfilesAdmin.category') }}</span>
            <input v-model="form.category" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="flex items-center gap-2 sm:col-span-2">
            <input v-model="form.activeFlag" type="checkbox" class="rounded border-slate-600" />
            <span class="text-xs text-slate-300">{{ t('aiMl.colActive') }}</span>
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">{{ t('mlProfilesAdmin.modelType') }}</span>
            <input v-model="form.modelType" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">{{ t('mlProfilesAdmin.featureSet') }}</span>
            <input v-model="form.featureSetCode" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label v-for="lbl in ['weatherSensitive', 'rainSensitive', 'windSensitive', 'heatSensitive'] as const" :key="lbl" class="flex items-center gap-2">
            <input v-model="form[lbl]" type="checkbox" class="rounded border-slate-600" />
            <span class="text-xs text-slate-300">{{ lbl }}</span>
          </label>
          <label class="block sm:col-span-2">
            <span class="text-xs text-slate-400">{{ t('mlProfilesAdmin.scoresHint') }}</span>
          </label>
          <label v-for="sk in ['weatherSensitivityScore','rainImpactScore','windImpactScore','heatImpactScore','queueElasticityScore','capacityElasticityScore','staffDependencyScore','downtimeRiskScore','maintenanceCriticality']" :key="sk" class="block">
            <span class="text-[11px] text-slate-500">{{ sk }}</span>
            <input v-model="form[sk as keyof FormState]" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-xs text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">{{ t('mlProfilesAdmin.downtimeImpactLevel') }}</span>
            <input v-model="form.downtimeImpactLevel" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">maxQueueTargetMin</span>
            <input v-model="form.maxQueueTargetMin" type="number" min="0" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">availabilityTargetPercent (0–100)</span>
            <input v-model="form.availabilityTargetPercent" type="number" min="0" max="100" step="0.1" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">targetThroughputFactor (0–1.5)</span>
            <input v-model="form.targetThroughputFactor" type="number" min="0" max="1.5" step="0.01" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-xs text-slate-400">{{ t('mlProfilesAdmin.notes') }}</span>
            <textarea v-model="form.notes" rows="3" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-white" />
          </label>
        </div>
        <div class="mt-4 flex justify-end gap-2 border-t border-slate-700 pt-3">
          <button type="button" class="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300" @click="closeModal()">{{ t('mlProfilesAdmin.cancel') }}</button>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="saveLoading || !canEdit"
            @click="saveModal()"
          >
            {{ saveLoading ? t('mlProfilesAdmin.saving') : t('mlProfilesAdmin.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
