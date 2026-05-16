<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUser,
  type CreateAdminUserBody,
  type UpdateAdminUserBody,
} from '@/api/users'
import { ASSIGNABLE_ROLE_CODES } from '@/constants/rbac'
import { useRegionalDateTime } from '@/composables/useRegionalDateTime'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import type { AuthUser } from '@/types/auth'

const { t } = useI18n()
const dt = useRegionalDateTime()
const { push } = useToast()
const auth = useAuthStore()

const users = ref<AuthUser[]>([])
const loading = ref(false)
const saving = ref(false)
const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)

const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  roleCode: ASSIGNABLE_ROLE_CODES[0] ?? 'VIEWER',
  active: true,
})

const roleOptions = ASSIGNABLE_ROLE_CODES

type SortCol = 'name' | 'email' | 'role' | 'status' | 'createdAt'

const searchQuery = ref('')
const sortColumn = ref<SortCol | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')
const selectedUserIds = ref<string[]>([])
const selectAllCheckboxRef = ref<HTMLInputElement | null>(null)

function displayName(u: AuthUser) {
  const dn = u.displayName?.trim()
  if (dn) return dn
  return `${u.firstName} ${u.lastName}`.trim()
}

function primaryRole(u: AuthUser) {
  return u.roles?.[0] ?? '—'
}

function resetForm() {
  form.value = {
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    roleCode: ASSIGNABLE_ROLE_CODES[0] ?? 'VIEWER',
    active: true,
  }
}

async function load() {
  loading.value = true
  try {
    users.value = await listAdminUsers()
  } catch (e) {
    push(e instanceof Error ? e.message : t('userManagement.loadFailed'), 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  dialogMode.value = 'create'
  editingId.value = null
  resetForm()
  dialogOpen.value = true
}

function openEdit(u: AuthUser) {
  dialogMode.value = 'edit'
  editingId.value = u.id
  form.value = {
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    password: '',
    roleCode: u.roles?.[0] ?? ASSIGNABLE_ROLE_CODES[0] ?? 'VIEWER',
    active: u.active,
  }
  dialogOpen.value = true
}

async function saveDialog() {
  saving.value = true
  try {
    if (dialogMode.value === 'create') {
      if (!form.value.password || form.value.password.length < 8) {
        push(t('userManagement.passwordMin'), 'error')
        return
      }
      const body: CreateAdminUserBody = {
        firstName: form.value.firstName.trim(),
        lastName: form.value.lastName.trim(),
        email: form.value.email.trim(),
        password: form.value.password,
        roleCode: form.value.roleCode,
        active: form.value.active,
      }
      await createAdminUser(body)
      push(t('userManagement.created'), 'success')
    } else if (editingId.value) {
      const body: UpdateAdminUserBody = {
        firstName: form.value.firstName.trim(),
        lastName: form.value.lastName.trim(),
        email: form.value.email.trim(),
        roleCode: form.value.roleCode,
        active: form.value.active,
      }
      if (form.value.password.trim()) body.password = form.value.password
      await updateAdminUser(editingId.value, body)
      push(t('userManagement.updated'), 'success')
    }
    dialogOpen.value = false
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('userManagement.saveFailed'), 'error')
  } finally {
    saving.value = false
  }
}

async function toggleActive(u: AuthUser) {
  saving.value = true
  try {
    await updateAdminUser(u.id, { active: !u.active })
    push(t('userManagement.updated'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('userManagement.saveFailed'), 'error')
  } finally {
    saving.value = false
  }
}

async function removeUser(u: AuthUser) {
  if (u.id === auth.user?.id) {
    push(t('userManagement.selfDeleteForbidden'), 'error')
    return
  }
  const ok = globalThis.confirm(
    t('userManagement.deleteConfirm', { email: u.email, name: displayName(u) }),
  )
  if (!ok) return
  saving.value = true
  try {
    await deleteAdminUser(u.id)
    push(t('userManagement.deleted'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : t('userManagement.deleteFailed'), 'error')
  } finally {
    saving.value = false
  }
}

const canDelete = computed(() => (u: AuthUser) => u.id !== auth.user?.id)

const selectedUserIdSet = computed(() => new Set(selectedUserIds.value))

const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter((u) => {
    const name = displayName(u).toLowerCase()
    const email = u.email.toLowerCase()
    const role = primaryRole(u).toLowerCase()
    const status = u.active ? t('userManagement.statusActive') : t('userManagement.statusInactive')
    return name.includes(q) || email.includes(q) || role.includes(q) || status.toLowerCase().includes(q)
  })
})

function sortPrimitive(u: AuthUser, col: SortCol): string | number {
  switch (col) {
    case 'name':
      return displayName(u).toLowerCase()
    case 'email':
      return u.email.toLowerCase()
    case 'role':
      return primaryRole(u).toLowerCase()
    case 'status':
      return u.active ? 1 : 0
    case 'createdAt': {
      const tms = u.createdAt ? Date.parse(u.createdAt) : 0
      return Number.isNaN(tms) ? 0 : tms
    }
    default:
      return ''
  }
}

function cmpPrimitives(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

const displayedUsers = computed(() => {
  const rows = filteredUsers.value
  const col = sortColumn.value
  if (!col) return rows
  const mul = sortDir.value === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const c = cmpPrimitives(sortPrimitive(a, col), sortPrimitive(b, col))
    return (c === 0 ? a.id.localeCompare(b.id) : c) * mul
  })
})

const deletableDisplayedUsers = computed(() => displayedUsers.value.filter((u) => canDelete.value(u)))

const allDeletableDisplayedSelected = computed(() => {
  const rows = deletableDisplayedUsers.value
  if (!rows.length) return false
  const sel = selectedUserIdSet.value
  return rows.every((u) => sel.has(u.id))
})

const someDeletableDisplayedSelected = computed(() => {
  const rows = deletableDisplayedUsers.value
  if (!rows.length) return false
  const sel = selectedUserIdSet.value
  const n = rows.filter((u) => sel.has(u.id)).length
  return n > 0 && n < rows.length
})

function sortHint(col: SortCol): string {
  if (sortColumn.value !== col) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

function onSortHeader(col: SortCol) {
  if (sortColumn.value === col) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = col
    sortDir.value = col === 'createdAt' ? 'desc' : 'asc'
  }
}

function toggleUserSelection(id: string, checked: boolean) {
  const s = new Set(selectedUserIds.value)
  if (checked) s.add(id)
  else s.delete(id)
  selectedUserIds.value = [...s]
}

function toggleSelectAllDisplayed(checked: boolean) {
  if (checked) {
    const s = new Set(selectedUserIds.value)
    for (const u of deletableDisplayedUsers.value) s.add(u.id)
    selectedUserIds.value = [...s]
  } else {
    const visible = new Set(deletableDisplayedUsers.value.map((u) => u.id))
    selectedUserIds.value = selectedUserIds.value.filter((id) => !visible.has(id))
  }
}

watch(users, (list) => {
  const ok = new Set(list.map((u) => u.id))
  selectedUserIds.value = selectedUserIds.value.filter((id) => ok.has(id))
})

watch([allDeletableDisplayedSelected, someDeletableDisplayedSelected], () => {
  nextTick(() => {
    const el = selectAllCheckboxRef.value
    if (el) el.indeterminate = someDeletableDisplayedSelected.value
  })
})

async function removeSelectedUsers() {
  const ids = selectedUserIds.value.filter((id) => id !== auth.user?.id)
  if (!ids.length) return
  const ok = globalThis.confirm(t('userManagement.bulkDeleteConfirm', { n: ids.length }))
  if (!ok) return
  saving.value = true
  let deleted = 0
  let failed = 0
  try {
    for (const id of ids) {
      try {
        await deleteAdminUser(id)
        deleted += 1
      } catch {
        failed += 1
      }
    }
    selectedUserIds.value = []
    await load()
    if (deleted > 0) {
      push(t('userManagement.bulkDeleted', { n: deleted }), 'success')
    }
    if (failed > 0) {
      push(t('userManagement.bulkDeletePartial', { deleted, failed }), 'error')
    }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">{{ t('userManagement.title') }}</h1>
        <p class="mt-1 text-sm text-slate-400">{{ t('userManagement.subtitle') }}</p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          :disabled="loading"
          @click="load"
        >
          {{ t('btn.refresh') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
          @click="openCreate"
        >
          {{ t('userManagement.createUser') }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <label class="relative min-w-[220px] max-w-md flex-1">
        <span class="sr-only">{{ t('userManagement.searchLabel') }}</span>
        <input
          v-model="searchQuery"
          type="search"
          class="w-full rounded-lg border border-slate-700 bg-slate-900/80 py-2 pl-3 pr-3 text-sm text-white placeholder:text-slate-500"
          :placeholder="t('userManagement.searchPlaceholder')"
          autocomplete="off"
        />
      </label>
      <button
        v-if="selectedUserIds.length"
        type="button"
        class="rounded-lg border border-rose-700/80 bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-100 hover:bg-rose-950/55 disabled:opacity-50"
        :disabled="saving || loading"
        @click="removeSelectedUsers"
      >
        {{ t('userManagement.bulkDeleteSelectedBtn', { n: selectedUserIds.length }) }}
      </button>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
      <table class="min-w-full divide-y divide-slate-800 text-left text-sm">
        <thead class="bg-slate-950/80">
          <tr>
            <th class="w-10 px-3 py-2">
              <input
                ref="selectAllCheckboxRef"
                type="checkbox"
                class="accent-brand-500"
                :checked="allDeletableDisplayedSelected"
                :disabled="!deletableDisplayedUsers.length || loading || saving"
                :aria-label="t('userManagement.selectAll')"
                @change="toggleSelectAllDisplayed(($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th class="px-3 py-2 font-medium text-slate-400">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-200" @click="onSortHeader('name')">
                {{ t('userManagement.colName') }}
                <span class="text-[10px] text-slate-600">{{ sortHint('name') }}</span>
              </button>
            </th>
            <th class="px-3 py-2 font-medium text-slate-400">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-200" @click="onSortHeader('email')">
                {{ t('userManagement.colEmail') }}
                <span class="text-[10px] text-slate-600">{{ sortHint('email') }}</span>
              </button>
            </th>
            <th class="px-3 py-2 font-medium text-slate-400">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-200" @click="onSortHeader('role')">
                {{ t('userManagement.colRole') }}
                <span class="text-[10px] text-slate-600">{{ sortHint('role') }}</span>
              </button>
            </th>
            <th class="px-3 py-2 font-medium text-slate-400">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-200" @click="onSortHeader('status')">
                {{ t('userManagement.colStatus') }}
                <span class="text-[10px] text-slate-600">{{ sortHint('status') }}</span>
              </button>
            </th>
            <th class="px-3 py-2 font-medium text-slate-400">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-200" @click="onSortHeader('createdAt')">
                {{ t('userManagement.colCreated') }}
                <span class="text-[10px] text-slate-600">{{ sortHint('createdAt') }}</span>
              </button>
            </th>
            <th class="px-3 py-2 text-right font-medium text-slate-400">{{ t('userManagement.colActions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800/80">
          <tr v-for="u in displayedUsers" :key="u.id" class="hover:bg-slate-800/30">
            <td class="px-3 py-2">
              <input
                v-if="canDelete(u)"
                type="checkbox"
                class="accent-brand-500"
                :checked="selectedUserIdSet.has(u.id)"
                :disabled="loading || saving"
                @change="toggleUserSelection(u.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="px-3 py-2 text-slate-200">{{ displayName(u) }}</td>
            <td class="px-3 py-2 font-mono text-xs text-slate-300">{{ u.email }}</td>
            <td class="px-3 py-2">
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-brand-200">
                {{ primaryRole(u) }}
              </span>
            </td>
            <td class="px-3 py-2">
              <span
                class="inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="u.active ? 'bg-emerald-950/60 text-emerald-300' : 'bg-slate-800 text-slate-400'"
              >
                {{ u.active ? t('userManagement.statusActive') : t('userManagement.statusInactive') }}
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
              {{ u.createdAt ? dt.formatDateTime(u.createdAt) : '—' }}
            </td>
            <td class="px-3 py-2 text-right text-xs">
              <button type="button" class="mr-2 text-brand-400 hover:underline" @click="openEdit(u)">
                {{ t('userManagement.edit') }}
              </button>
              <button
                type="button"
                class="mr-2 text-slate-300 hover:underline"
                :disabled="saving"
                @click="toggleActive(u)"
              >
                {{ u.active ? t('userManagement.deactivate') : t('userManagement.activate') }}
              </button>
              <button
                v-if="canDelete(u)"
                type="button"
                class="text-rose-400 hover:underline disabled:opacity-40"
                :disabled="saving"
                @click="removeUser(u)"
              >
                {{ t('userManagement.delete') }}
              </button>
              <span v-else class="text-[10px] text-slate-600">{{ t('userManagement.currentUser') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!displayedUsers.length && !loading" class="py-10 text-center text-sm text-slate-500">
        {{ users.length && searchQuery.trim() ? t('userManagement.noSearchResults') : t('userManagement.empty') }}
      </p>
    </div>

    <Teleport to="body">
      <div
        v-if="dialogOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        @click.self="dialogOpen = false"
      >
        <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
          <h2 class="text-sm font-semibold text-white">
            {{ dialogMode === 'create' ? t('userManagement.createUser') : t('userManagement.editUser') }}
          </h2>
          <div class="mt-3 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <label class="block text-xs text-slate-500">
                {{ t('userManagement.firstName') }}
                <input
                  v-model="form.firstName"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                  autocomplete="given-name"
                />
              </label>
              <label class="block text-xs text-slate-500">
                {{ t('userManagement.lastName') }}
                <input
                  v-model="form.lastName"
                  class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                  autocomplete="family-name"
                />
              </label>
            </div>
            <label class="block text-xs text-slate-500">
              {{ t('userManagement.colEmail') }}
              <input
                v-model="form.email"
                type="email"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                autocomplete="email"
              />
            </label>
            <label class="block text-xs text-slate-500">
              {{ t('userManagement.password') }}
              <input
                v-model="form.password"
                type="password"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
                :placeholder="dialogMode === 'edit' ? t('userManagement.passwordOptional') : ''"
                autocomplete="new-password"
              />
            </label>
            <label class="block text-xs text-slate-500">
              {{ t('userManagement.colRole') }}
              <select
                v-model="form.roleCode"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
              >
                <option v-for="code in roleOptions" :key="code" :value="code">{{ code }}</option>
              </select>
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
              <input v-model="form.active" type="checkbox" class="rounded border-slate-600" />
              {{ t('userManagement.statusActive') }}
            </label>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300"
              @click="dialogOpen = false"
            >
              {{ t('btn.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              :disabled="saving || !form.firstName.trim() || !form.lastName.trim() || !form.email.trim()"
              @click="saveDialog"
            >
              {{ saving ? '…' : t('btn.save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
