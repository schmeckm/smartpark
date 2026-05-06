<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  createStaff,
  deleteStaffMember,
  exportStaffBundle,
  exportStaffXlsxBlob,
  getStaff,
  getZones,
  importStaffBundle,
  importStaffXlsx,
  updateStaffMember,
  type StaffWritePayload,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import type { Staff, StaffRole, Zone } from '@/types/api'
import { utcDateStampForFilename } from '@/utils/dateTime'

const auth = useAuthStore()
const { push: toast } = useToast()

const ROLES: StaffRole[] = [
  'FOOD_SERVICE',
  'RIDE_OPERATOR',
  'CLEANING',
  'SECURITY',
  'GUEST_SERVICE',
]

const rows = ref<Staff[]>([])
const zones = ref<Zone[]>([])
const busy = ref(false)
const saving = ref(false)
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  employeeNumber: '',
  firstName: '',
  lastName: '',
  role: 'RIDE_OPERATOR' as StaffRole,
  supervisorId: '' as string,
  currentZoneId: '' as string,
  available: true,
  skillLevel: 1,
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

const canCreate = computed(() => auth.hasPermission('staff', 'create'))
const canUpdate = computed(() => auth.hasPermission('staff', 'update'))
const canDelete = computed(() => auth.hasPermission('staff', 'delete'))
const canExport = computed(() => auth.hasPermission('staff', 'read'))
const canImport = computed(
  () => auth.hasPermission('staff', 'update') || auth.hasPermission('staff', 'create')
)

const exportImportBusy = ref(false)
const staffJsonImportInput = ref<HTMLInputElement | null>(null)
const staffExcelImportInput = ref<HTMLInputElement | null>(null)

function zoneLabel(id: string | null) {
  if (!id) return '—'
  const z = zones.value.find((x) => x.id === id)
  return z?.name ?? id.slice(0, 8) + '…'
}

function supervisorDisplay(s: Staff): string {
  if (s.supervisor) {
    const num = s.supervisor.employeeNumber ? ` (${s.supervisor.employeeNumber})` : ''
    return `${s.supervisor.firstName} ${s.supervisor.lastName}${num}`
  }
  if (s.supervisorId) {
    const x = rows.value.find((r) => r.id === s.supervisorId)
    if (x) {
      const num = x.employeeNumber ? ` (${x.employeeNumber})` : ''
      return `${x.firstName} ${x.lastName}${num}`
    }
    return s.supervisorId.slice(0, 8) + '…'
  }
  return '—'
}

function resetForm() {
  form.employeeNumber = ''
  form.firstName = ''
  form.lastName = ''
  form.role = 'RIDE_OPERATOR'
  form.supervisorId = ''
  form.currentZoneId = ''
  form.available = true
  form.skillLevel = 1
  editingId.value = null
}

function openCreate() {
  resetForm()
  dialogOpen.value = true
}

function openEdit(s: Staff) {
  editingId.value = s.id
  form.employeeNumber = s.employeeNumber ?? ''
  form.firstName = s.firstName
  form.lastName = s.lastName
  form.role = s.role
  form.supervisorId = s.supervisorId || ''
  form.currentZoneId = s.currentZoneId || ''
  form.available = s.available
  form.skillLevel = s.skillLevel
  dialogOpen.value = true
}

function closeDialog() {
  dialogOpen.value = false
  resetForm()
}

async function load() {
  busy.value = true
  try {
    const [s, z] = await Promise.all([getStaff(), getZones()])
    rows.value = s
    zones.value = z
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Failed to load staff', 'error')
  } finally {
    busy.value = false
  }
}

function buildPayload(): StaffWritePayload {
  const num = form.employeeNumber.trim()
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    employeeNumber: num ? num : null,
    role: form.role,
    supervisorId: form.supervisorId.trim() ? form.supervisorId.trim() : null,
    currentZoneId: form.currentZoneId || null,
    available: form.available,
    skillLevel: form.skillLevel,
  }
}

async function save() {
  if (!form.firstName.trim() || !form.lastName.trim()) {
    toast('First and last name are required', 'error')
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      if (!canUpdate.value) return
      await updateStaffMember(editingId.value, buildPayload())
      toast('Staff updated', 'success')
    } else {
      if (!canCreate.value) return
      await createStaff(buildPayload())
      toast('Staff created', 'success')
    }
    closeDialog()
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}

async function remove(id: string) {
  if (!canDelete.value) return
  if (!confirm('Remove this staff member from the roster?')) return
  try {
    await deleteStaffMember(id)
    toast('Staff removed', 'success')
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Delete failed', 'error')
  }
}

async function downloadStaffJson() {
  exportImportBusy.value = true
  try {
    const data = await exportStaffBundle()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `staff-roster-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`Exported ${data.totalExported} row(s).`, 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Export failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

function triggerStaffJsonImportPick() {
  staffJsonImportInput.value?.click()
}

async function onStaffJsonImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !canImport.value) return
  exportImportBusy.value = true
  try {
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
    const msg = `Import finished: ${res.appliedCount} applied, ${res.failedCount} failed.`
    toast(msg, res.failedCount ? 'error' : 'success')
    if (res.failedCount && res.failed.length) console.warn('Staff import failures', res.failed)
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Import failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

async function downloadStaffExcel() {
  exportImportBusy.value = true
  try {
    const blob = await exportStaffXlsxBlob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `staff-roster-${utcDateStampForFilename()}.xlsx`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('Excel export downloaded.', 'success')
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Excel export failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
}

function triggerStaffExcelImportPick() {
  staffExcelImportInput.value?.click()
}

async function onStaffExcelImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !canImport.value) return
  exportImportBusy.value = true
  try {
    const res = await importStaffXlsx(file)
    const msg = `Excel import: ${res.appliedCount} applied, ${res.failedCount} failed.`
    toast(msg, res.failedCount ? 'error' : 'success')
    if (res.failedCount && res.failed.length) console.warn('Staff Excel import failures', res.failed)
    await load()
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Excel import failed', 'error')
  } finally {
    exportImportBusy.value = false
  }
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
        <h1 class="mt-2 font-display text-xl font-semibold text-white">Staff allocation</h1>
        <p class="mt-1 text-sm text-slate-400">
          Roster used by the operations dashboard (zones, availability, roles).
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500"
          :disabled="busy"
          @click="load"
        >
          Refresh
        </button>
        <button
          v-if="canExport"
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          :disabled="exportImportBusy"
          title="Download roster as JSON (same shape as upload)"
          @click="void downloadStaffJson()"
        >
          Download JSON
        </button>
        <input
          ref="staffJsonImportInput"
          type="file"
          accept="application/json,.json"
          class="hidden"
          @change="void onStaffJsonImportFile($event)"
        />
        <button
          v-if="canImport"
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          :disabled="exportImportBusy"
          title="Upload JSON with items[] — rows with id update, without id create"
          @click="triggerStaffJsonImportPick()"
        >
          Upload JSON
        </button>
        <button
          v-if="canExport"
          type="button"
          class="rounded-lg border border-emerald-700/80 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
          :disabled="exportImportBusy"
          title="Download Excel (.xlsx), sheet Staff"
          @click="void downloadStaffExcel()"
        >
          Download Excel
        </button>
        <input
          ref="staffExcelImportInput"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="hidden"
          @change="void onStaffExcelImportFile($event)"
        />
        <button
          v-if="canImport"
          type="button"
          class="rounded-lg border border-emerald-700/80 bg-emerald-950/40 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
          :disabled="exportImportBusy"
          title="Upload edited Excel; field name file"
          @click="triggerStaffExcelImportPick()"
        >
          Upload Excel
        </button>
        <button
          v-if="canCreate"
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
          @click="openCreate"
        >
          Add staff
        </button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-950/80">
          <tr>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Personalnr.</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Name</th>
            <th class="min-w-[10rem] whitespace-nowrap px-4 py-3 font-medium text-slate-400">
              Supervisor / People Manager
            </th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Role</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Zone</th>
            <th class="whitespace-nowrap px-4 py-3 font-medium text-slate-400">Available</th>
            <th class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-400">Skill</th>
            <th class="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-400">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          <tr v-for="s in rows" :key="s.id" class="bg-slate-900/20">
            <td class="px-4 py-3 font-mono text-xs text-slate-300">{{ s.employeeNumber || '—' }}</td>
            <td class="px-4 py-3 font-medium text-white">{{ s.firstName }} {{ s.lastName }}</td>
            <td class="max-w-[14rem] truncate px-4 py-3 text-xs text-slate-300" :title="supervisorDisplay(s)">
              {{ supervisorDisplay(s) }}
            </td>
            <td class="px-4 py-3 text-slate-300">{{ s.role }}</td>
            <td class="px-4 py-3 text-slate-300">{{ zoneLabel(s.currentZoneId) }}</td>
            <td class="px-4 py-3">
              <span
                class="inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset"
                :class="
                  s.available
                    ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                    : 'bg-slate-600/40 text-slate-300 ring-slate-500/30'
                "
              >
                {{ s.available ? 'Yes' : 'No' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right tabular-nums text-slate-300">{{ s.skillLevel }}</td>
            <td class="px-4 py-3 text-right">
              <button
                v-if="canUpdate"
                type="button"
                class="mr-2 text-xs text-brand-400 hover:text-brand-300"
                @click="openEdit(s)"
              >
                Edit
              </button>
              <button
                v-if="canDelete"
                type="button"
                class="text-xs text-rose-400 hover:text-rose-300"
                @click="remove(s.id)"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!busy && !rows.length" class="px-4 py-8 text-center text-sm text-slate-500">No staff yet.</p>
      <p v-if="busy" class="px-4 py-6 text-center text-xs text-slate-500">Loading…</p>
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
            <label class="block text-xs text-slate-400">
              Personalnummer
              <input
                v-model="form.employeeNumber"
                type="text"
                autocomplete="off"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white"
                placeholder="z. B. 10042"
              />
            </label>
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
            <label class="block text-xs text-slate-400">
              Supervisor / People Manager
              <select
                v-model="form.supervisorId"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">— Keine Zuordnung —</option>
                <option v-for="p in supervisorCandidates" :key="p.id" :value="p.id">
                  {{ p.lastName }}, {{ p.firstName }}{{ p.employeeNumber ? ` (${p.employeeNumber})` : '' }}
                </option>
              </select>
            </label>
            <label class="block text-xs text-slate-400">
              Role
              <select
                v-model="form.role"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <label class="block text-xs text-slate-400">
              Current zone
              <select
                v-model="form.currentZoneId"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              >
                <option value="">— None —</option>
                <option v-for="z in zones" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </label>
            <label class="flex items-center gap-2 text-xs text-slate-400">
              <input v-model="form.available" type="checkbox" class="rounded border-slate-600" />
              Available for assignment
            </label>
            <label class="block text-xs text-slate-400">
              Skill level (1–5)
              <input
                v-model.number="form.skillLevel"
                type="number"
                min="1"
                max="5"
                class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              />
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
              :disabled="saving"
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
