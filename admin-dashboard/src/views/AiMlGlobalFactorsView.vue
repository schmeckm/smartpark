<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getMlGlobalFactors, patchMlGlobalFactor, type MlGlobalFactorRow } from '@/api/client'
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

/** Draft fields per row for PATCH (weight / current / active). */
const drafts = ref<Record<string, { weight: number; currentValue: number | null; activeFlag: boolean }>>({})

const canEditGlobals = computed(() => auth.hasPermission('ai', 'refresh'))

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
  </div>
</template>
