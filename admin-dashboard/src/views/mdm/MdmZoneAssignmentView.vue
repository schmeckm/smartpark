<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getMdmParks, getMdmRides, getMdmZones, patchMdmRideZone } from '@/api/client'
import type { MdmPark, MdmParkZone, MdmRideMaster } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'

const { push } = useToast()
const auth = useAuthStore()

const parks = ref<MdmPark[]>([])
const zones = ref<MdmParkZone[]>([])
const rides = ref<MdmRideMaster[]>([])

const parkId = ref('')
const rideId = ref('')
const newZoneId = ref('')
const busy = ref(false)

const canUpdate = computed(() => auth.hasPermission('rides', 'update'))

const ridesInPark = computed(() => rides.value.filter((r) => r.parkId === parkId.value))
const selectedRide = computed(() => rides.value.find((r) => r.id === rideId.value))

const zoneOptions = computed(() => zones.value.filter((z) => z.parkId === parkId.value))

async function loadParks() {
  parks.value = await getMdmParks()
  if (!parkId.value && parks.value.length) parkId.value = parks.value[0].id
}

async function loadZones() {
  zones.value = parkId.value ? await getMdmZones(parkId.value) : []
}

async function loadRides() {
  busy.value = true
  try {
    rides.value = await getMdmRides({ parkId: parkId.value || undefined })
    if (rideId.value && !ridesInPark.value.some((r) => r.id === rideId.value)) rideId.value = ''
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load rides', 'error')
  } finally {
    busy.value = false
  }
}

watch(parkId, async () => {
  rideId.value = ''
  newZoneId.value = ''
  await loadZones()
  await loadRides()
})

onMounted(async () => {
  try {
    await loadParks()
    await loadZones()
    await loadRides()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
})

async function assign() {
  if (!rideId.value || !newZoneId.value) {
    push('Select ride and target zone', 'error')
    return
  }
  try {
    await patchMdmRideZone(rideId.value, newZoneId.value)
    push('Zone updated', 'success')
    await loadRides()
    rideId.value = ''
    newZoneId.value = ''
  } catch (e) {
    push(e instanceof Error ? e.message : 'Assign failed', 'error')
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg space-y-6 px-4 py-6 sm:px-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Zone assignment</h1>
        <p class="mt-1 text-sm text-slate-400">Move an MDM ride record to another zone within the same park.</p>
      </div>
      <RouterLink to="/mdm/rides" class="shrink-0 text-sm text-brand-400 hover:text-brand-300">← Rides</RouterLink>
    </div>

    <div class="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label class="block text-xs text-slate-500">
        Park
        <select v-model="parkId" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="block text-xs text-slate-500">
        Ride
        <select v-model="rideId" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value="" disabled>Select ride</option>
          <option v-for="r in ridesInPark" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <p v-if="selectedRide" class="text-xs text-slate-500">
        Current zone: <span class="text-slate-300">{{ selectedRide.parkZone?.name ?? '—' }}</span>
      </p>
      <label class="block text-xs text-slate-500">
        New zone
        <select v-model="newZoneId" class="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value="" disabled>Select zone</option>
          <option v-for="z in zoneOptions" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
      </label>
      <button
        type="button"
        class="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white disabled:opacity-40"
        :disabled="!canUpdate || busy"
        @click="assign"
      >
        Assign zone
      </button>
      <p v-if="!canUpdate" class="text-center text-xs text-amber-500/90">Your role does not allow ride updates.</p>
    </div>
  </div>
</template>
