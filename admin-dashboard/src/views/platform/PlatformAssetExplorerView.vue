<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getPlatformAssets, getPlatformParks } from '@/api/client'
import type { PlatformAsset, PlatformPark } from '@/types/api'
import { useToast } from '@/composables/useToast'

const { push } = useToast()
const parks = ref<PlatformPark[]>([])
const parkId = ref('')
const assets = ref<PlatformAsset[]>([])
const busy = ref(false)
const typeFilter = ref('')

function assetTypeCode(a: PlatformAsset): string {
  const at = a.assetType as { code?: string } | undefined
  return String(at?.code || '')
}

const rideRows = computed(() => assets.value.filter((a) => assetTypeCode(a) === 'RIDE'))

async function loadParks() {
  parks.value = await getPlatformParks()
  if (!parkId.value && parks.value.length) parkId.value = parks.value[0].id
}

async function loadAssets() {
  if (!parkId.value) return
  busy.value = true
  try {
    assets.value = await getPlatformAssets({
      parkId: parkId.value,
      assetTypeCode: typeFilter.value || undefined,
      limit: 500,
    })
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  } finally {
    busy.value = false
  }
}

watch(parkId, () => void loadAssets())
watch(typeFilter, () => void loadAssets())

onMounted(async () => {
  try {
    await loadParks()
    await loadAssets()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed', 'error')
  }
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6">
    <nav class="text-xs text-slate-500">
      <RouterLink to="/platform" class="text-brand-400 hover:underline">Platform MDM</RouterLink>
      <span class="mx-1">/</span>
      <span class="text-slate-400">Assets</span>
    </nav>
    <h1 class="font-display text-xl font-semibold text-white">Asset explorer</h1>
    <p class="text-sm text-slate-400">
      Stammdaten für <strong class="text-slate-200">Fahrgeschäfte (RIDE)</strong> bearbeitest du über die Spalte rechts
      „Ride MDM“ — das öffnet die Seite „Ride master data“ mit Formular und Speichern.
      Andere Asset-Typen werden hier nur gelistet (Editor folgt).
    </p>
    <div class="flex flex-wrap gap-3">
      <label class="text-xs text-slate-500">
        Park
        <select v-model="parkId" class="mt-1 block rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white">
          <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        Type code
        <input
          v-model="typeFilter"
          type="text"
          placeholder="e.g. RIDE"
          class="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-sm text-white"
        />
      </label>
      <button type="button" class="self-end rounded border border-slate-600 px-3 py-1.5 text-xs" @click="loadAssets">Refresh</button>
    </div>

    <p class="text-xs text-slate-500">Ride assets link to the ride master editor.</p>
    <div class="overflow-x-auto rounded-xl border border-slate-800">
      <table class="min-w-full text-left text-sm text-slate-200">
        <thead class="bg-slate-900/80 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Type</th>
            <th class="px-3 py-2">Status</th>
            <th class="px-3 py-2">Aktion</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in assets" :key="String(a.assetId)" class="border-t border-slate-800">
            <td class="px-3 py-2">{{ a.name }}</td>
            <td class="px-3 py-2 font-mono text-xs">{{ assetTypeCode(a) }}</td>
            <td class="px-3 py-2">{{ a.status }}</td>
            <td class="px-3 py-2 text-right">
              <RouterLink
                v-if="assetTypeCode(a) === 'RIDE'"
                :to="`/platform/rides/${String(a.assetId)}`"
                class="text-brand-400 hover:text-brand-300"
              >
                Ride MDM
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-xs text-slate-600">Ride rows (shortcut): {{ rideRows.length }}</p>
  </div>
</template>
