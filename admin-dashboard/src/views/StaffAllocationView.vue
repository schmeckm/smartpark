<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  createStaff,
  deleteStaffMember,
  exportStaffBundle,
  exportStaffXlsxBlob,
  getRides,
  getStaff,
  getZones,
  importStaffBundle,
  importStaffXlsx,
  updateStaffMember,
  type StaffWritePayload,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'
import type { Ride, Staff, StaffRole, Zone } from '@/types/api'
import { utcDateStampForFilename } from '@/utils/dateTime'

const RESOURCE = 'staff'
const auth = useAuthStore()
const { push: toast } = useToast()
const { t } = useI18n()

const ROLES: StaffRole[] = [
  'FOOD_SERVICE',
  'RIDE_OPERATOR',
  'CLEANING',
  'SECURITY',
  'GUEST_SERVICE',
]

const ROLE_LABEL: Record<StaffRole, string> = {
  FOOD_SERVICE: 'Food service',
  RIDE_OPERATOR: 'Ride operator',
  CLEANING: 'Cleaning',
  SECURITY: 'Security',
  GUEST_SERVICE: 'Guest service',
}

const ROLE_BADGE: Record<StaffRole, string> = {
  RIDE_OPERATOR: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  FOOD_SERVICE: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  CLEANING: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  SECURITY: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  GUEST_SERVICE: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
}

type AssignmentMode = 'none' | 'zone' | 'ride'

const FORM_DEFAULTS = {
  employeeNumber: '',
  firstName: '',
  lastName: '',
  role: 'RIDE_OPERATOR' as StaffRole,
  supervisorId: '',
  assignmentMode: 'none' as AssignmentMode,
  currentZoneId: '',
  currentRideId: '',
  available: true,
  skillLevel: 1,
}

const rows = ref<Staff[]>([])
const zones = ref<Zone[]>([])
const rides = ref<Ride[]>([])
const loading = reactive({ list: false, save: false, io: false })
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const openMenuId = ref<string | null>(null)

const filterText = ref('')
const filterRole = ref<StaffRole | ''>('')
const filterZone = ref('')
const filterRide = ref('')
const filterAvailability = ref<'all' | 'yes' | 'no'>('all')

const form = reactive({ ...FORM_DEFAULTS })

const jsonInput = ref<HTMLInputElement | null>(null)
const xlsxInput = ref<HTMLInputElement | null>(null)

const perms = computed(() => ({
  read: auth.hasPermission(RESOURCE, 'read'),
  create: auth.hasPermission(RESOURCE, 'create'),
  update: auth.hasPermission(RESOURCE, 'update'),
  delete: auth.hasPermission(RESOURCE, 'delete'),
}))
const canImport = computed(() => perms.value.create || perms.value.update)

const staffById = computed(() => new Map(rows.value.map((r) => [r.id, r])))
const ridesById = computed(() => new Map(rides.value.map((r) => [r.id, r])))

// Auto-hide columns that hold no data anywhere in the dataset.
const hasEmployeeNumberColumn = computed(() => rows.value.some((r) => !!r.employeeNumber))
const hasSupervisorColumn = computed(() =>
  rows.value.some((r) => !!(r.supervisor || r.supervisorId))
)

const sortedRidesGrouped = computed(() => {
  const byZone = new Map<string, Ride[]>()
  for (const r of rides.value) {
    if (!byZone.has(r.zoneId)) byZone.set(r.zoneId, [])
    byZone.get(r.zoneId)!.push(r)
  }
  for (const list of byZone.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }
  const zoneOrder = [...zones.value].sort((a, b) => a.name.localeCompare(b.name))
  return zoneOrder
    .map((z) => ({ zone: z, rides: byZone.get(z.id) ?? [] }))
    .filter((g) => g.rides.length > 0)
})

const supervisorCandidates = computed(() => {
  const selfId = editingId.value
  return [...rows.value]
    .filter((r) => !selfId || r.id !== selfId)
    .sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, undefined, {
        sensitivity: 'base',
      })
    )
})

const filteredRows = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (q && !`${r.firstName} ${r.lastName} ${r.employeeNumber ?? ''}`.toLowerCase().includes(q))
      return false
    if (filterRole.value && r.role !== filterRole.value) return false
    if (filterZone.value && r.currentZoneId !== filterZone.value) return false
    if (filterRide.value && r.currentRideId !== filterRide.value) return false
    if (filterAvailability.value === 'yes' && !r.available) return false
    if (filterAvailability.value === 'no' && r.available) return false
    return true
  })
})

const filtersActive = computed(
  () =>
    !!filterText.value ||
    !!filterRole.value ||
    !!filterZone.value ||
    !!filterRide.value ||
    filterAvailability.value !== 'all'
)

function clearFilters() {
  filterText.value = ''
  filterRole.value = ''
  filterZone.value = ''
  filterRide.value = ''
  filterAvailability.value = 'all'
}

function zoneLabel(id: string | null) {
  if (!id) return '—'
  return zones.value.find((x) => x.id === id)?.name ?? id.slice(0, 8) + '…'
}

function rideLabel(s: Staff): string | null {
  if (s.currentRide) return s.currentRide.name
  if (s.currentRideId) return ridesById.value.get(s.currentRideId)?.name ?? null
  return null
}

function supervisorDisplay(s: Staff): string {
  const sup = s.supervisor ?? (s.supervisorId ? staffById.value.get(s.supervisorId) : null)
  if (!sup) return s.supervisorId ? s.supervisorId.slice(0, 8) + '…' : '—'
  const num = sup.employeeNumber ? ` (${sup.employeeNumber})` : ''
  return `${sup.firstName} ${sup.lastName}${num}`
}

function detectAssignmentMode(s: Staff): AssignmentMode {
  if (s.currentRideId) return 'ride'
  if (s.currentZoneId) return 'zone'
  return 'none'
}

function staffToForm(s: Staff): typeof FORM_DEFAULTS {
  const assignmentMode = detectAssignmentMode(s)
  return {
    employeeNumber: s.employeeNumber ?? '',
    firstName: s.firstName,
    lastName: s.lastName,
    role: s.role,
    supervisorId: s.supervisorId || '',
    assignmentMode,
    currentZoneId: s.currentZoneId || '',
    currentRideId: s.currentRideId || '',
    available: s.available,
    skillLevel: s.skillLevel,
  }
}

function resetForm() {
  Object.assign(form, FORM_DEFAULTS)
  editingId.value = null
}

function openCreate() {
  resetForm()
  dialogOpen.value = true
}

function openEdit(s: Staff) {
  Object.assign(form, staffToForm(s))
  editingId.value = s.id
  dialogOpen.value = true
  openMenuId.value = null
}

function closeDialog() {
  dialogOpen.value = false
  resetForm()
}

async function load() {
  loading.list = true
  try {
    const [s, z, r] = await Promise.all([getStaff(), getZones(), getRides()])
    rows.value = s
    zones.value = z
    rides.value = r
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load staff', 'error')
  } finally {
    loading.list = false
  }
}

function buildPayload(): StaffWritePayload {
  const num = form.employeeNumber.trim()
  const sup = form.supervisorId.trim()
  const zoneId = form.assignmentMode === 'zone' ? form.currentZoneId || null : null
  const rideId = form.assignmentMode === 'ride' ? form.currentRideId || null : null
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    employeeNumber: num || null,
    role: form.role,
    supervisorId: sup || null,
    currentZoneId: zoneId,
    currentRideId: rideId,
    available: form.available,
    skillLevel: form.skillLevel,
  }
}

async function save() {
  if (!form.firstName.trim() || !form.lastName.trim()) {
    toast('First and last name are required', 'error')
    return
  }
  loading.save = true
  try {
    if (editingId.value) {
      if (!perms.value.update) return
      await updateStaffMember(editingId.value, buildPayload())
      toast('Staff updated', 'success')
    } else {
      if (!perms.value.create) return
      await createStaff(buildPayload())
      toast('Staff created', 'success')
    }
    closeDialog()
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    loading.save = false
  }
}

async function remove(id: string) {
  if (!perms.value.delete) return
  openMenuId.value = null
  const ok = await askConfirm({
    message: 'Remove this staff member from the roster?',
    confirmLabel: 'Yes',
    cancelLabel: 'Cancel',
    variant: 'danger',
  })
  if (!ok) return
  try {
    await deleteStaffMember(id)
    toast('Staff removed', 'success')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Delete failed', 'error')
  }
}

// ---- I/O helpers --------------------------------------------------------

function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

async function withIo(fn: () => Promise<void>) {
  loading.io = true
  try {
    await fn()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'I/O failed', 'error')
  } finally {
    loading.io = false
  }
}

function pickJson() {
  jsonInput.value?.click()
}
function pickXlsx() {
  xlsxInput.value?.click()
}

async function downloadStaffJson() {
  await withIo(async () => {
    const data = await exportStaffBundle()
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    saveBlob(blob, `staff-roster-${utcDateStampForFilename()}.json`)
    toast(`Exported ${data.totalExported} row(s).`, 'success')
  })
}

async function downloadStaffExcel() {
  await withIo(async () => {
    const blob = await exportStaffXlsxBlob()
    saveBlob(blob, `staff-roster-${utcDateStampForFilename()}.xlsx`)
    toast('Excel export downloaded.', 'success')
  })
}

async function onJsonImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !canImport.value) return
  await withIo(async () => {
    const text = await file.text()
    const json = JSON.parse(text) as {
      schemaVersion?: number
      items?: Array<StaffWritePayload & { id?: string }>
    }
    if (!json.items || !Array.isArray(json.items)) {
      toast('File must contain an "items" array.', 'error')
      return
    }
    const res = await importStaffBundle({
      schemaVersion: json.schemaVersion === 1 ? 1 : undefined,
      items: json.items,
    })
    toast(
      `Import finished: ${res.appliedCount} applied, ${res.failedCount} failed.`,
      res.failedCount ? 'error' : 'success'
    )
    if (res.failedCount && res.failed.length) console.warn('Staff import failures', res.failed)
    await load()
  })
}

async function onXlsxImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !canImport.value) return
  await withIo(async () => {
    const res = await importStaffXlsx(file)
    toast(
      `Excel import: ${res.appliedCount} applied, ${res.failedCount} failed.`,
      res.failedCount ? 'error' : 'success'
    )
    if (res.failedCount && res.failed.length) console.warn('Staff Excel import failures', res.failed)
    await load()
  })
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <RouterLink class="text-xs text-brand-400 hover:text-brand-300" to="/">← Operations</RouterLink>
        <h1 class="mt-2 font-display text-xl font-semibold text-white">{{ t('menu.staffAllocation') }}</h1>
        <p class="mt-1 text-sm text-slate-400">
          Roster used by the operations dashboard (zones, availability, roles).
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500"
          :disabled="loading.list"
          @click="load"
        >
          Refresh
        </button>

        <details
          v-if="perms.read || canImport"
          class="relative"
          @toggle="openMenuId = null"
        >
          <summary
            class="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 [&::-webkit-details-marker]:hidden"
            :class="loading.io ? 'opacity-60' : ''"
          >
            Import / Export
            <span aria-hidden="true">▾</span>
          </summary>
          <div
            class="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-700 bg-slate-950 p-1 shadow-xl"
            role="menu"
          >
            <button
              v-if="perms.read"
              type="button"
              role="menuitem"
              class="block w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              :disabled="loading.io"
              @click="void downloadStaffExcel()"
            >
              Download Excel (.xlsx)
            </button>
            <button
              v-if="canImport"
              type="button"
              role="menuitem"
              class="block w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              :disabled="loading.io"
              @click="pickXlsx()"
            >
              Upload Excel (.xlsx)
            </button>
            <div class="my-1 border-t border-slate-800"></div>
            <button
              v-if="perms.read"
              type="button"
              role="menuitem"
              class="block w-full rounded px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50"
              :disabled="loading.io"
              title="Raw JSON dump (developer)"
              @click="void downloadStaffJson()"
            >
              Download JSON
            </button>
            <button
              v-if="canImport"
              type="button"
              role="menuitem"
              class="block w-full rounded px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50"
              :disabled="loading.io"
              title="Upload JSON with items[]"
              @click="pickJson()"
            >
              Upload JSON
            </button>
          </div>
        </details>

        <input
          ref="jsonInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="void onJsonImportFile($event)"
        />
        <input
          ref="xlsxInput"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="hidden"
          @change="void onXlsxImportFile($event)"
        />

        <button
          v-if="perms.create"
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
          @click="openCreate"
        >
          Add staff
        </button>
      </div>
    </div>

    <div
      class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2"
    >
      <input
        v-model="filterText"
        type="search"
        placeholder="Search name or employee #…"
        class="min-w-[14rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
      />
      <select
        v-model="filterRole"
        class="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"
      >
        <option value="">All roles</option>
        <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
      </select>
      <select
        v-model="filterZone"
        class="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"
      >
        <option value="">All zones</option>
        <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
      </select>
      <select
        v-if="rides.length"
        v-model="filterRide"
        class="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"
      >
        <option value="">All rides / shows</option>
        <optgroup
          v-for="g in sortedRidesGrouped"
          :key="g.zone.id"
          :label="g.zone.name"
        >
          <option v-for="r in g.rides" :key="r.id" :value="r.id">{{ r.name }}</option>
        </optgroup>
      </select>
      <select
        v-model="filterAvailability"
        class="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white"
      >
        <option value="all">Availability: any</option>
        <option value="yes">Available only</option>
        <option value="no">Unavailable only</option>
      </select>
      <button
        v-if="filtersActive"
        type="button"
        class="text-xs text-brand-400 hover:text-brand-300"
        @click="clearFilters"
      >
        Clear filters
      </button>
      <span class="ml-auto text-xs tabular-nums text-slate-500">
        {{ filteredRows.length }} / {{ rows.length }}
      </span>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-950/80">
          <tr>
            <th
              v-if="hasEmployeeNumberColumn"
              class="whitespace-nowrap px-4 py-3 font-medium text-slate-400"
            >
              Personalnr.
            </th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Name</th>
            <th
              v-if="hasSupervisorColumn"
              class="min-w-[10rem] whitespace-nowrap px-4 py-3 font-medium text-slate-400"
            >
              Supervisor
            </th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Role</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Assignment</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Status</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Skill</th>
            <th class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-400"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          <tr v-for="s in filteredRows" :key="s.id" class="bg-slate-900/20">
            <td
              v-if="hasEmployeeNumberColumn"
              class="px-4 py-3 font-mono text-xs text-slate-300"
            >
              {{ s.employeeNumber || '—' }}
            </td>
            <td class="px-4 py-3 font-medium text-white">{{ s.firstName }} {{ s.lastName }}</td>
            <td
              v-if="hasSupervisorColumn"
              class="max-w-[14rem] truncate px-4 py-3 text-xs text-slate-300"
              :title="supervisorDisplay(s)"
            >
              {{ supervisorDisplay(s) }}
            </td>
            <td class="px-4 py-3">
              <span
                class="inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
                :class="ROLE_BADGE[s.role]"
              >
                {{ ROLE_LABEL[s.role] }}
              </span>
            </td>
            <td class="px-4 py-3 text-slate-300">
              <template v-if="rideLabel(s)">
                <div class="text-white">{{ rideLabel(s) }}</div>
                <div class="text-[11px] text-slate-500">{{ zoneLabel(s.currentZoneId) }}</div>
              </template>
              <template v-else>
                {{ zoneLabel(s.currentZoneId) }}
              </template>
            </td>
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center gap-1.5 text-xs"
                :class="s.available ? 'text-emerald-300' : 'text-slate-500'"
              >
                <span
                  class="h-2 w-2 rounded-full"
                  :class="s.available ? 'bg-emerald-400' : 'bg-slate-500'"
                  aria-hidden="true"
                ></span>
                {{ s.available ? 'Available' : 'Unavailable' }}
              </span>
            </td>
            <td class="px-4 py-3" :title="`Skill ${s.skillLevel} of 5`">
              <span class="inline-flex items-center gap-0.5" aria-hidden="true">
                <span
                  v-for="i in 5"
                  :key="i"
                  class="h-1.5 w-1.5 rounded-full"
                  :class="i <= s.skillLevel ? 'bg-brand-400' : 'bg-slate-700'"
                ></span>
              </span>
              <span class="sr-only">Skill {{ s.skillLevel }} of 5</span>
            </td>
            <td class="px-4 py-3 text-right">
              <details
                v-if="perms.update || perms.delete"
                class="relative inline-block text-left"
                :open="openMenuId === s.id"
                @toggle="(e) => { if ((e.target as HTMLDetailsElement).open) openMenuId = s.id; else if (openMenuId === s.id) openMenuId = null }"
              >
                <summary
                  class="cursor-pointer list-none rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 [&::-webkit-details-marker]:hidden"
                  :aria-label="`Actions for ${s.firstName} ${s.lastName}`"
                >
                  ⋯
                </summary>
                <div
                  class="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-slate-700 bg-slate-950 p-1 text-left shadow-xl"
                  role="menu"
                >
                  <button
                    v-if="perms.update"
                    type="button"
                    role="menuitem"
                    class="block w-full rounded px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                    @click="openEdit(s)"
                  >
                    Edit
                  </button>
                  <button
                    v-if="perms.delete"
                    type="button"
                    role="menuitem"
                    class="block w-full rounded px-3 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-950/40"
                    @click="remove(s.id)"
                  >
                    Delete
                  </button>
                </div>
              </details>
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="!loading.list && !rows.length"
        class="px-4 py-8 text-center text-sm text-slate-500"
      >
        No staff yet.
      </p>
      <p
        v-else-if="!loading.list && !filteredRows.length"
        class="px-4 py-8 text-center text-sm text-slate-500"
      >
        No staff match the current filters.
      </p>
      <p v-if="loading.list" class="px-4 py-6 text-center text-xs text-slate-500">Loading…</p>
    </div>

    <Teleport to="body">
      <div
        v-if="dialogOpen"
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
        role="dialog"
        aria-modal="true"
        @click.self="closeDialog"
      >
        <div
          class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl"
          @click.stop
        >
          <h2 class="font-display text-lg font-semibold text-white">
            {{ editingId ? 'Edit staff' : 'Add staff' }}
          </h2>
          <div class="mt-4 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-xs text-slate-400">
                First name
                <input
                  v-model="form.firstName"
                  type="text"
                  class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
              <label class="block text-xs text-slate-400">
                Last name
                <input
                  v-model="form.lastName"
                  type="text"
                  class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
            <label class="block text-xs text-slate-400">
              Employee number
              <input
                v-model="form.employeeNumber"
                type="text"
                autocomplete="off"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white"
                placeholder="e.g. 10042"
              />
            </label>
            <label class="block text-xs text-slate-400">
              Supervisor / People Manager
              <select
                v-model="form.supervisorId"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">— None —</option>
                <option v-for="p in supervisorCandidates" :key="p.id" :value="p.id">
                  {{ p.lastName }}, {{ p.firstName
                  }}{{ p.employeeNumber ? ` (${p.employeeNumber})` : '' }}
                </option>
              </select>
            </label>
            <label class="block text-xs text-slate-400">
              Role
              <select
                v-model="form.role"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABEL[r] }}</option>
              </select>
            </label>
            <fieldset class="rounded-lg border border-slate-800 p-3">
              <legend class="px-1 text-xs text-slate-400">Assignment</legend>
              <div class="flex flex-wrap gap-3 text-xs text-slate-300">
                <label class="inline-flex items-center gap-1">
                  <input
                    v-model="form.assignmentMode"
                    type="radio"
                    value="none"
                    class="text-brand-500"
                  />
                  Unassigned
                </label>
                <label class="inline-flex items-center gap-1">
                  <input
                    v-model="form.assignmentMode"
                    type="radio"
                    value="zone"
                    class="text-brand-500"
                  />
                  Zone
                </label>
                <label class="inline-flex items-center gap-1">
                  <input
                    v-model="form.assignmentMode"
                    type="radio"
                    value="ride"
                    :disabled="!rides.length"
                    class="text-brand-500"
                  />
                  Ride / Show / Attraction
                </label>
              </div>
              <select
                v-if="form.assignmentMode === 'zone'"
                v-model="form.currentZoneId"
                class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">— Select zone —</option>
                <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
              <select
                v-else-if="form.assignmentMode === 'ride'"
                v-model="form.currentRideId"
                class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">— Select ride / show —</option>
                <optgroup
                  v-for="g in sortedRidesGrouped"
                  :key="g.zone.id"
                  :label="g.zone.name"
                >
                  <option v-for="r in g.rides" :key="r.id" :value="r.id">{{ r.name }}</option>
                </optgroup>
              </select>
              <p
                v-if="form.assignmentMode === 'ride'"
                class="mt-2 text-[11px] text-slate-500"
              >
                Zone is derived automatically from the selected ride / show.
              </p>
            </fieldset>
            <div>
              <span class="text-xs text-slate-400">Skill level</span>
              <div class="mt-1 flex items-center gap-1">
                <button
                  v-for="i in 5"
                  :key="i"
                  type="button"
                  class="h-7 w-7 rounded border text-xs"
                  :class="
                    i <= form.skillLevel
                      ? 'border-brand-500 bg-brand-500/20 text-brand-200'
                      : 'border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-500'
                  "
                  @click="form.skillLevel = i"
                >
                  {{ i }}
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2 text-xs text-slate-300">
              <input v-model="form.available" type="checkbox" class="rounded border-slate-600" />
              Available for assignment
            </label>
          </div>
          <div class="mt-6 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
              @click="closeDialog"
            >
              Cancel
            </button>
            <button
              type="button"
              class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              :disabled="loading.save"
              @click="save"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
