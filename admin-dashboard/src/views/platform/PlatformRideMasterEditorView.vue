<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getPlatformAsset, postPlatformRideEnrichTemplate, putPlatformRideMaster } from '@/api/client'
import type { PlatformAsset } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import SignalsCapabilitiesPanel from '@/components/masterdata/SignalsCapabilitiesPanel.vue'

const route = useRoute()
const { push } = useToast()
const auth = useAuthStore()

const assetId = computed(() => route.params.assetId as string)
const asset = ref<PlatformAsset | null>(null)
const busy = ref(true)
const saving = ref(false)

const form = ref({
  capacityPph: '' as string | number,
  theoreticalCapacityPph: '' as string | number,
  dispatchIntervalSec: '' as string | number,
  cycleTimeSec: '' as string | number,
  plannedCycleTimeSec: '' as string | number,
  opcReferenceCycleTimeSec: '' as string | number,
  maxQueueGuests: '' as string | number,
  seatsPerCycle: '' as string | number,
  trainsCount: '' as string | number,
  rideCategory: '',
  minStaff: '' as string | number,
  normalStaff: '' as string | number,
  peakStaff: '' as string | number,
  weatherSensitive: false,
  rainSensitive: false,
  virtualLineEnabled: false,
  windLimitKmh: '' as string | number,
  minHeightCm: '' as string | number,
  maxHeightCm: '' as string | number,
  maxSpeedKmh: '' as string | number,
  structureHeightM: '' as string | number,
  trackLengthM: '' as string | number,
  thrillLevel: '' as string | number,
  manufacturer: '',
  buildYear: '' as string | number,
  plcType: '',
  maintenanceClass: '',
  targetAvailabilityPct: '' as string | number,
  targetWaitTimeMin: '' as string | number,
  targetUtilizationPct: '' as string | number,
  targetOeePct: '' as string | number,
  revenuePriority: '',
})

const canUpdate = computed(() => auth.hasPermission('rides', 'update'))

function num(v: string | number) {
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function loadFormFromAsset(a: PlatformAsset) {
  const rm = (a as { rideMaster?: Record<string, unknown> }).rideMaster || {}
  const at = (a as { assetTarget?: Record<string, unknown> }).assetTarget || {}
  form.value = {
    capacityPph: rm.capacityPph != null ? String(rm.capacityPph) : '',
    theoreticalCapacityPph: rm.theoreticalCapacityPph != null ? String(rm.theoreticalCapacityPph) : '',
    dispatchIntervalSec: rm.dispatchIntervalSec != null ? String(rm.dispatchIntervalSec) : '',
    cycleTimeSec: rm.cycleTimeSec != null ? String(rm.cycleTimeSec) : '',
    plannedCycleTimeSec: rm.plannedCycleTimeSec != null ? String(rm.plannedCycleTimeSec) : '',
    opcReferenceCycleTimeSec: rm.opcReferenceCycleTimeSec != null ? String(rm.opcReferenceCycleTimeSec) : '',
    maxQueueGuests: rm.maxQueueGuests != null ? String(rm.maxQueueGuests) : '',
    seatsPerCycle: rm.seatsPerCycle != null ? String(rm.seatsPerCycle) : '',
    trainsCount: rm.trainsCount != null ? String(rm.trainsCount) : '',
    rideCategory: String(rm.rideCategory || ''),
    minStaff: rm.minStaff != null ? String(rm.minStaff) : '',
    normalStaff: rm.normalStaff != null ? String(rm.normalStaff) : '',
    peakStaff: rm.peakStaff != null ? String(rm.peakStaff) : '',
    weatherSensitive: Boolean(rm.weatherSensitive),
    rainSensitive: Boolean(rm.rainSensitive),
    virtualLineEnabled: Boolean(rm.virtualLineEnabled),
    windLimitKmh: rm.windLimitKmh != null ? String(rm.windLimitKmh) : '',
    minHeightCm: rm.minHeightCm != null ? String(rm.minHeightCm) : '',
    maxHeightCm: rm.maxHeightCm != null ? String(rm.maxHeightCm) : '',
    maxSpeedKmh: rm.maxSpeedKmh != null ? String(rm.maxSpeedKmh) : '',
    structureHeightM: rm.structureHeightM != null ? String(rm.structureHeightM) : '',
    trackLengthM: rm.trackLengthM != null ? String(rm.trackLengthM) : '',
    thrillLevel: rm.thrillLevel != null ? String(rm.thrillLevel) : '',
    manufacturer: String(rm.manufacturer || ''),
    buildYear: rm.buildYear != null ? String(rm.buildYear) : '',
    plcType: String(rm.plcType || ''),
    maintenanceClass: String(rm.maintenanceClass || ''),
    targetAvailabilityPct: at.targetAvailabilityPct != null ? String(at.targetAvailabilityPct) : '',
    targetWaitTimeMin: at.targetWaitTimeMin != null ? String(at.targetWaitTimeMin) : '',
    targetUtilizationPct: at.targetUtilizationPct != null ? String(at.targetUtilizationPct) : '',
    targetOeePct: at.targetOeePct != null ? String(at.targetOeePct) : '',
    revenuePriority: String(at.revenuePriority || ''),
  }
}

async function load() {
  busy.value = true
  try {
    const a = await getPlatformAsset(assetId.value)
    asset.value = a
    loadFormFromAsset(a)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  } finally {
    busy.value = false
  }
}

watch(assetId, () => void load())

onMounted(() => void load())

async function save() {
  saving.value = true
  try {
    await putPlatformRideMaster(assetId.value, {
      capacityPph: num(form.value.capacityPph),
      theoreticalCapacityPph: num(form.value.theoreticalCapacityPph),
      dispatchIntervalSec: num(form.value.dispatchIntervalSec),
      cycleTimeSec: num(form.value.cycleTimeSec),
      plannedCycleTimeSec: num(form.value.plannedCycleTimeSec),
      opcReferenceCycleTimeSec: num(form.value.opcReferenceCycleTimeSec),
      maxQueueGuests: num(form.value.maxQueueGuests),
      seatsPerCycle: num(form.value.seatsPerCycle),
      trainsCount: num(form.value.trainsCount),
      rideCategory: form.value.rideCategory || null,
      minStaff: num(form.value.minStaff),
      normalStaff: num(form.value.normalStaff),
      peakStaff: num(form.value.peakStaff),
      weatherSensitive: form.value.weatherSensitive,
      rainSensitive: form.value.rainSensitive,
      virtualLineEnabled: form.value.virtualLineEnabled,
      windLimitKmh: num(form.value.windLimitKmh),
      minHeightCm: num(form.value.minHeightCm),
      maxHeightCm: num(form.value.maxHeightCm),
      maxSpeedKmh: num(form.value.maxSpeedKmh),
      structureHeightM: num(form.value.structureHeightM),
      trackLengthM: num(form.value.trackLengthM),
      thrillLevel: num(form.value.thrillLevel),
      manufacturer: form.value.manufacturer || null,
      buildYear: num(form.value.buildYear),
      plcType: form.value.plcType || null,
      maintenanceClass: form.value.maintenanceClass || null,
      targets: {
        targetAvailabilityPct: num(form.value.targetAvailabilityPct),
        targetWaitTimeMin: num(form.value.targetWaitTimeMin),
        targetUtilizationPct: num(form.value.targetUtilizationPct),
        targetOeePct: num(form.value.targetOeePct),
        revenuePriority: form.value.revenuePriority || null,
      },
    })
    push('Saved', 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}

async function enrich() {
  try {
    await postPlatformRideEnrichTemplate(assetId.value, 'RIDE_DEFAULT')
    push('Template applied', 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Enrich failed', 'error')
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6">
    <nav class="text-xs text-slate-500">
      <RouterLink to="/platform" class="text-brand-400 hover:underline">Platform MDM</RouterLink>
      <span class="mx-1">/</span>
      <RouterLink to="/platform/assets" class="text-brand-400 hover:underline">Assets</RouterLink>
      <span class="mx-1">/</span>
      <span class="text-slate-400">Ride-Stammdaten</span>
    </nav>
    <h1 class="font-display text-xl font-semibold text-white">Ride master data</h1>
    <p v-if="asset" class="text-sm text-slate-400">{{ asset.name }}</p>
    <div v-if="busy" class="text-sm text-slate-500">Loading…</div>
    <div v-else-if="asset" class="grid gap-3 sm:grid-cols-2">
      <label class="text-xs text-slate-500">
        capacityPph / theoreticalCapacityPph
        <div class="mt-1 flex gap-1">
          <input v-model="form.capacityPph" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.theoreticalCapacityPph" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500">
        dispatchIntervalSec / cycleTimeSec
        <div class="mt-1 flex gap-1">
          <input v-model="form.dispatchIntervalSec" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.cycleTimeSec" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500 sm:col-span-2">
        plannedCycleTimeSec / opcReferenceCycleTimeSec / maxQueueGuests
        <span class="mt-0.5 block font-normal text-slate-600">Planning and queue cap for sim / IT-OT; OPC can mirror actual cycle into opcReference…</span>
        <div class="mt-1 flex gap-1">
          <input v-model="form.plannedCycleTimeSec" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.opcReferenceCycleTimeSec" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.maxQueueGuests" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500">
        seatsPerCycle / trainsCount
        <div class="mt-1 flex gap-1">
          <input v-model="form.seatsPerCycle" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.trainsCount" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500">
        rideCategory
        <input v-model="form.rideCategory" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
      </label>
      <label class="text-xs text-slate-500">
        minStaff / normalStaff / peakStaff
        <div class="mt-1 flex gap-1">
          <input v-model="form.minStaff" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.normalStaff" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.peakStaff" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="flex items-center gap-2 text-xs text-slate-400 sm:col-span-2">
        <input v-model="form.weatherSensitive" type="checkbox" class="rounded border-slate-600" />
        weatherSensitive
        <input v-model="form.rainSensitive" type="checkbox" class="ml-4 rounded border-slate-600" />
        rainSensitive
      </label>
      <label class="flex items-start gap-2 text-xs text-slate-400 sm:col-span-2">
        <input v-model="form.virtualLineEnabled" type="checkbox" class="mt-0.5 rounded border-slate-600" />
        <span>
          <span class="font-medium text-slate-300">virtualLineEnabled</span>
          — Virtual Line / app time-slot booking (guests can bypass the physical queue when the park offers it, e.g. Zeittickets in the park app).
        </span>
      </label>
      <label class="text-xs text-slate-500">
        windLimitKmh
        <input v-model="form.windLimitKmh" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
      </label>
      <label class="text-xs text-slate-500">
        minHeightCm / maxHeightCm / thrillLevel
        <div class="mt-1 flex gap-1">
          <input v-model="form.minHeightCm" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.maxHeightCm" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.thrillLevel" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500 sm:col-span-2">
        maxSpeedKmh / structureHeightM / trackLengthM
        <span class="mt-0.5 block font-normal text-slate-600">Published ride spec: v_max (km/h), tallest structure (m), track length (m). Use ride category and capacity fields above for type and pph.</span>
        <div class="mt-1 flex gap-1">
          <input v-model="form.maxSpeedKmh" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.structureHeightM" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.trackLengthM" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500 sm:col-span-2">
        manufacturer
        <input v-model="form.manufacturer" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
      </label>
      <label class="text-xs text-slate-500">
        buildYear
        <input v-model="form.buildYear" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
      </label>
      <label class="text-xs text-slate-500">
        plcType / maintenanceClass
        <div class="mt-1 flex gap-1">
          <input v-model="form.plcType" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.maintenanceClass" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <p class="text-xs font-medium text-slate-400 sm:col-span-2">asset_targets (all asset types)</p>
      <label class="text-xs text-slate-500">
        targetAvailabilityPct / targetWaitTimeMin
        <div class="mt-1 flex gap-1">
          <input v-model="form.targetAvailabilityPct" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.targetWaitTimeMin" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500">
        targetUtilizationPct / targetOeePct
        <div class="mt-1 flex gap-1">
          <input v-model="form.targetUtilizationPct" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
          <input v-model="form.targetOeePct" type="text" class="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs text-white" />
        </div>
      </label>
      <label class="text-xs text-slate-500 sm:col-span-2">
        revenuePriority
        <input v-model="form.revenuePriority" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
      </label>
    </div>

    <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <SignalsCapabilitiesPanel entity-type="park_asset" :entity-id="assetId" :editable="canUpdate" />
    </section>

    <div class="flex flex-wrap gap-2">
      <button
        v-if="canUpdate"
        type="button"
        class="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-40"
        :disabled="saving"
        @click="save"
      >
        Save ride_master_data + asset_targets
      </button>
      <button
        v-if="canUpdate"
        type="button"
        class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200"
        @click="enrich"
      >
        Enrich from RIDE_DEFAULT template
      </button>
      <RouterLink to="/platform/assets" class="text-sm text-brand-400">← Assets</RouterLink>
    </div>
  </div>
</template>
