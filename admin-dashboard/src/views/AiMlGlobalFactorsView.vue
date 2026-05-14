<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getMlGlobalFactors, patchMlGlobalFactor, postMlGlobalFactor, type MlGlobalFactorRow } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'

const { t } = useI18n()
const auth = useAuthStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const rows = ref<MlGlobalFactorRow[]>([])
const loading = ref(false)
const savingId = ref<string | null>(null)
const createOpen = ref(false)
const createLoading = ref(false)
const createError = ref<string | null>(null)

/** Draft fields per row for PATCH (weight / current / active). */
const drafts = ref<Record<string, { weight: number; currentValue: number | null; activeFlag: boolean }>>({})

const canEditGlobals = computed(() => auth.hasPermission('ai', 'refresh'))

const createForm = ref({
  factorCode: '',
  factorName: '',
  sourceType: 'MANUAL' as 'MANUAL' | 'API' | 'DERIVED' | 'CALCULATED',
  weight: 1,
  lagMinutes: 0,
  activeFlag: true,
  adapterKey: '',
  mqttTopic: '',
})

function rowId(r: MlGlobalFactorRow): string {
  return String(r.id ?? '')
}

/** API rows may be camelCase or snake_case; avoid `as` casts in templates (vue-tsc). */
function rowRec(r: MlGlobalFactorRow): Record<string, unknown> {
  return r as Record<string, unknown>
}

function rowActiveForDisplay(r: MlGlobalFactorRow): boolean {
  const rec = rowRec(r)
  const af = r.activeFlag ?? rec.active_flag
  return af !== false
}

function rowFactorCode(r: MlGlobalFactorRow): string {
  const v = r.factorCode ?? rowRec(r).factor_code
  return v != null ? String(v) : ''
}

function rowFactorName(r: MlGlobalFactorRow): string {
  const v = r.factorName ?? rowRec(r).factor_name
  return v != null ? String(v) : ''
}

function rowCurrentDisplay(r: MlGlobalFactorRow): string {
  const v = r.currentValue ?? rowRec(r).current_value
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

function rowSourceType(r: MlGlobalFactorRow): string {
  const v = r.sourceType ?? rowRec(r).source_type
  return v != null ? String(v) : ''
}

function syncDraftsFromRows() {
  const next: Record<string, { weight: number; currentValue: number | null; activeFlag: boolean }> = {}
  for (const r of rows.value) {
    const id = rowId(r)
    if (!id) continue
    const af = r.activeFlag ?? rowRec(r).active_flag
    const cvRaw: unknown = r.currentValue ?? rowRec(r).current_value
    next[id] = {
      weight: Number(r.weight ?? 1),
      currentValue: cvRaw == null || cvRaw === '' ? null : Number(cvRaw),
      activeFlag: Boolean(af !== false),
    }
  }
  drafts.value = next
}

async function load() {
  loading.value = true
  try {
    rows.value = await getMlGlobalFactors()
    syncDraftsFromRows()
  } catch (e) {
    rows.value = []
    drafts.value = {}
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    loading.value = false
  }
}

async function saveRow(r: MlGlobalFactorRow) {
  const id = rowId(r)
  if (!id || !canEditGlobals.value) return
  const d = drafts.value[id]
  if (!d) return
  savingId.value = id
  try {
    const rawCv = d.currentValue
    const currentValue =
      rawCv == null || (typeof rawCv === 'number' && Number.isNaN(rawCv)) ? null : Number(rawCv)

    await patchMlGlobalFactor(id, {
      weight: Number(d.weight),
      currentValue,
      activeFlag: d.activeFlag,
    })
    push(t('aiMl.globalSaved'), 'success')
    await load()
  } catch (e) {
    push(e instanceof Error ? e.message : 'Error', 'error')
  } finally {
    savingId.value = null
  }
}

function openCreate() {
  if (!canEditGlobals.value) return
  createForm.value = {
    factorCode: '',
    factorName: '',
    sourceType: 'MANUAL',
    weight: 1,
    lagMinutes: 0,
    activeFlag: true,
    adapterKey: '',
    mqttTopic: '',
  }
  createError.value = null
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
  createError.value = null
}

async function saveCreate() {
  if (!canEditGlobals.value) return
  const factorCode = createForm.value.factorCode.trim().toUpperCase()
  const factorName = createForm.value.factorName.trim()
  if (!/^[A-Z0-9_]+$/.test(factorCode)) {
    createError.value = 'Code muss A-Z, 0-9 oder _ enthalten.'
    return
  }
  if (!factorName) {
    createError.value = 'Name ist erforderlich.'
    return
  }
  createLoading.value = true
  createError.value = null
  try {
    const adapterKey = createForm.value.adapterKey.trim()
    const mqttTopic = createForm.value.mqttTopic.trim()

    await postMlGlobalFactor({
      factorCode,
      factorName,
      sourceType: createForm.value.sourceType,
      weight: Number(createForm.value.weight),
      lagMinutes: Number(createForm.value.lagMinutes),
      activeFlag: Boolean(createForm.value.activeFlag),
      currentValue: null,
      defaultValue: null,
      adapterKey: adapterKey || null,
      mqttTopic: mqttTopic || null,
    })
    push('Faktor angelegt', 'success')
    closeCreate()
    await load()
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Anlegen fehlgeschlagen'
  } finally {
    createLoading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
    <RouterLink to="/ai-insights" class="text-sm text-brand-400 hover:text-brand-300">← {{ t('aiMl.back') }}</RouterLink>
    <h1 :class="ui.title">{{ t('aiMl.globalTitle') }}</h1>
    <p :class="ui.subtitle">{{ t('aiMl.globalSubtitle') }}</p>

    <details :class="[ui.card, 'p-4']">
      <summary class="cursor-pointer text-sm font-medium text-slate-200 marker:text-brand-400">
        {{ t('aiMl.flowTitle') }}
      </summary>
      <pre
        class="mt-3 overflow-x-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300"
      >{{ t('aiMl.flowBody') }}</pre>
    </details>

    <p v-if="!canEditGlobals" class="rounded-lg border border-amber-700/40 bg-amber-950/25 px-3 py-2 text-xs text-amber-100/90">
      {{ t('aiMl.globalEditHint') }}
    </p>

    <div :class="ui.card" class="flex gap-2">
      <button
        type="button"
        class="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        :disabled="loading"
        @click="load()"
      >
        {{ t('btn.refresh') }}
      </button>
      <button
        v-if="canEditGlobals"
        type="button"
        class="rounded-md border border-brand-500 px-3 py-1.5 text-sm text-brand-200 hover:bg-brand-950/40"
        @click="openCreate()"
      >
        Neuen Faktor anlegen
      </button>
    </div>
    <div :class="ui.card" class="overflow-x-auto">
      <table class="w-full min-w-[880px] text-left text-sm">
        <thead>
          <tr :class="ui.muted">
            <th class="py-2 pr-2">{{ t('aiMl.colActive') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colCode') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colName') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colWeight') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colCurrent') }}</th>
            <th class="py-2 pr-2">{{ t('aiMl.colSource') }}</th>
            <th v-if="canEditGlobals" class="py-2 pr-2 text-right">{{ t('aiMl.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="rowId(r)" class="border-t border-slate-700/50">
            <td class="py-2 pr-2">
              <template v-if="canEditGlobals && drafts[rowId(r)]">
                <input v-model="drafts[rowId(r)].activeFlag" type="checkbox" class="rounded border-slate-600" />
              </template>
              <template v-else>{{ rowActiveForDisplay(r) ? '✓' : '—' }}</template>
            </td>
            <td class="py-2 pr-2 font-mono text-xs">{{ rowFactorCode(r) }}</td>
            <td class="py-2 pr-2">{{ rowFactorName(r) }}</td>
            <td class="py-2 pr-2 font-mono">
              <template v-if="canEditGlobals && drafts[rowId(r)]">
                <input
                  v-model.number="drafts[rowId(r)].weight"
                  type="number"
                  step="0.05"
                  class="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                />
              </template>
              <template v-else>{{ r.weight }}</template>
            </td>
            <td class="py-2 pr-2 font-mono">
              <template v-if="canEditGlobals && drafts[rowId(r)]">
                <input
                  v-model.number="drafts[rowId(r)].currentValue"
                  type="number"
                  step="0.05"
                  class="w-24 rounded border border-slate-600 bg-slate-950 px-2 py-1"
                />
              </template>
              <template v-else>{{ rowCurrentDisplay(r) }}</template>
            </td>
            <td class="py-2 pr-2 text-xs">{{ rowSourceType(r) }}</td>
            <td v-if="canEditGlobals" class="py-2 pr-2 text-right">
              <button
                type="button"
                class="rounded border border-slate-500 px-2 py-1 text-xs hover:bg-slate-800/80 disabled:opacity-50"
                :disabled="savingId === rowId(r) || !rowId(r)"
                @click="saveRow(r)"
              >
                {{ savingId === rowId(r) ? t('aiMl.saving') : t('aiMl.saveRow') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && !rows.length" :class="ui.muted" class="mt-2">{{ t('aiMl.empty') }}</p>
    </div>

    <div
      v-if="createOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      @click.self="closeCreate()"
    >
      <div :class="ui.card" class="w-full max-w-xl border border-slate-600 p-4 shadow-xl">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-white">Neuen globalen Faktor anlegen</h2>
          <button type="button" class="rounded px-2 text-slate-400 hover:text-white" @click="closeCreate()">✕</button>
        </div>
        <p v-if="createError" class="mb-2 rounded border border-rose-700/50 bg-rose-950/30 px-2 py-1 text-xs text-rose-200">
          {{ createError }}
        </p>
        <div class="grid gap-3 text-sm sm:grid-cols-2">
          <label class="block">
            <span class="text-xs text-slate-400">Code *</span>
            <input v-model="createForm.factorCode" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">Quelle</span>
            <select v-model="createForm.sourceType" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white">
              <option value="MANUAL">MANUAL</option>
              <option value="API">API</option>
              <option value="DERIVED">DERIVED</option>
              <option value="CALCULATED">CALCULATED</option>
            </select>
          </label>
          <label class="block sm:col-span-2">
            <span class="text-xs text-slate-400">Name *</span>
            <input v-model="createForm.factorName" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">Adapter-Key (optional)</span>
            <input
              v-model="createForm.adapterKey"
              placeholder="z. B. macro_tourism_index"
              class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
            />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">MQTT-Topic (optional)</span>
            <input
              v-model="createForm.mqttTopic"
              placeholder="z. B. spBv1.0/europa_park/DDATA/macro_tourism_gateway/macro"
              class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white"
            />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">Gewicht</span>
            <input v-model.number="createForm.weight" type="number" step="0.05" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="block">
            <span class="text-xs text-slate-400">Lag (Minuten)</span>
            <input v-model.number="createForm.lagMinutes" type="number" min="0" class="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white" />
          </label>
          <label class="flex items-center gap-2 sm:col-span-2">
            <input v-model="createForm.activeFlag" type="checkbox" class="rounded border-slate-600" />
            <span class="text-xs text-slate-300">Aktiv</span>
          </label>
        </div>
        <div class="mt-4 flex justify-end gap-2 border-t border-slate-700 pt-3">
          <button type="button" class="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300" @click="closeCreate()">Abbrechen</button>
          <button
            type="button"
            class="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="createLoading"
            @click="saveCreate()"
          >
            {{ createLoading ? 'Anlegen...' : 'Anlegen' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
