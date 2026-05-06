<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  getMdmCapacityModel,
  getMdmRide,
  getMdmStaffingModel,
  patchMdmRideActive,
  putMdmRide,
} from '@/api/client'
import type { MdmRideMaster } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import SignalsCapabilitiesPanel from '@/components/masterdata/SignalsCapabilitiesPanel.vue'

const route = useRoute()
const { push } = useToast()
const auth = useAuthStore()

const rideId = computed(() => route.params.id as string)
const busy = ref(true)
const saving = ref(false)
const ride = ref<MdmRideMaster | null>(null)

const name = ref('')
const shortName = ref('')
const externalId = ref('')
const description = ref('')
const manufacturer = ref('')
const model = ref('')
const buildYear = ref<string>('')
const lifecycleStatus = ref('ACTIVE')
const commissioningDate = ref('')

const jsonOps = ref('')
const jsonCap = ref('')
const jsonStaff = ref('')
const jsonSafety = ref('')
const jsonGuest = ref('')
const jsonInteg = ref('')
const jsonKpi = ref('')

const capModel = ref<Record<string, unknown> | null>(null)
const staffModel = ref<Record<string, unknown> | null>(null)

const canUpdate = computed(() => auth.hasPermission('rides', 'update'))

function stringify(v: unknown) {
  return JSON.stringify(v ?? {}, null, 2)
}

async function load() {
  busy.value = true
  capModel.value = null
  staffModel.value = null
  try {
    const r = await getMdmRide(rideId.value)
    ride.value = r
    name.value = r.name
    shortName.value = r.shortName ?? ''
    externalId.value = r.externalId ?? ''
    description.value = r.description ?? ''
    manufacturer.value = r.manufacturer ?? ''
    model.value = r.model ?? ''
    buildYear.value = r.buildYear != null ? String(r.buildYear) : ''
    lifecycleStatus.value = r.lifecycleStatus
    commissioningDate.value = r.commissioningDate ?? ''
    jsonOps.value = stringify(r.operations)
    jsonCap.value = stringify(r.capacity)
    jsonStaff.value = stringify(r.staffing)
    jsonSafety.value = stringify(r.safety)
    jsonGuest.value = stringify(r.guestRules)
    jsonInteg.value = stringify(r.integration)
    jsonKpi.value = stringify(r.kpiTargets)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load ride', 'error')
  } finally {
    busy.value = false
  }
}

watch(rideId, () => void load())

onMounted(() => void load())

function parseSection(raw: string, label: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(raw || '{}')
    if (typeof o !== 'object' || o === null) throw new Error('not an object')
    return o as Record<string, unknown>
  } catch {
    push(`${label} JSON invalid`, 'error')
    return null
  }
}

async function saveAll() {
  const operations = parseSection(jsonOps.value, 'Operations')
  const capacity = parseSection(jsonCap.value, 'Capacity')
  const staffing = parseSection(jsonStaff.value, 'Staffing')
  const safety = parseSection(jsonSafety.value, 'Safety')
  const guestRules = parseSection(jsonGuest.value, 'Guest rules')
  const integration = parseSection(jsonInteg.value, 'Integration')
  const kpiTargets = parseSection(jsonKpi.value, 'KPI targets')
  if (!operations || !capacity || !staffing || !safety || !guestRules || !integration || !kpiTargets) return

  saving.value = true
  try {
    await putMdmRide(rideId.value, {
      name: name.value.trim(),
      shortName: shortName.value.trim() || null,
      externalId: externalId.value.trim() || null,
      description: description.value.trim() || null,
      manufacturer: manufacturer.value.trim() || null,
      model: model.value.trim() || null,
      buildYear: buildYear.value ? Number(buildYear.value) : null,
      commissioningDate: commissioningDate.value || null,
      lifecycleStatus: lifecycleStatus.value,
      operations,
      capacity,
      staffing,
      safety,
      guestRules,
      integration,
      kpiTargets,
    })
    push('Saved', 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}

async function toggleActive() {
  if (!ride.value) return
  try {
    await patchMdmRideActive(rideId.value, !ride.value.activeFlag)
    push('Status updated', 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

async function loadCapacityModel() {
  try {
    capModel.value = await getMdmCapacityModel(rideId.value)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}

async function loadStaffingModel() {
  try {
    staffModel.value = await getMdmStaffingModel(rideId.value)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <div v-if="busy" class="text-sm text-slate-500">Loading…</div>
    <template v-else-if="ride">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-xs uppercase tracking-wide text-slate-500">MDM ride</p>
          <h1 class="font-display text-xl font-semibold text-white">{{ ride.name }}</h1>
          <p class="mt-1 text-sm text-slate-400">
            {{ ride.rideType?.code }} · {{ ride.park?.name }} / {{ ride.parkZone?.name }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="canUpdate"
            type="button"
            class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="toggleActive"
          >
            {{ ride.activeFlag ? 'Deactivate' : 'Activate' }}
          </button>
          <RouterLink to="/mdm/rides" class="text-sm text-brand-400 hover:text-brand-300">← Back to list</RouterLink>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <section class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-2">
          <h2 class="text-sm font-semibold text-white">Core</h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="text-xs text-slate-500">
              Name
              <input v-model="name" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              Short name
              <input v-model="shortName" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              External ID
              <input v-model="externalId" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              Lifecycle
              <input v-model="lifecycleStatus" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500 sm:col-span-2">
              Description
              <textarea v-model="description" rows="2" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              Manufacturer
              <input v-model="manufacturer" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              Model
              <input v-model="model" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              Build year
              <input v-model="buildYear" type="number" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
            <label class="text-xs text-slate-500">
              Commissioning (date)
              <input v-model="commissioningDate" type="date" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white" />
            </label>
          </div>
        </section>

        <section class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 class="text-sm font-semibold text-white">Models</h2>
          <p class="text-xs text-slate-500">Read-only API projections for capacity planning and workforce.</p>
          <button
            type="button"
            class="w-full rounded border border-slate-600 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="loadCapacityModel"
          >
            Load capacity model
          </button>
          <pre v-if="capModel" class="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] text-slate-400">{{ JSON.stringify(capModel, null, 2) }}</pre>
          <button
            type="button"
            class="w-full rounded border border-slate-600 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            @click="loadStaffingModel"
          >
            Load staffing model
          </button>
          <pre v-if="staffModel" class="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] text-slate-400">{{ JSON.stringify(staffModel, null, 2) }}</pre>
        </section>
      </div>

      <section class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <SignalsCapabilitiesPanel entity-type="ride" :entity-id="rideId" :editable="canUpdate" />
      </section>

      <section class="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 class="text-sm font-semibold text-white">Domain payloads (JSON)</h2>
        <p class="text-xs text-slate-500">
          Edit extension rows. Keys use API camelCase (e.g. <span class="font-mono">plannedOpeningTime</span>,
          <span class="font-mono">theoreticalCapacityPph</span>).
        </p>
        <div class="grid gap-4 lg:grid-cols-2">
          <label class="text-xs text-slate-500">
            Operations
            <textarea v-model="jsonOps" rows="8" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
          <label class="text-xs text-slate-500">
            Capacity
            <textarea v-model="jsonCap" rows="8" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
          <label class="text-xs text-slate-500">
            Staffing
            <textarea v-model="jsonStaff" rows="8" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
          <label class="text-xs text-slate-500">
            Safety
            <textarea v-model="jsonSafety" rows="8" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
          <label class="text-xs text-slate-500">
            Guest rules
            <textarea v-model="jsonGuest" rows="8" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
          <label class="text-xs text-slate-500">
            Integration
            <textarea v-model="jsonInteg" rows="8" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
          <label class="text-xs text-slate-500 lg:col-span-2">
            KPI targets
            <textarea v-model="jsonKpi" rows="6" class="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          </label>
        </div>
        <button
          v-if="canUpdate"
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="saving"
          @click="saveAll"
        >
          Save all
        </button>
      </section>
    </template>
  </div>
</template>
