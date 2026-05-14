<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  ApiRequestError,
  getRides,
  listMlParkProfiles,
  listMlRideProfiles,
  postMlParkProfile,
  postMlRideProfile,
  putMlParkProfile,
  putMlRideProfile,
  type MlParkProfileRow,
  type MlRideProfileRow,
} from '@/api/client'
import type { Ride } from '@/types/api'
import { useAuthStore } from '@/stores/auth'
import { useParkContextStore } from '@/stores/parkContext'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { ML_TRAINING_FEATURE_NAMES } from '@/constants/mlTrainingFeatureNames'
import {
  applyRideBehaviorDraftToJsonStrings,
  buildEffectiveForecastRows,
  buildRideBehaviorSummaryLines,
  buildRideRelevanceHints,
  emptyRideBehaviorDraft,
  hydrateRideBehaviorDraft,
  parkWeatherBaseline,
  parseJsonObjectLoose,
  scoreBand,
  type RideBehaviorDraft,
} from '@/utils/mlOperationalProfileBehavior'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const parkCtx = useParkContextStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()
const { formatDateTime } = useRegionalDateTime()

const canEdit = computed(() => auth.hasPermission('ai', 'refresh'))

const featureDisabled = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const parkRows = ref<MlParkProfileRow[]>([])
const rideRows = ref<MlRideProfileRow[]>([])
const rides = ref<Ride[]>([])

const activeTab = ref<'park' | 'ride'>('park')

const drawerOpen = ref(false)
const drawerMode = ref<'create' | 'edit'>('create')
const drawerEntity = ref<'park' | 'ride'>('park')
const saveLoading = ref(false)
const saveError = ref<string | null>(null)

const parkForm = ref({
  id: '' as string,
  profileName: '',
  profileVersion: 'v1',
  enabled: true,
  notes: '',
})
const parkJson = ref({
  crowd: '{}',
  weather: '{}',
  calendar: '{}',
  seasonality: '{}',
  event: '{}',
  visitorMix: '{}',
})

const rideForm = ref({
  id: '' as string,
  rideId: '',
  profileName: '',
  profileVersion: 'v1',
  enabled: true,
  rideType: '',
  notes: '',
})
const rideJson = ref({
  capacity: '{}',
  popularity: '{}',
  queueBehavior: '{}',
  weatherSensitivity: '{}',
  downtimeSensitivity: '{}',
  staffingDependency: '{}',
  throughput: '{}',
})

function emptyWeightsDraft(): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of ML_TRAINING_FEATURE_NAMES) o[k] = ''
  return o
}

const parkWeightsDraft = ref<Record<string, string>>(emptyWeightsDraft())
const rideWeightsDraft = ref<Record<string, string>>(emptyWeightsDraft())

function jsonSummary(obj: Record<string, unknown> | null | undefined, maxLen = 56): string {
  if (obj == null || typeof obj !== 'object') return '—'
  const keys = Object.keys(obj)
  if (keys.length === 0) return '{}'
  const s = JSON.stringify(obj)
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

/** Short preview of manual feature_weights_json for list tables. */
function weightSummary(fw: Record<string, number> | null | undefined, maxLen = 48): string {
  if (fw == null || typeof fw !== 'object') return '—'
  const keys = Object.keys(fw)
  if (keys.length === 0) return '—'
  const parts = keys.slice(0, 3).map((k) => `${k}:${fw[k]}`)
  const s = keys.length > 3 ? `${parts.join(', ')}… (${keys.length})` : parts.join(', ')
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

function parseJsonObject(label: string, raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const tRaw = raw.trim()
  if (tRaw === '') return { ok: true, value: {} }
  try {
    const v = JSON.parse(tRaw) as unknown
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, error: t('aiMl.metadataProfilesErrNotObject', { field: label }) }
    }
    return { ok: true, value: v as Record<string, unknown> }
  } catch {
    return { ok: false, error: t('aiMl.metadataProfilesErrJson', { field: label }) }
  }
}

function parseAllParkJson():
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  const crowd = parseJsonObject('crowdProfileJson', parkJson.value.crowd)
  if (!crowd.ok) return crowd
  const weather = parseJsonObject('weatherProfileJson', parkJson.value.weather)
  if (!weather.ok) return weather
  const calendar = parseJsonObject('calendarProfileJson', parkJson.value.calendar)
  if (!calendar.ok) return calendar
  const seasonality = parseJsonObject('seasonalityProfileJson', parkJson.value.seasonality)
  if (!seasonality.ok) return seasonality
  const event = parseJsonObject('eventProfileJson', parkJson.value.event)
  if (!event.ok) return event
  const visitorMix = parseJsonObject('visitorMixProfileJson', parkJson.value.visitorMix)
  if (!visitorMix.ok) return visitorMix
  return {
    ok: true,
    payload: {
      crowdProfileJson: crowd.value,
      weatherProfileJson: weather.value,
      calendarProfileJson: calendar.value,
      seasonalityProfileJson: seasonality.value,
      eventProfileJson: event.value,
      visitorMixProfileJson: visitorMix.value,
    },
  }
}

function parseAllRideJson():
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  const capacity = parseJsonObject('capacityProfileJson', rideJson.value.capacity)
  if (!capacity.ok) return capacity
  const popularity = parseJsonObject('popularityProfileJson', rideJson.value.popularity)
  if (!popularity.ok) return popularity
  const queueBehavior = parseJsonObject('queueBehaviorProfileJson', rideJson.value.queueBehavior)
  if (!queueBehavior.ok) return queueBehavior
  const weatherSensitivity = parseJsonObject('weatherSensitivityJson', rideJson.value.weatherSensitivity)
  if (!weatherSensitivity.ok) return weatherSensitivity
  const downtimeSensitivity = parseJsonObject('downtimeSensitivityJson', rideJson.value.downtimeSensitivity)
  if (!downtimeSensitivity.ok) return downtimeSensitivity
  const staffingDependency = parseJsonObject('staffingDependencyJson', rideJson.value.staffingDependency)
  if (!staffingDependency.ok) return staffingDependency
  const throughput = parseJsonObject('throughputProfileJson', rideJson.value.throughput)
  if (!throughput.ok) return throughput
  return {
    ok: true,
    payload: {
      capacityProfileJson: capacity.value,
      popularityProfileJson: popularity.value,
      queueBehaviorProfileJson: queueBehavior.value,
      weatherSensitivityJson: weatherSensitivity.value,
      downtimeSensitivityJson: downtimeSensitivity.value,
      staffingDependencyJson: staffingDependency.value,
      throughputProfileJson: throughput.value,
    },
  }
}

function collectFeatureWeightsForApi(
  draft: Record<string, string>
): { ok: true; payload: Record<string, number> } | { ok: false; error: string } {
  const out: Record<string, number> = {}
  for (const k of ML_TRAINING_FEATURE_NAMES) {
    const s = (draft[k] ?? '').trim()
    if (s === '') continue
    const n = Number(s.replace(',', '.'))
    if (!Number.isFinite(n)) {
      return { ok: false, error: t('aiMl.metadataProfilesErrWeightNum', { feature: k }) }
    }
    if (n < 0 || n > 5) {
      return { ok: false, error: t('aiMl.metadataProfilesErrWeightRange', { feature: k }) }
    }
    out[k] = n
  }
  return { ok: true, payload: out }
}

const rideNameById = computed(() => {
  const m = new Map<string, string>()
  for (const r of rides.value) m.set(r.id, r.name)
  return m
})

function rideLabel(id: string): string {
  const n = rideNameById.value.get(id)
  return n ? `${n}` : id
}

function score01Pct(n: number): string {
  return `${Math.round(Math.min(1, Math.max(0, n)) * 100)}%`
}

function bandWord(n: number): string {
  return t(`aiMl.forecastBehavior.bandLabel.${scoreBand(n)}`)
}

type WeatherScoreKey = 'weatherSensitivityScore' | 'rainImpactScore' | 'windImpactScore' | 'heatImpactScore'
type OpsScoreKey =
  | 'staffDependencyScore'
  | 'downtimeRiskScore'
  | 'maintenanceCriticality'
  | 'capacityElasticityScore'

const weatherSliderFields: { k: WeatherScoreKey; label: string }[] = [
  { k: 'weatherSensitivityScore', label: 'scoreOverallWeather' },
  { k: 'rainImpactScore', label: 'scoreRainImpact' },
  { k: 'windImpactScore', label: 'scoreWindImpact' },
  { k: 'heatImpactScore', label: 'scoreHeatImpact' },
]

const opsSliderFields: { k: OpsScoreKey; label: string }[] = [
  { k: 'staffDependencyScore', label: 'scoreStaffDependency' },
  { k: 'downtimeRiskScore', label: 'scoreDowntimeRisk' },
  { k: 'maintenanceCriticality', label: 'scoreMaintenance' },
  { k: 'capacityElasticityScore', label: 'scoreCapacityElasticity' },
]

/** Drawer textarea rows — map `parkJson` / `rideJson` keys to i18n labels. */
const parkDrawerJsonFields = [
  { key: 'crowd' as const, i18n: 'metadataProfilesJsonCrowd' },
  { key: 'weather' as const, i18n: 'metadataProfilesJsonWeather' },
  { key: 'calendar' as const, i18n: 'metadataProfilesJsonCalendar' },
  { key: 'seasonality' as const, i18n: 'metadataProfilesJsonSeasonality' },
  { key: 'event' as const, i18n: 'metadataProfilesJsonEvent' },
  { key: 'visitorMix' as const, i18n: 'metadataProfilesJsonVisitorMix' },
]

const rideDrawerJsonFields = [
  { key: 'capacity' as const, i18n: 'metadataProfilesJsonCapacity' },
  { key: 'popularity' as const, i18n: 'metadataProfilesJsonPopularity' },
  { key: 'queueBehavior' as const, i18n: 'metadataProfilesJsonQueue' },
  { key: 'weatherSensitivity' as const, i18n: 'metadataProfilesJsonWeatherSens' },
  { key: 'downtimeSensitivity' as const, i18n: 'metadataProfilesJsonDowntime' },
  { key: 'staffingDependency' as const, i18n: 'metadataProfilesJsonStaffing' },
  { key: 'throughput' as const, i18n: 'metadataProfilesJsonThroughput' },
]

const parkDrawerJsonFieldsContextA = parkDrawerJsonFields.slice(0, 3)
const parkDrawerJsonFieldsContextB = parkDrawerJsonFields.slice(3)

const filterRideId = ref('')

const drawerInnerTab = ref<
  'park-context' | 'ride-behavior' | 'ride-json' | 'timing' | 'weights'
>('park-context')

const rideOperationalDraft = ref<RideBehaviorDraft>(emptyRideBehaviorDraft())
const selectedParkBaselineId = ref('')

function normalizeDrawerTab() {
  if (drawerEntity.value === 'park') {
    if (drawerInnerTab.value === 'ride-behavior' || drawerInnerTab.value === 'ride-json') {
      drawerInnerTab.value = 'park-context'
    }
  } else {
    if (drawerInnerTab.value === 'park-context') {
      drawerInnerTab.value = 'ride-behavior'
    }
  }
}

function syncRideDraftFromFormJson() {
  rideOperationalDraft.value = hydrateRideBehaviorDraft(
    rideForm.value.rideType.trim(),
    rideJson.value.capacity,
    rideJson.value.weatherSensitivity,
    rideJson.value.queueBehavior,
    rideJson.value.downtimeSensitivity,
    rideJson.value.staffingDependency,
    rideJson.value.throughput
  )
}

const baselineParkProfile = computed(() => {
  const id = selectedParkBaselineId.value
  if (id) return parkRows.value.find((p) => p.id === id) ?? null
  return parkRows.value[0] ?? null
})

const rideFwPreview = computed(() => {
  const o: Record<string, number> = {}
  for (const k of ML_TRAINING_FEATURE_NAMES) {
    const s = (rideWeightsDraft.value[k] ?? '').trim()
    if (!s) continue
    const n = Number(s.replace(',', '.'))
    if (Number.isFinite(n)) o[k] = n
  }
  return Object.keys(o).length ? o : undefined
})

const rideEffectiveConfigRows = computed(() => {
  if (drawerEntity.value !== 'ride' || !drawerOpen.value || !baselineParkProfile.value) return []
  const pw = parkWeatherBaseline(baselineParkProfile.value)
  return buildEffectiveForecastRows(
    pw,
    parseJsonObjectLoose(rideJson.value.weatherSensitivity),
    parseJsonObjectLoose(rideJson.value.queueBehavior),
    parseJsonObjectLoose(rideJson.value.staffingDependency),
    parseJsonObjectLoose(rideJson.value.downtimeSensitivity),
    baselineParkProfile.value.featureWeightsJson,
    rideFwPreview.value,
    (k: string) => t(k)
  )
})

const rideSummaryLines = computed(() => buildRideBehaviorSummaryLines(rideOperationalDraft.value, t))
const rideRelevanceHints = computed(() => buildRideRelevanceHints(rideOperationalDraft.value, t))

watch(drawerInnerTab, (tab, prev) => {
  if (!drawerOpen.value || drawerEntity.value !== 'ride') return
  if (tab === 'ride-behavior' && prev === 'ride-json') syncRideDraftFromFormJson()
})

watch([drawerOpen, drawerEntity], () => {
  if (drawerOpen.value) normalizeDrawerTab()
})

const displayRideRows = computed(() => {
  const f = filterRideId.value.trim()
  if (!f) return rideRows.value
  return rideRows.value.filter((r) => r.rideId === f)
})

async function loadAll() {
  loadError.value = null
  featureDisabled.value = false
  loading.value = true
  try {
    try {
      parkRows.value = await listMlParkProfiles()
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404 && e.code === 'ML_PROFILE_DISABLED') {
        featureDisabled.value = true
        parkRows.value = []
        rideRows.value = []
        return
      }
      throw e
    }
    rideRows.value = await listMlRideProfiles()
    if (!selectedParkBaselineId.value && parkRows.value.length) {
      selectedParkBaselineId.value = parkRows.value[0].id
    }
    if (parkCtx.activeParkId) {
      try {
        rides.value = await getRides()
      } catch {
        rides.value = []
      }
    } else {
      rides.value = []
    }
  } catch (e) {
    parkRows.value = []
    rideRows.value = []
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function syncTabFromRoute() {
  const tab = String(route.query.tab || '').toLowerCase()
  if (tab === 'ride') activeTab.value = 'ride'
  else activeTab.value = 'park'
  const rid = route.query.rideId
  if (typeof rid === 'string' && rid.trim()) {
    activeTab.value = 'ride'
    filterRideId.value = rid.trim()
  }
}

function setTab(tab: 'park' | 'ride') {
  activeTab.value = tab
  const q = { ...route.query, tab } as Record<string, string | string[]>
  if (tab === 'park') delete q.rideId
  router.replace({ query: q }).catch(() => {})
}

watch(
  () => route.query,
  () => syncTabFromRoute(),
  { deep: true }
)

watch(
  () => parkCtx.activeParkId,
  () => {
    loadAll().catch(() => {})
  }
)

onMounted(() => {
  syncTabFromRoute()
  loadAll().catch(() => {})
})

function resetParkForm() {
  parkForm.value = { id: '', profileName: '', profileVersion: 'v1', enabled: true, notes: '' }
  parkJson.value = {
    crowd: '{}',
    weather: '{}',
    calendar: '{}',
    seasonality: '{}',
    event: '{}',
    visitorMix: '{}',
  }
  parkWeightsDraft.value = emptyWeightsDraft()
}

function resetRideForm() {
  rideForm.value = { id: '', rideId: '', profileName: '', profileVersion: 'v1', enabled: true, rideType: '', notes: '' }
  rideJson.value = {
    capacity: '{}',
    popularity: '{}',
    queueBehavior: '{}',
    weatherSensitivity: '{}',
    downtimeSensitivity: '{}',
    staffingDependency: '{}',
    throughput: '{}',
  }
  rideWeightsDraft.value = emptyWeightsDraft()
  rideOperationalDraft.value = emptyRideBehaviorDraft()
}

function openCreatePark() {
  drawerEntity.value = 'park'
  drawerMode.value = 'create'
  drawerInnerTab.value = 'park-context'
  resetParkForm()
  saveError.value = null
  drawerOpen.value = true
}

function openEditPark(row: MlParkProfileRow) {
  drawerEntity.value = 'park'
  drawerMode.value = 'edit'
  drawerInnerTab.value = 'park-context'
  resetParkForm()
  parkForm.value = {
    id: row.id,
    profileName: row.profileName,
    profileVersion: row.profileVersion,
    enabled: row.enabled,
    notes: row.notes ?? '',
  }
  parkJson.value = {
    crowd: JSON.stringify(row.crowdProfileJson ?? {}, null, 2),
    weather: JSON.stringify(row.weatherProfileJson ?? {}, null, 2),
    calendar: JSON.stringify(row.calendarProfileJson ?? {}, null, 2),
    seasonality: JSON.stringify(row.seasonalityProfileJson ?? {}, null, 2),
    event: JSON.stringify(row.eventProfileJson ?? {}, null, 2),
    visitorMix: JSON.stringify(row.visitorMixProfileJson ?? {}, null, 2),
  }
  const fw = row.featureWeightsJson ?? {}
  const wd = emptyWeightsDraft()
  for (const k of ML_TRAINING_FEATURE_NAMES) {
    const v = fw[k]
    if (v != null && Number.isFinite(Number(v))) wd[k] = String(v)
  }
  parkWeightsDraft.value = wd
  saveError.value = null
  drawerOpen.value = true
}

function openCreateRide() {
  drawerEntity.value = 'ride'
  drawerMode.value = 'create'
  drawerInnerTab.value = 'ride-behavior'
  resetRideForm()
  saveError.value = null
  drawerOpen.value = true
  syncRideDraftFromFormJson()
}

function openEditRide(row: MlRideProfileRow) {
  drawerEntity.value = 'ride'
  drawerMode.value = 'edit'
  drawerInnerTab.value = 'ride-behavior'
  resetRideForm()
  rideForm.value = {
    id: row.id,
    rideId: row.rideId,
    profileName: row.profileName,
    profileVersion: row.profileVersion,
    enabled: row.enabled,
    rideType: row.rideType ?? '',
    notes: row.notes ?? '',
  }
  rideJson.value = {
    capacity: JSON.stringify(row.capacityProfileJson ?? {}, null, 2),
    popularity: JSON.stringify(row.popularityProfileJson ?? {}, null, 2),
    queueBehavior: JSON.stringify(row.queueBehaviorProfileJson ?? {}, null, 2),
    weatherSensitivity: JSON.stringify(row.weatherSensitivityJson ?? {}, null, 2),
    downtimeSensitivity: JSON.stringify(row.downtimeSensitivityJson ?? {}, null, 2),
    staffingDependency: JSON.stringify(row.staffingDependencyJson ?? {}, null, 2),
    throughput: JSON.stringify(row.throughputProfileJson ?? {}, null, 2),
  }
  const fw = row.featureWeightsJson ?? {}
  const wd = emptyWeightsDraft()
  for (const k of ML_TRAINING_FEATURE_NAMES) {
    const v = fw[k]
    if (v != null && Number.isFinite(Number(v))) wd[k] = String(v)
  }
  rideWeightsDraft.value = wd
  saveError.value = null
  drawerOpen.value = true
  syncRideDraftFromFormJson()
}

function closeDrawer() {
  drawerOpen.value = false
  saveError.value = null
}

async function savePark() {
  if (!canEdit.value) return
  const name = parkForm.value.profileName.trim()
  if (!name) {
    saveError.value = t('aiMl.metadataProfilesErrName')
    return
  }
  const parsed = parseAllParkJson()
  if (!parsed.ok) {
    saveError.value = parsed.error
    return
  }
  const wcol = collectFeatureWeightsForApi(parkWeightsDraft.value)
  if (!wcol.ok) {
    saveError.value = wcol.error
    return
  }
  saveLoading.value = true
  saveError.value = null
  try {
    const body = {
      profileName: name,
      profileVersion: parkForm.value.profileVersion.trim() || 'v1',
      enabled: parkForm.value.enabled,
      notes: parkForm.value.notes.trim() || null,
      featureWeightsJson: wcol.payload,
      ...parsed.payload,
    }
    if (drawerMode.value === 'edit' && parkForm.value.id) {
      await putMlParkProfile(parkForm.value.id, body)
      push(t('aiMl.metadataProfilesSaved'), 'success')
    } else {
      await postMlParkProfile(body)
      push(t('aiMl.metadataProfilesCreated'), 'success')
    }
    closeDrawer()
    await loadAll()
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saveLoading.value = false
  }
}

async function saveRide() {
  if (!canEdit.value) return
  const name = rideForm.value.profileName.trim()
  if (!name) {
    saveError.value = t('aiMl.metadataProfilesErrName')
    return
  }
  if (drawerMode.value === 'create' && !rideForm.value.rideId.trim()) {
    saveError.value = t('aiMl.metadataProfilesErrRide')
    return
  }
  if (drawerInnerTab.value !== 'ride-json') {
    applyRideBehaviorDraftToJsonStrings(rideOperationalDraft.value, rideJson.value, rideForm.value.rideType.trim())
  }
  const parsed = parseAllRideJson()
  if (!parsed.ok) {
    saveError.value = parsed.error
    return
  }
  const wcol = collectFeatureWeightsForApi(rideWeightsDraft.value)
  if (!wcol.ok) {
    saveError.value = wcol.error
    return
  }
  saveLoading.value = true
  saveError.value = null
  try {
    const body: Record<string, unknown> = {
      profileName: name,
      profileVersion: rideForm.value.profileVersion.trim() || 'v1',
      enabled: rideForm.value.enabled,
      rideType: rideForm.value.rideType.trim() || null,
      notes: rideForm.value.notes.trim() || null,
      featureWeightsJson: wcol.payload,
      ...parsed.payload,
    }
    if (drawerMode.value === 'create') {
      body.rideId = rideForm.value.rideId.trim()
      await postMlRideProfile(body)
      push(t('aiMl.metadataProfilesCreated'), 'success')
    } else if (rideForm.value.id) {
      await putMlRideProfile(rideForm.value.id, body)
      push(t('aiMl.metadataProfilesSaved'), 'success')
    }
    closeDrawer()
    await loadAll()
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saveLoading.value = false
  }
}

function clearRideFilter() {
  filterRideId.value = ''
  const q = { ...route.query }
  delete q.rideId
  router.replace({ query: q }).catch(() => {})
}
</script>

<template>
  <div class="min-h-screen px-4 py-6 lg:px-8">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">
      ← {{ t('aiMl.back') }}
    </RouterLink>

    <header class="mt-4">
      <h1 :class="ui.title">{{ t('aiMl.metadataProfilesTitle') }}</h1>
      <p :class="ui.subtitle">{{ t('aiMl.metadataProfilesSubtitle') }}</p>
      <p v-if="parkCtx.activePark?.name" class="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {{ t('aiMl.monitorActivePark', { name: parkCtx.activePark.name }) }}
      </p>
    </header>

    <div v-if="!parkCtx.activeParkId" :class="ui.card" class="mt-6 text-amber-600 dark:text-amber-500">
      {{ t('aiMl.needPark') }}
    </div>

    <div v-else-if="featureDisabled" :class="ui.card" class="mt-6 p-4 text-slate-600 dark:text-slate-300">
      {{ t('aiMl.metadataProfilesDisabled') }}
    </div>

    <template v-else>
      <p v-if="!canEdit" class="mt-4 rounded-lg border border-amber-700/40 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/90 dark:border-amber-600/40">
        {{ t('aiMl.metadataProfilesReadOnly') }}
      </p>

      <div class="mt-6 flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-700">
        <button
          type="button"
          class="border-b-2 px-3 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'park'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="setTab('park')"
        >
          {{ t('aiMl.metadataProfilesTabPark') }}
        </button>
        <button
          type="button"
          class="border-b-2 px-3 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'ride'
              ? 'border-brand-500 text-brand-600 dark:text-brand-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="setTab('ride')"
        >
          {{ t('aiMl.metadataProfilesTabRide') }}
        </button>
        <div class="flex-1" />
        <button
          type="button"
          class="rounded-lg bg-slate-200 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          :disabled="loading"
          @click="loadAll()"
        >
          {{ t('aiMl.featureMonitorRefresh') }}
        </button>
        <button
          v-if="canEdit && activeTab === 'park'"
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          @click="openCreatePark()"
        >
          {{ t('aiMl.metadataProfilesAddPark') }}
        </button>
        <button
          v-if="canEdit && activeTab === 'ride'"
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          :disabled="!rides.length"
          @click="openCreateRide()"
        >
          {{ t('aiMl.metadataProfilesAddRide') }}
        </button>
      </div>

      <p v-if="loadError" class="mt-4 text-sm text-rose-600 dark:text-rose-400">{{ loadError }}</p>

      <!-- Park table -->
      <div v-show="activeTab === 'park'" :class="ui.card" class="mt-4 overflow-x-auto">
        <table class="min-w-[960px] w-full border-collapse text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700">
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColName') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColVersion') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColEnabled') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColCrowd') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColWeather') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColCalendar') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColSeasonality') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColWeights') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColUpdated') }}</th>
              <th v-if="canEdit" class="px-3 py-2 text-right">{{ t('aiMl.metadataProfilesColActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td :colspan="canEdit ? 10 : 9" class="px-3 py-8 text-center text-slate-500">{{ t('aiMl.featureMonitorLoading') }}</td>
            </tr>
            <tr v-else-if="!parkRows.length">
              <td :colspan="canEdit ? 10 : 9" class="px-3 py-8 text-center text-slate-500">
                {{ t('aiMl.metadataProfilesEmptyPark') }}
              </td>
            </tr>
            <template v-else>
              <tr v-for="r in parkRows" :key="r.id" class="border-b border-slate-100 dark:border-slate-800">
                <td class="px-3 py-2">{{ r.profileName }}</td>
                <td class="px-3 py-2 font-mono text-xs">{{ r.profileVersion }}</td>
                <td class="px-3 py-2">{{ r.enabled ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}</td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.crowdProfileJson)">
                  {{ jsonSummary(r.crowdProfileJson) }}
                </td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.weatherProfileJson)">
                  {{ jsonSummary(r.weatherProfileJson) }}
                </td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.calendarProfileJson)">
                  {{ jsonSummary(r.calendarProfileJson) }}
                </td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.seasonalityProfileJson)">
                  {{ jsonSummary(r.seasonalityProfileJson) }}
                </td>
                <td
                  class="max-w-[12rem] truncate px-3 py-2 font-mono text-[11px]"
                  :title="weightSummary(r.featureWeightsJson)"
                >
                  {{ weightSummary(r.featureWeightsJson) }}
                </td>
                <td class="px-3 py-2 whitespace-nowrap">{{ formatDateTime(r.updatedAt) }}</td>
                <td v-if="canEdit" class="px-3 py-2 text-right">
                  <button type="button" class="text-brand-500 hover:text-brand-400" @click="openEditPark(r)">
                    {{ t('aiMl.metadataProfilesEdit') }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Ride table -->
      <div v-show="activeTab === 'ride'" :class="ui.card" class="mt-4 overflow-x-auto">
        <div v-if="filterRideId" class="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
          <span class="text-slate-500">{{ t('aiMl.metadataProfilesFilterRide', { id: filterRideId }) }}</span>
          <button type="button" class="text-brand-500 hover:underline" @click="clearRideFilter()">
            {{ t('aiMl.metadataProfilesClearRideFilter') }}
          </button>
        </div>
        <table class="min-w-[1100px] w-full border-collapse text-left text-sm">
          <thead>
            <tr class="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700">
              <th class="px-3 py-2">{{ t('aiMl.featureMonitorColRide') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColName') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColVersion') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColEnabled') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColRideType') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColCapacity') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColPopularity') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColWeatherSens') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColStaffing') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColWeights') }}</th>
              <th class="px-3 py-2">{{ t('aiMl.metadataProfilesColUpdated') }}</th>
              <th v-if="canEdit" class="px-3 py-2 text-right">{{ t('aiMl.metadataProfilesColActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td :colspan="canEdit ? 12 : 11" class="px-3 py-8 text-center text-slate-500">{{ t('aiMl.featureMonitorLoading') }}</td>
            </tr>
            <tr v-else-if="!displayRideRows.length">
              <td :colspan="canEdit ? 12 : 11" class="px-3 py-8 text-center text-slate-500">
                {{ t('aiMl.metadataProfilesEmptyRide') }}
              </td>
            </tr>
            <template v-else>
              <tr v-for="r in displayRideRows" :key="r.id" class="border-b border-slate-100 dark:border-slate-800">
                <td class="px-3 py-2">
                  <div class="font-medium">{{ rideLabel(r.rideId) }}</div>
                  <div class="font-mono text-[11px] text-slate-500">{{ r.rideId }}</div>
                </td>
                <td class="px-3 py-2">{{ r.profileName }}</td>
                <td class="px-3 py-2 font-mono text-xs">{{ r.profileVersion }}</td>
                <td class="px-3 py-2">{{ r.enabled ? t('aiMl.featureMonitorYes') : t('aiMl.featureMonitorNo') }}</td>
                <td class="px-3 py-2">{{ r.rideType || '—' }}</td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.capacityProfileJson)">
                  {{ jsonSummary(r.capacityProfileJson) }}
                </td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.popularityProfileJson)">
                  {{ jsonSummary(r.popularityProfileJson) }}
                </td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.weatherSensitivityJson)">
                  {{ jsonSummary(r.weatherSensitivityJson) }}
                </td>
                <td class="max-w-[10rem] truncate px-3 py-2 font-mono text-[11px]" :title="jsonSummary(r.staffingDependencyJson)">
                  {{ jsonSummary(r.staffingDependencyJson) }}
                </td>
                <td
                  class="max-w-[12rem] truncate px-3 py-2 font-mono text-[11px]"
                  :title="weightSummary(r.featureWeightsJson)"
                >
                  {{ weightSummary(r.featureWeightsJson) }}
                </td>
                <td class="px-3 py-2 whitespace-nowrap">{{ formatDateTime(r.updatedAt) }}</td>
                <td v-if="canEdit" class="px-3 py-2 text-right">
                  <button type="button" class="text-brand-500 hover:text-brand-400" @click="openEditRide(r)">
                    {{ t('aiMl.metadataProfilesEdit') }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-[1px]"
        @click.self="closeDrawer"
      >
        <div
          class="flex h-full w-full max-w-4xl flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
          @click.stop
        >
          <div class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div class="text-sm font-semibold text-white">
              {{
                drawerEntity === 'park'
                  ? drawerMode === 'edit'
                    ? t('aiMl.metadataProfilesDrawerParkEdit')
                    : t('aiMl.metadataProfilesDrawerParkCreate')
                  : drawerMode === 'edit'
                    ? t('aiMl.metadataProfilesDrawerRideEdit')
                    : t('aiMl.metadataProfilesDrawerRideCreate')
              }}
            </div>
            <button type="button" class="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-900" @click="closeDrawer">
              {{ t('aiMl.featureMonitorClose') }}
            </button>
          </div>
          <div class="flex-1 overflow-y-auto px-4 py-3 text-sm text-slate-300">
            <p v-if="saveError" class="mb-3 rounded border border-rose-700/50 bg-rose-950/30 px-2 py-2 text-xs text-rose-200">
              {{ saveError }}
            </p>

            <!-- Park -->
            <template v-if="drawerEntity === 'park'">
              <div class="mb-4 space-y-3 rounded-xl border border-slate-800 bg-slate-900/30 p-3">
                <label class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesColName') }} *</span>
                  <input
                    v-model="parkForm.profileName"
                    class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-white"
                  />
                </label>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="block">
                    <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesColVersion') }}</span>
                    <input
                      v-model="parkForm.profileVersion"
                      class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-sm text-white"
                    />
                  </label>
                  <label class="flex items-center gap-2 pt-6">
                    <input v-model="parkForm.enabled" type="checkbox" class="rounded border-slate-600" />
                    <span class="text-xs">{{ t('aiMl.metadataProfilesColEnabled') }}</span>
                  </label>
                </div>
              </div>

              <div class="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'park-context'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'park-context'"
                >
                  {{ t('aiMl.forecastBehavior.tabParkContext') }}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'timing'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'timing'"
                >
                  {{ t('aiMl.forecastBehavior.tabTiming') }}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'weights'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'weights'"
                >
                  {{ t('aiMl.forecastBehavior.tabWeights') }}
                </button>
              </div>

              <div v-show="drawerInnerTab === 'park-context'" class="space-y-4">
                <p class="text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.parkContextIntro') }}</p>
                <div class="grid gap-3 lg:grid-cols-2">
                  <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {{ t('aiMl.forecastBehavior.parkCardVisitors') }}
                    </h4>
                    <label v-for="row in parkDrawerJsonFieldsContextA" :key="row.key" class="mt-3 block first:mt-2">
                      <span class="text-xs text-slate-400">{{ t(`aiMl.${row.i18n}`) }} (JSON)</span>
                      <textarea
                        v-model="parkJson[row.key]"
                        rows="4"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-brand-100"
                      />
                    </label>
                  </div>
                  <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {{ t('aiMl.forecastBehavior.parkCardRhythm') }}
                    </h4>
                    <label v-for="row in parkDrawerJsonFieldsContextB" :key="row.key" class="mt-3 block first:mt-2">
                      <span class="text-xs text-slate-400">{{ t(`aiMl.${row.i18n}`) }} (JSON)</span>
                      <textarea
                        v-model="parkJson[row.key]"
                        rows="4"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-brand-100"
                      />
                    </label>
                  </div>
                </div>
                <label class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesNotes') }}</span>
                  <textarea v-model="parkForm.notes" rows="2" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              </div>

              <div
                v-show="drawerInnerTab === 'timing'"
                class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/25 p-4"
              >
                <h4 class="text-sm font-semibold text-white">{{ t('aiMl.forecastBehavior.timingHeadline') }}</h4>
                <p class="text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.timingNote') }}</p>
                <dl class="space-y-2 text-xs">
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingSnapshotInterval') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValSnapshot') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingHorizons') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValHorizons') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingAccuracyWindow') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValAccuracy') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingRetention') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValRetention') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingForecastEnabled') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValForecastEnabled') }}</dd>
                  </div>
                </dl>
              </div>

              <div v-show="drawerInnerTab === 'weights'" class="space-y-3">
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <div class="mb-2 text-xs font-medium text-slate-300">{{ t('aiMl.metadataProfilesFeatureWeightsSection') }}</div>
                  <p class="mb-2 text-[11px] text-slate-500">{{ t('aiMl.metadataProfilesWeightHint') }}</p>
                  <div class="max-h-64 space-y-1 overflow-y-auto">
                    <div v-for="fn in ML_TRAINING_FEATURE_NAMES" :key="fn" class="flex items-center gap-2 text-[11px]">
                      <span class="w-[11rem] shrink-0 font-mono text-brand-200">{{ fn }}</span>
                      <input
                        v-model="parkWeightsDraft[fn]"
                        type="text"
                        inputmode="decimal"
                        class="w-20 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white"
                        :placeholder="t('aiMl.metadataProfilesWeightPlaceholder')"
                      />
                    </div>
                  </div>
                </div>
                <label class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesNotes') }}</span>
                  <textarea v-model="parkForm.notes" rows="2" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              </div>
            </template>

            <!-- Ride -->
            <template v-else>
              <div class="mb-4 grow space-y-3 rounded-xl border border-slate-800 bg-slate-900/30 p-3">
                <label v-if="drawerMode === 'create'" class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.featureMonitorColRide') }} *</span>
                  <select
                    v-model="rideForm.rideId"
                    class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">{{ t('aiMl.metadataProfilesPickRide') }}</option>
                    <option v-for="rd in rides" :key="rd.id" :value="rd.id">{{ rd.name }}</option>
                  </select>
                </label>
                <p v-else class="text-xs text-slate-500">
                  {{ rideLabel(rideForm.rideId) }}
                  <span class="ml-1 font-mono text-[11px] text-slate-600">{{ rideForm.rideId }}</span>
                </p>
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="block sm:col-span-2">
                    <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesColName') }} *</span>
                    <input
                      v-model="rideForm.profileName"
                      class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-white"
                    />
                  </label>
                  <label class="block">
                    <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesColVersion') }}</span>
                    <input
                      v-model="rideForm.profileVersion"
                      class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-sm text-white"
                    />
                  </label>
                  <label class="flex items-center gap-2 pt-6">
                    <input v-model="rideForm.enabled" type="checkbox" class="rounded border-slate-600" />
                    <span class="text-xs">{{ t('aiMl.metadataProfilesColEnabled') }}</span>
                  </label>
                </div>
              </div>

              <div class="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'ride-behavior'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'ride-behavior'"
                >
                  {{ t('aiMl.forecastBehavior.tabBehavior') }}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'ride-json'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'ride-json'"
                >
                  {{ t('aiMl.forecastBehavior.tabAdvanced') }}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'timing'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'timing'"
                >
                  {{ t('aiMl.forecastBehavior.tabTiming') }}
                </button>
                <button
                  type="button"
                  class="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  :class="
                    drawerInnerTab === 'weights'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'
                  "
                  @click="drawerInnerTab = 'weights'"
                >
                  {{ t('aiMl.forecastBehavior.tabWeights') }}
                </button>
              </div>

              <!-- Operational behavior -->
              <div v-show="drawerInnerTab === 'ride-behavior'" class="space-y-4">
                <div v-if="parkRows.length" class="rounded-lg border border-slate-800 bg-slate-900/20 p-3">
                  <label class="block text-xs text-slate-400">
                    {{ t('aiMl.forecastBehavior.effectiveBaselineLabel') }}
                    <select
                      v-model="selectedParkBaselineId"
                      class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                    >
                      <option v-for="p in parkRows" :key="p.id" :value="p.id">{{ p.profileName }} · {{ p.profileVersion }}</option>
                    </select>
                  </label>
                </div>
                <p v-else class="text-[11px] text-amber-200/80">{{ t('aiMl.forecastBehavior.noParkBaseline') }}</p>

                <!-- A. Ride characteristics -->
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ t('aiMl.forecastBehavior.sectionRideCharacteristics') }}
                  </h4>
                  <p class="mt-1 text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.sectionRideCharacteristicsHint') }}</p>
                  <div class="mt-3 grid gap-3 sm:grid-cols-2">
                    <label class="block sm:col-span-2">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelEntityType') }}</span>
                      <input
                        v-model="rideForm.rideType"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                    <label class="block">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelCategory') }}</span>
                      <input
                        v-model="rideOperationalDraft.category"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                    <label class="block">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelModelType') }}</span>
                      <input
                        v-model="rideOperationalDraft.modelType"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                    <label class="block sm:col-span-2">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelFeatureSetCode') }}</span>
                      <input
                        v-model="rideOperationalDraft.featureSetCode"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-sm text-white"
                      />
                    </label>
                        <label class="block">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelEnvironment') }}</span>
                      <select
                        v-model="rideOperationalDraft.environment"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      >
                        <option value="">{{ t('aiMl.forecastBehavior.optEnvUnset') }}</option>
                        <option value="indoor">{{ t('aiMl.forecastBehavior.optEnvIndoor') }}</option>
                        <option value="outdoor">{{ t('aiMl.forecastBehavior.optEnvOutdoor') }}</option>
                        <option value="mixed">{{ t('aiMl.forecastBehavior.optEnvMixed') }}</option>
                      </select>
                    </label>
                    <label class="block">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelExperience') }}</span>
                      <select
                        v-model="rideOperationalDraft.experienceClass"
                        class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                      >
                        <option value="">{{ t('aiMl.forecastBehavior.optExUnset') }}</option>
                        <option value="family">{{ t('aiMl.forecastBehavior.optExFamily') }}</option>
                        <option value="thrill">{{ t('aiMl.forecastBehavior.optExThrill') }}</option>
                        <option value="water">{{ t('aiMl.forecastBehavior.optExWater') }}</option>
                        <option value="transport">{{ t('aiMl.forecastBehavior.optExTransport') }}</option>
                        <option value="other">{{ t('aiMl.forecastBehavior.optExOther') }}</option>
                      </select>
                    </label>
                  </div>
                </div>

                <!-- B. Weather -->
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ t('aiMl.forecastBehavior.sectionWeather') }}
                  </h4>
                  <p class="mt-1 text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.sectionWeatherHint') }}</p>
                  <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                    <label class="flex items-center gap-2 text-xs">
                      <input v-model="rideOperationalDraft.weatherSensitive" type="checkbox" class="rounded border-slate-600" />
                      {{ t('aiMl.forecastBehavior.flagWeatherSensitive') }}
                    </label>
                    <label class="flex items-center gap-2 text-xs">
                      <input v-model="rideOperationalDraft.rainSensitive" type="checkbox" class="rounded border-slate-600" />
                      {{ t('aiMl.forecastBehavior.flagRainSensitive') }}
                    </label>
                    <label class="flex items-center gap-2 text-xs">
                      <input v-model="rideOperationalDraft.windSensitive" type="checkbox" class="rounded border-slate-600" />
                      {{ t('aiMl.forecastBehavior.flagWindSensitive') }}
                    </label>
                    <label class="flex items-center gap-2 text-xs">
                      <input v-model="rideOperationalDraft.heatSensitive" type="checkbox" class="rounded border-slate-600" />
                      {{ t('aiMl.forecastBehavior.flagHeatSensitive') }}
                    </label>
                  </div>
                  <div class="mt-4 grid gap-4 sm:grid-cols-2">
                    <div
                      v-for="wx in weatherSliderFields"
                      :key="wx.k"
                      class="rounded-lg border border-slate-800/80 bg-slate-950/40 p-2"
                    >
                      <div class="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{{ t(`aiMl.forecastBehavior.${wx.label}`) }}</span>
                        <span class="tabular-nums text-brand-300">{{ score01Pct(rideOperationalDraft[wx.k]) }}</span>
                      </div>
                      <div class="mt-1 flex items-center justify-between text-[10px] text-slate-600">
                        <span>{{ t('aiMl.forecastBehavior.scaleLowHigh') }}</span>
                        <span class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{{ bandWord(rideOperationalDraft[wx.k]) }}</span>
                      </div>
                      <input
                        v-model.number="rideOperationalDraft[wx.k]"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        class="mt-1 w-full accent-brand-500"
                      />
                      <div class="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div
                          class="h-1.5 rounded bg-brand-500 transition-all"
                          :style="{ width: score01Pct(rideOperationalDraft[wx.k]) }"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- C. Queue -->
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ t('aiMl.forecastBehavior.sectionQueue') }}
                  </h4>
                  <p class="mt-1 text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.sectionQueueHint') }}</p>
                  <div class="mt-3 space-y-3">
                    <div class="rounded-lg border border-slate-800/80 bg-slate-950/40 p-2">
                      <div class="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{{ t('aiMl.forecastBehavior.scoreQueueElasticity') }}</span>
                        <span class="tabular-nums text-brand-300">{{ score01Pct(rideOperationalDraft.queueElasticityScore) }}</span>
                      </div>
                      <div class="mt-1 flex items-center justify-between text-[10px] text-slate-600">
                        <span>{{ t('aiMl.forecastBehavior.scaleLowHigh') }}</span>
                        <span class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{{ bandWord(rideOperationalDraft.queueElasticityScore) }}</span>
                      </div>
                      <input
                        v-model.number="rideOperationalDraft.queueElasticityScore"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        class="mt-1 w-full accent-brand-500"
                      />
                      <div class="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div
                          class="h-1.5 rounded bg-brand-500 transition-all"
                          :style="{ width: score01Pct(rideOperationalDraft.queueElasticityScore) }"
                        />
                      </div>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <label class="block">
                        <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelMaxQueueTargetMin') }}</span>
                        <input
                          v-model.number="rideOperationalDraft.maxQueueTargetMin"
                          type="number"
                          min="0"
                          step="1"
                          class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label class="block">
                        <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelTargetThroughputFactor') }}</span>
                        <input
                          v-model.number="rideOperationalDraft.targetThroughputFactor"
                          type="number"
                          min="0"
                          step="0.05"
                          class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <!-- D. Ops dependency -->
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ t('aiMl.forecastBehavior.sectionOps') }}
                  </h4>
                  <p class="mt-1 text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.sectionOpsHint') }}</p>
                  <div class="mt-4 grid gap-4 sm:grid-cols-2">
                    <div
                      v-for="op in opsSliderFields"
                      :key="op.k"
                      class="rounded-lg border border-slate-800/80 bg-slate-950/40 p-2"
                    >
                      <div class="flex items-center justify-between text-[11px] text-slate-400">
                        <span>{{ t(`aiMl.forecastBehavior.${op.label}`) }}</span>
                        <span class="tabular-nums text-brand-300">{{ score01Pct(rideOperationalDraft[op.k]) }}</span>
                      </div>
                      <div class="mt-1 flex items-center justify-between text-[10px] text-slate-600">
                        <span>{{ t('aiMl.forecastBehavior.scaleLowHigh') }}</span>
                        <span class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{{ bandWord(rideOperationalDraft[op.k]) }}</span>
                      </div>
                      <input
                        v-model.number="rideOperationalDraft[op.k]"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        class="mt-1 w-full accent-brand-500"
                      />
                      <div class="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div
                          class="h-1.5 rounded bg-brand-500 transition-all"
                          :style="{ width: score01Pct(rideOperationalDraft[op.k]) }"
                        />
                      </div>
                    </div>
                    <label class="block sm:col-span-2">
                      <span class="text-xs text-slate-400">{{ t('aiMl.forecastBehavior.labelAvailabilityTarget') }}</span>
                      <div class="mt-1 flex items-center gap-3">
                        <input
                          v-model.number="rideOperationalDraft.availabilityTargetPercent"
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          class="h-2 flex-1 accent-brand-500"
                        />
                        <span class="w-10 text-right text-sm font-medium text-brand-300 tabular-nums">{{ Math.round(rideOperationalDraft.availabilityTargetPercent) }}%</span>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- E. Explainability -->
                <div class="grid gap-3 lg:grid-cols-2">
                  <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {{ t('aiMl.forecastBehavior.sectionExplain') }}
                    </h4>
                    <p class="mt-1 text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.sectionExplainHint') }}</p>
                    <p class="mt-2 text-xs text-slate-200">{{ t('aiMl.forecastBehavior.sectionExplainIntro') }}</p>
                    <ul class="mt-2 list-inside list-disc space-y-1 text-[11px] text-slate-400">
                      <li v-for="(ln, i) in rideSummaryLines" :key="i">{{ ln }}</li>
                    </ul>
                  </div>
                  <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {{ t('aiMl.forecastBehavior.sectionRelevance') }}
                    </h4>
                    <ul v-if="rideRelevanceHints.length" class="mt-2 space-y-2 text-[11px] text-amber-100/90">
                      <li v-for="(h, i) in rideRelevanceHints" :key="i" class="flex gap-2">
                        <span class="text-amber-500">●</span>
                        <span>{{ h }}</span>
                      </li>
                    </ul>
                    <p v-else class="mt-2 text-[11px] text-slate-600">{{ t('aiMl.forecastBehavior.relevanceEmpty') }}</p>
                  </div>
                </div>

                <!-- Effective table -->
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <h4 class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {{ t('aiMl.forecastBehavior.effectiveTitle') }}
                  </h4>
                  <p class="mt-1 text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.effectiveIntro') }}</p>
                  <div v-if="rideEffectiveConfigRows.length" class="mt-3 overflow-x-auto rounded-lg border border-slate-800">
                    <table class="w-full min-w-[520px] border-collapse text-left text-[11px]">
                      <thead>
                        <tr class="border-b border-slate-800 text-slate-500">
                          <th class="px-2 py-2 font-medium">{{ t('aiMl.forecastBehavior.effectiveColSetting') }}</th>
                          <th class="px-2 py-2 font-medium">{{ t('aiMl.forecastBehavior.effectiveColPark') }}</th>
                          <th class="px-2 py-2 font-medium">{{ t('aiMl.forecastBehavior.effectiveColRide') }}</th>
                          <th class="px-2 py-2 font-medium">{{ t('aiMl.forecastBehavior.effectiveColEffective') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="er in rideEffectiveConfigRows" :key="er.key" class="border-b border-slate-800/80">
                          <td class="px-2 py-2 font-medium text-slate-200">{{ er.key }}</td>
                          <td class="px-2 py-2 text-slate-400">{{ er.park ?? '—' }}</td>
                          <td class="px-2 py-2 text-slate-400">{{ er.ride ?? '—' }}</td>
                          <td class="px-2 py-2 text-brand-200">{{ er.effective }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <label class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesNotes') }}</span>
                  <textarea v-model="rideForm.notes" rows="2" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              </div>

              <!-- Advanced JSON -->
              <div v-show="drawerInnerTab === 'ride-json'" class="space-y-3">
                <p class="text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.advancedJsonHint') }}</p>
                <label v-for="row in rideDrawerJsonFields" :key="row.key" class="block">
                  <span class="text-xs text-slate-400">{{ t(`aiMl.${row.i18n}`) }} (JSON)</span>
                  <textarea
                    v-model="rideJson[row.key]"
                    rows="3"
                    class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-brand-100"
                  />
                </label>
                <label class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesNotes') }}</span>
                  <textarea v-model="rideForm.notes" rows="2" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              </div>

              <!-- Timing -->
              <div
                v-show="drawerInnerTab === 'timing'"
                class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/25 p-4"
              >
                <h4 class="text-sm font-semibold text-white">{{ t('aiMl.forecastBehavior.timingHeadline') }}</h4>
                <p class="text-[11px] text-slate-500">{{ t('aiMl.forecastBehavior.timingNote') }}</p>
                <dl class="space-y-2 text-xs">
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingSnapshotInterval') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValSnapshot') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingHorizons') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValHorizons') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingAccuracyWindow') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValAccuracy') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4 border-b border-slate-800 pb-2">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingRetention') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValRetention') }}</dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt class="text-slate-500">{{ t('aiMl.forecastBehavior.timingForecastEnabled') }}</dt>
                    <dd class="text-right text-slate-200">{{ t('aiMl.forecastBehavior.timingValForecastEnabled') }}</dd>
                  </div>
                </dl>
              </div>

              <!-- Weights -->
              <div v-show="drawerInnerTab === 'weights'" class="space-y-3">
                <div class="rounded-xl border border-slate-800 bg-slate-900/25 p-3">
                  <div class="mb-2 text-xs font-medium text-slate-300">{{ t('aiMl.metadataProfilesFeatureWeightsSection') }}</div>
                  <p class="mb-2 text-[11px] text-slate-500">{{ t('aiMl.metadataProfilesWeightHintRide') }}</p>
                  <div class="max-h-64 space-y-1 overflow-y-auto">
                    <div v-for="fn in ML_TRAINING_FEATURE_NAMES" :key="fn" class="flex items-center gap-2 text-[11px]">
                      <span class="w-[11rem] shrink-0 font-mono text-brand-200">{{ fn }}</span>
                      <input
                        v-model="rideWeightsDraft[fn]"
                        type="text"
                        inputmode="decimal"
                        class="w-20 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white"
                        :placeholder="t('aiMl.metadataProfilesWeightPlaceholder')"
                      />
                    </div>
                  </div>
                </div>
                <label class="block">
                  <span class="text-xs text-slate-400">{{ t('aiMl.metadataProfilesNotes') }}</span>
                  <textarea v-model="rideForm.notes" rows="2" class="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-white" />
                </label>
              </div>
            </template>
          </div>
          <div class="border-t border-slate-800 px-4 py-3">
            <button
              v-if="drawerEntity === 'park'"
              type="button"
              class="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              :disabled="saveLoading || !canEdit"
              @click="savePark"
            >
              {{ saveLoading ? t('aiMl.metadataProfilesSaving') : t('aiMl.metadataProfilesSave') }}
            </button>
            <button
              v-else
              type="button"
              class="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              :disabled="saveLoading || !canEdit"
              @click="saveRide"
            >
              {{ saveLoading ? t('aiMl.metadataProfilesSaving') : t('aiMl.metadataProfilesSave') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
