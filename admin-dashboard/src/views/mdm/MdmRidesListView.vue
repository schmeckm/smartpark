<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getMdmParks, getMdmRides, getMdmZones } from '@/api/client'
import type { MdmPark, MdmParkZone, MdmRideMaster } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'

const { push } = useToast()
const auth = useAuthStore()

const busy = ref(true)
const parks = ref<MdmPark[]>([])
const zones = ref<MdmParkZone[]>([])
const rides = ref<MdmRideMaster[]>([])
const parkId = ref('')
const zoneId = ref('')
const activeOnly = ref<boolean | null>(null)

const canCreate = computed(() => auth.hasPermission('rides', 'create'))

async function loadParks() {
  parks.value = await getMdmParks()
  if (!parkId.value && parks.value.length) parkId.value = parks.value[0].id
}

async function loadZones() {
  zones.value = parkId.value ? await getMdmZones(parkId.value) : []
  if (zoneId.value && !zones.value.some((z) => z.id === zoneId.value)) zoneId.value = ''
}

async function loadRides() {
  busy.value = true
  try {
    rides.value = await getMdmRides({
      parkId: parkId.value || undefined,
      parkZoneId: zoneId.value || undefined,
      activeFlag: activeOnly.value === null ? undefined : activeOnly.value,
    })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load rides', 'error')
  } finally {
    busy.value = false
  }
}

watch(parkId, async () => {
  await loadZones()
  await loadRides()
})

watch([zoneId, activeOnly], () => {
  void loadRides()
})

onMounted(async () => {
  try {
    await loadParks()
    await loadZones()
    await loadRides()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load MDM', 'error')
  } finally {
    busy.value = false
  }
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Ride master data</h1>
        <p class="mt-1 text-sm text-slate-400">
          Park → zone → attraction registry (operations, capacity, staffing, safety, integration, KPIs).
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink
          v-if="canCreate"
          to="/mdm/rides/new"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
        >
          New ride
        </RouterLink>
        <RouterLink
          to="/mdm/templates"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Templates
        </RouterLink>
        <RouterLink
          to="/mdm/zones"
          class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Zone assignment
        </RouterLink>
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label class="text-xs text-slate-500">
        Park
        <select
          v-model="parkId"
          class="mt-1 block w-52 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        Zone
        <select
          v-model="zoneId"
          class="mt-1 block w-52 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option value="">All zones</option>
          <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        Status
        <select
          v-model="activeOnly"
          class="mt-1 block w-40 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option :value="null">Any</option>
          <option :value="true">Active</option>
          <option :value="false">Inactive</option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        :disabled="busy"
        @click="loadRides"
      >
        Refresh
      </button>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Type</th>
            <th class="px-4 py-3">Zone</th>
            <th class="px-4 py-3">Lifecycle</th>
            <th class="px-4 py-3">Active</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800 bg-slate-950/40">
          <tr v-for="r in rides" :key="r.id" class="text-slate-200">
            <td class="px-4 py-3 font-medium text-white">{{ r.name }}</td>
            <td class="px-4 py-3 text-slate-400">{{ r.rideType?.code ?? '—' }}</td>
            <td class="px-4 py-3 text-slate-400">{{ r.parkZone?.name ?? '—' }}</td>
            <td class="px-4 py-3 font-mono text-xs">{{ r.lifecycleStatus }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="r.activeFlag ? 'bg-emerald-900/50 text-emerald-300' : 'bg-slate-800 text-slate-400'"
              >
                {{ r.activeFlag ? 'Yes' : 'No' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <RouterLink
                :to="`/mdm/rides/${r.id}`"
                class="text-brand-400 hover:text-brand-300"
              >
                Open
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!busy && !rides.length" class="px-4 py-8 text-center text-sm text-slate-500">No rides match filters.</p>
    </div>
  </div>
</template>
