<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { getMdmParks, getMdmRides, getMdmZones } from '@/api/client'
import type { MdmPark, MdmParkZone, MdmRideMaster } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const { push } = useToast()
const auth = useAuthStore()

const busy = ref(true)
const parks = ref<MdmPark[]>([])
const zones = ref<MdmParkZone[]>([])
const rides = ref<MdmRideMaster[]>([])
/** Empty = all MDM parks (no server-side park filter). */
const parkId = ref('')
const zoneId = ref('')
const activeOnly = ref<boolean | null>(null)

const canCreate = computed(() => auth.hasPermission('rides', 'create'))

async function loadParks() {
  parks.value = await getMdmParks()
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
        <h1 class="font-display text-xl font-semibold text-white">{{ t('mdmRidesList.title') }}</h1>
        <p class="mt-1 text-sm text-slate-400">
          {{ t('mdmRidesList.subtitle') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink
          :to="{ name: 'master-data', params: { entityType: 'rides' } }"
          class="rounded-lg border border-brand-500/50 bg-brand-950/30 px-4 py-2 text-sm font-medium text-brand-200 hover:bg-brand-900/40"
        >
          {{ t('menu.masterData') }}
        </RouterLink>
        <RouterLink
          v-if="canCreate"
          to="/mdm/rides/new"
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
        >
          {{ t('mdmRidesList.newRide') }}
        </RouterLink>
      </div>
    </div>

    <div class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label class="text-xs text-slate-500">
        {{ t('mdmRidesList.filterPark') }}
        <select
          v-model="parkId"
          class="mt-1 block w-52 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option value="">{{ t('mdmRidesList.allParks') }}</option>
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        {{ t('mdmRidesList.filterZone') }}
        <select
          v-model="zoneId"
          class="mt-1 block w-52 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option value="">{{ t('mdmRidesList.allZones') }}</option>
          <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        {{ t('mdmRidesList.filterStatus') }}
        <select
          v-model="activeOnly"
          class="mt-1 block w-40 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
        >
          <option :value="null">{{ t('masterDataEntity.filters.any') }}</option>
          <option :value="true">{{ t('mdmRidesList.active') }}</option>
          <option :value="false">{{ t('mdmRidesList.inactive') }}</option>
        </select>
      </label>
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
        :disabled="busy"
        @click="loadRides"
      >
        {{ t('masterDataEntity.refresh') }}
      </button>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3">{{ t('masterDataEntity.table.name') }}</th>
            <th class="px-4 py-3">{{ t('masterDataEntity.table.type') }}</th>
            <th class="px-4 py-3">{{ t('masterDataEntity.table.zone') }}</th>
            <th class="px-4 py-3">{{ t('mdmRidesList.lifecycle') }}</th>
            <th class="px-4 py-3">{{ t('masterDataEntity.table.active') }}</th>
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
                {{ r.activeFlag ? t('masterDataEntity.yes') : t('masterDataEntity.no') }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <RouterLink
                :to="`/mdm/rides/${r.id}`"
                class="text-brand-400 hover:text-brand-300"
              >
                {{ t('mdmRidesList.open') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!busy && !rides.length" class="space-y-3 px-4 py-8 text-center">
        <p class="text-sm text-slate-400">{{ t('mdmRidesList.emptyFilters') }}</p>
        <p class="mx-auto max-w-xl text-xs leading-relaxed text-slate-500">
          {{ t('mdmRidesList.emptyExplain') }}
        </p>
        <RouterLink
          :to="{ name: 'master-data', params: { entityType: 'rides' } }"
          class="inline-flex rounded-lg border border-brand-500/40 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-slate-800"
        >
          {{ t('mdmRidesList.openAssetData') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>
