<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  listSignalCatalog,
  createSignalCatalog,
  patchSignalCatalog,
  deleteSignalCatalog,
  type SignalCatalogAdminRow,
} from '@/api/client'
import { useToast } from '@/composables/useToast'
import { askConfirm } from '@/composables/useConfirmDialog'

const { push } = useToast()

const loading = ref(false)
const rows = ref<SignalCatalogAdminRow[]>([])
const operatorOnly = ref(false)

const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const form = ref({
  signalCode: '',
  label: '',
  description: '',
  unit: '',
  category: '',
})
const saving = ref(false)

const filteredRows = computed(() => {
  if (!operatorOnly.value) return rows.value
  return rows.value.filter((r) => r.registrySource === 'OPERATOR_CONFIGURED')
})

async function load() {
  loading.value = true
  try {
    const data = await listSignalCatalog()
    rows.value = data.signals ?? []
  } catch (e) {
    push(e instanceof Error ? e.message : 'Load failed', 'error')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  dialogMode.value = 'create'
  editingId.value = null
  form.value = { signalCode: '', label: '', description: '', unit: '', category: '' }
  dialogOpen.value = true
}

function openEdit(r: SignalCatalogAdminRow) {
  if (r.readOnly) return
  dialogMode.value = 'edit'
  editingId.value = r.id
  form.value = {
    signalCode: r.signalCode,
    label: r.label || '',
    description: r.description || '',
    unit: r.unit || '',
    category: r.category || '',
  }
  dialogOpen.value = true
}

async function saveDialog() {
  saving.value = true
  try {
    if (dialogMode.value === 'create') {
      await createSignalCatalog({
        signalCode: form.value.signalCode.trim(),
        label: form.value.label.trim() || null,
        description: form.value.description.trim() || null,
        unit: form.value.unit.trim() || null,
        category: form.value.category.trim() || null,
      })
      push('Signal angelegt.', 'success')
    } else if (editingId.value) {
      await patchSignalCatalog(editingId.value, {
        signalCode: form.value.signalCode.trim(),
        label: form.value.label.trim() || null,
        description: form.value.description.trim() || null,
        unit: form.value.unit.trim() || null,
        category: form.value.category.trim() || null,
      })
      push('Signal gespeichert.', 'success')
    }
    dialogOpen.value = false
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}

async function removeRow(r: SignalCatalogAdminRow) {
  if (r.readOnly) return
  const ok = await askConfirm({
    title: 'Signal löschen?',
    message: `Katalog-Eintrag „${r.signalCode}“ unwiderruflich löschen?`,
    variant: 'danger',
    confirmLabel: 'Löschen',
    cancelLabel: 'Abbrechen',
  })
  if (!ok) return
  try {
    await deleteSignalCatalog(r.id)
    push('Gelöscht.', 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Delete failed', 'error')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 px-4 py-6 text-slate-200">
    <nav class="text-xs text-slate-500">
      <RouterLink :to="{ name: 'master-data', params: { entityType: 'rides' } }" class="text-brand-400 hover:underline">
        Master Data
      </RouterLink>
      <span class="mx-1">/</span>
      <span class="text-slate-400">Signal-Katalog</span>
    </nav>

    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-display text-xl font-semibold text-white">Signal-Katalog</h1>
        <p class="mt-1 max-w-3xl text-sm text-slate-400">
          Gespiegelte Einträge (<span class="font-mono text-slate-300">MIRRORED_FROM_LEGACY</span>) kommen aus dem UNS-Registry-Mirror und sind hier nur lesbar.
          Neue Messgrößen für Rides legen Sie als <span class="font-mono text-slate-300">OPERATOR_CONFIGURED</span> an — danach erscheinen sie in den Ride-Capabilities.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-2 text-xs text-slate-400">
          <input v-model="operatorOnly" type="checkbox" class="rounded border-slate-600 bg-slate-950" />
          Nur operator-definiert
        </label>
        <button
          type="button"
          class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          :disabled="loading"
          @click="load"
        >
          Neu laden
        </button>
        <button
          type="button"
          class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          @click="openCreate"
        >
          Neues Signal
        </button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
      <table class="min-w-full text-left text-sm">
        <thead class="border-b border-slate-800 bg-slate-900/90 text-xs uppercase text-slate-500">
          <tr>
            <th class="px-3 py-2">signal_code</th>
            <th class="px-3 py-2">Label</th>
            <th class="px-3 py-2">Einheit</th>
            <th class="px-3 py-2">Kategorie</th>
            <th class="px-3 py-2">registry_source</th>
            <th class="px-3 py-2 text-right">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="6" class="px-3 py-8 text-center text-slate-500">Laden…</td>
          </tr>
          <tr v-else-if="!filteredRows.length">
            <td colspan="6" class="px-3 py-8 text-center text-slate-500">Keine Einträge.</td>
          </tr>
          <tr
            v-for="r in filteredRows"
            :key="r.id"
            class="border-b border-slate-800/80 hover:bg-slate-800/30"
          >
            <td class="px-3 py-2 font-mono text-xs text-brand-100/90">{{ r.signalCode }}</td>
            <td class="max-w-[12rem] truncate px-3 py-2 text-slate-300" :title="r.label || ''">{{ r.label || '—' }}</td>
            <td class="px-3 py-2 text-xs text-slate-400">{{ r.unit || '—' }}</td>
            <td class="px-3 py-2 text-xs text-slate-400">{{ r.category || '—' }}</td>
            <td class="px-3 py-2">
              <span
                class="rounded px-1.5 py-0.5 font-mono text-[10px]"
                :class="r.readOnly ? 'bg-slate-800 text-slate-400' : 'bg-emerald-950/80 text-emerald-200'"
              >
                {{ r.registrySource }}
              </span>
            </td>
            <td class="px-3 py-2 text-right">
              <button
                v-if="!r.readOnly"
                type="button"
                class="mr-2 text-xs text-brand-400 hover:underline"
                @click="openEdit(r)"
              >
                Bearbeiten
              </button>
              <button
                v-if="!r.readOnly"
                type="button"
                class="text-xs text-rose-400 hover:underline"
                @click="removeRow(r)"
              >
                Löschen
              </button>
              <span v-else class="text-[10px] text-slate-600">read-only</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="dialogOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        @click.self="dialogOpen = false"
      >
        <div class="w-full max-w-md rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
          <h2 class="text-sm font-semibold text-white">
            {{ dialogMode === 'create' ? 'Neues Signal' : 'Signal bearbeiten' }}
          </h2>
          <p class="mt-1 text-[11px] text-slate-500">
            signal_code: Kleinbuchstaben, snake_case (<span class="font-mono">[a-z][a-z0-9_]*</span>), max. 128 Zeichen.
          </p>
          <div class="mt-3 space-y-2">
            <label class="block text-xs text-slate-500">
              signal_code
              <input
                v-model="form.signalCode"
                class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-sm text-white"
                autocomplete="off"
              />
            </label>
            <label class="block text-xs text-slate-500">
              Label
              <input v-model="form.label" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
            </label>
            <label class="block text-xs text-slate-500">
              Beschreibung
              <textarea v-model="form.description" rows="2" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="block text-xs text-slate-500">
                Einheit
                <input v-model="form.unit" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
              </label>
              <label class="block text-xs text-slate-500">
                Kategorie
                <input v-model="form.category" class="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white" />
              </label>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300" @click="dialogOpen = false">
              Abbrechen
            </button>
            <button
              type="button"
              class="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              :disabled="saving || !form.signalCode.trim()"
              @click="saveDialog"
            >
              {{ saving ? '…' : 'Speichern' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
