<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getMdmParks, getMdmRideTypes, getMdmZones, postMdmRide } from '@/api/client'
import type { MdmPark, MdmParkZone, MdmRideProfile, MdmRideType } from '@/types/api'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { push } = useToast()

const step = ref(0)
const parks = ref<MdmPark[]>([])
const zones = ref<MdmParkZone[]>([])
const types = ref<MdmRideType[]>([])
const busy = ref(false)

const parkId = ref('')
const parkZoneId = ref('')
const rideTypeId = ref('')
const name = ref('')
const externalId = ref('')
const shortName = ref('')
const description = ref('')
const profileJson = ref('{\n  "operations": {},\n  "capacity": {},\n  "staffing": {},\n  "safety": {},\n  "guestRules": {},\n  "integration": {},\n  "kpi": {}\n}')

const zoneOptions = computed(() => zones.value.filter((z) => z.parkId === parkId.value))

watch(parkId, async (id) => {
  parkZoneId.value = ''
  if (!id) {
    zones.value = []
    return
  }
  try {
    zones.value = await getMdmZones(id)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load zones', 'error')
  }
})

onMounted(async () => {
  try {
    const [p, t] = await Promise.all([getMdmParks(), getMdmRideTypes()])
    parks.value = p
    types.value = t
    if (p.length) {
      parkId.value = p[0].id
      zones.value = await getMdmZones(p[0].id)
    }
    if (t.length) rideTypeId.value = t[0].id
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load', 'error')
  }
})

function next() {
  if (step.value < 2) step.value += 1
}

function back() {
  if (step.value > 0) step.value -= 1
}

async function submit() {
  let profile: MdmRideProfile | undefined
  try {
    const parsed = JSON.parse(profileJson.value || '{}')
    if (parsed && typeof parsed === 'object') profile = parsed as MdmRideProfile
  } catch {
    push('Profile JSON is invalid', 'error')
    return
  }
  if (!parkId.value || !parkZoneId.value || !rideTypeId.value || !name.value.trim()) {
    push('Park, zone, type, and name are required', 'error')
    return
  }
  busy.value = true
  try {
    const ride = await postMdmRide({
      parkId: parkId.value,
      parkZoneId: parkZoneId.value,
      rideTypeId: rideTypeId.value,
      name: name.value.trim(),
      externalId: externalId.value.trim() || null,
      shortName: shortName.value.trim() || null,
      description: description.value.trim() || null,
      profile,
    })
    push('Ride created', 'success')
    await router.replace(`/mdm/rides/${ride.id}`)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Create failed', 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
    <div>
      <h1 class="font-display text-xl font-semibold text-white">Create ride</h1>
      <p class="mt-1 text-sm text-slate-400">Wizard: hierarchy → identity → optional profile defaults.</p>
    </div>

    <ol class="flex gap-2 text-xs text-slate-500">
      <li :class="step >= 0 ? 'text-brand-400' : ''">1. Placement</li>
      <li :class="step >= 1 ? 'text-brand-400' : ''">2. Identity</li>
      <li :class="step >= 2 ? 'text-brand-400' : ''">3. Profile JSON</li>
    </ol>

    <div v-if="step === 0" class="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label class="block text-xs text-slate-500">
        Park
        <select v-model="parkId" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="block text-xs text-slate-500">
        Zone
        <select
          v-model="parkZoneId"
          class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option value="" disabled>Select zone</option>
          <option v-for="z in zoneOptions" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
      </label>
      <label class="block text-xs text-slate-500">
        Ride type
        <select v-model="rideTypeId" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option v-for="t in types" :key="t.id" :value="t.id">{{ t.code }} — {{ t.name }}</option>
        </select>
      </label>
    </div>

    <div v-else-if="step === 1" class="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label class="block text-xs text-slate-500">
        Display name
        <input v-model="name" type="text" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
      </label>
      <label class="block text-xs text-slate-500">
        External ID
        <input v-model="externalId" type="text" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
      </label>
      <label class="block text-xs text-slate-500">
        Short name
        <input v-model="shortName" type="text" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
      </label>
      <label class="block text-xs text-slate-500">
        Description
        <textarea v-model="description" rows="3" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
      </label>
    </div>

    <div v-else class="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p class="text-xs text-slate-500">
        Optional merged profile (operations, capacity, staffing, safety, guestRules, integration, kpi). Must be valid JSON.
      </p>
      <textarea v-model="profileJson" rows="16" class="w-full rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200" />
    </div>

    <div class="flex justify-between gap-2">
      <button type="button" class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200" @click="back" :disabled="step === 0">
        Back
      </button>
      <div class="flex gap-2">
        <button
          v-if="step < 2"
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
          @click="next"
        >
          Next
        </button>
        <button
          v-else
          type="button"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy"
          @click="submit"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>
