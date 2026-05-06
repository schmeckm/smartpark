<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  getMdmParks,
  getMdmRideTemplates,
  getMdmRideTypes,
  getMdmZones,
  postMdmCloneRideFromTemplate,
  putMdmRideTemplate,
} from '@/api/client'
import type { MdmPark, MdmParkZone, MdmRideTemplate, MdmRideType } from '@/types/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const { push } = useToast()
const auth = useAuthStore()

const busy = ref(true)
const templates = ref<MdmRideTemplate[]>([])
const rideTypes = ref<MdmRideType[]>([])
const parks = ref<MdmPark[]>([])
const zones = ref<MdmParkZone[]>([])

const filterTypeId = ref('')

const editId = ref<string | null>(null)
const editJson = ref('')

const cloneOpen = ref(false)
const cloneTemplateId = ref('')
const cloneParkId = ref('')
const cloneZoneId = ref('')
const cloneName = ref('')
const cloneBusy = ref(false)

const canUpdate = computed(() => auth.hasPermission('rides', 'update'))
const canCreate = computed(() => auth.hasPermission('rides', 'create'))

const zoneOptions = computed(() => zones.value.filter((z) => z.parkId === cloneParkId.value))

async function load() {
  busy.value = true
  try {
    const [t, p, rt] = await Promise.all([
      getMdmRideTemplates({ rideTypeId: filterTypeId.value || undefined }),
      getMdmParks(),
      getMdmRideTypes(),
    ])
    templates.value = t
    parks.value = p
    rideTypes.value = rt
    if (!cloneParkId.value && p.length) cloneParkId.value = p[0].id
  } catch (e) {
    push(e instanceof Error ? e.message : 'Failed to load', 'error')
  } finally {
    busy.value = false
  }
}

watch(cloneParkId, async (id) => {
  cloneZoneId.value = ''
  if (!id) {
    zones.value = []
    return
  }
  try {
    zones.value = await getMdmZones(id)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Zones failed', 'error')
  }
})

onMounted(async () => {
  await load()
  try {
    rideTypes.value = await getMdmRideTypes()
  } catch {
    /* ignore */
  }
  if (parks.value.length) {
    zones.value = await getMdmZones(parks.value[0].id)
  }
})

function openEdit(t: MdmRideTemplate) {
  editId.value = t.id
  editJson.value = JSON.stringify(t.defaultProfile ?? {}, null, 2)
}

async function saveEdit() {
  if (!editId.value) return
  let defaultProfile: Record<string, unknown>
  try {
    defaultProfile = JSON.parse(editJson.value) as Record<string, unknown>
  } catch {
    push('Invalid JSON', 'error')
    return
  }
  try {
    await putMdmRideTemplate(editId.value, { defaultProfile })
    push('Template updated', 'success')
    editId.value = null
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  }
}

function openClone(t: MdmRideTemplate) {
  cloneTemplateId.value = t.id
  cloneName.value = `${t.displayName} (instance)`
  cloneOpen.value = true
}

async function doClone() {
  if (!cloneTemplateId.value || !cloneZoneId.value || !cloneName.value.trim()) {
    push('Zone and name required', 'error')
    return
  }
  cloneBusy.value = true
  try {
    const ride = await postMdmCloneRideFromTemplate(cloneTemplateId.value, {
      parkZoneId: cloneZoneId.value,
      name: cloneName.value.trim(),
    })
    push('Ride cloned from template', 'success')
    cloneOpen.value = false
    await router.push(`/mdm/rides/${ride.id}`)
  } catch (e) {
    push(e instanceof Error ? e.message : 'Clone failed', 'error')
  } finally {
    cloneBusy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Ride templates</h1>
        <p class="mt-1 text-sm text-slate-400">System defaults per ride type; clone to instantiate a governed profile.</p>
      </div>
      <RouterLink to="/mdm/rides" class="text-sm text-brand-400 hover:text-brand-300">← Rides</RouterLink>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <label class="text-xs text-slate-500">
        Ride type
        <select
          v-model="filterTypeId"
          class="mt-1 block min-w-[12rem] rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
          @change="load"
        >
          <option value="">All types</option>
          <option v-for="rt in rideTypes" :key="rt.id" :value="rt.id">{{ rt.code }}</option>
        </select>
      </label>
      <button type="button" class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200" @click="load">Refresh</button>
    </div>

    <div v-if="busy" class="text-sm text-slate-500">Loading…</div>
    <ul v-else class="space-y-2">
      <li
        v-for="t in templates"
        :key="t.id"
        class="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p class="font-medium text-white">{{ t.displayName }}</p>
          <p class="text-xs text-slate-500">
            {{ t.rideType?.code }} · {{ t.code }} · {{ t.isSystem ? 'system' : 'custom' }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="canUpdate"
            type="button"
            class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200"
            @click="openEdit(t)"
          >
            Edit profile JSON
          </button>
          <button
            v-if="canCreate"
            type="button"
            class="rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white"
            @click="openClone(t)"
          >
            Clone to ride
          </button>
        </div>
      </li>
    </ul>

    <div v-if="editId" class="space-y-2 rounded-xl border border-brand-900/50 bg-slate-900/60 p-4">
      <p class="text-sm font-medium text-white">Edit default profile</p>
      <textarea v-model="editJson" rows="14" class="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-200" />
      <div class="flex gap-2">
        <button type="button" class="rounded bg-brand-600 px-3 py-1.5 text-xs text-white" @click="saveEdit">Save</button>
        <button type="button" class="rounded border border-slate-600 px-3 py-1.5 text-xs" @click="editId = null">Cancel</button>
      </div>
    </div>

    <div
      v-if="cloneOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="cloneOpen = false"
    >
      <div class="w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 p-4 shadow-xl">
        <h3 class="text-sm font-semibold text-white">Clone template to ride</h3>
        <label class="mt-3 block text-xs text-slate-500">
          Park
          <select v-model="cloneParkId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white">
            <option v-for="p in parks" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>
        <label class="mt-2 block text-xs text-slate-500">
          Zone
          <select v-model="cloneZoneId" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white">
            <option value="" disabled>Select</option>
            <option v-for="z in zoneOptions" :key="z.id" :value="z.id">{{ z.name }}</option>
          </select>
        </label>
        <label class="mt-2 block text-xs text-slate-500">
          Ride name
          <input v-model="cloneName" type="text" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-white" />
        </label>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded border border-slate-600 px-3 py-1.5 text-xs" @click="cloneOpen = false">Cancel</button>
          <button
            type="button"
            class="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            :disabled="cloneBusy"
            @click="doClone"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
