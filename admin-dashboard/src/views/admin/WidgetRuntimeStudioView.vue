<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ApiRequestError,
  createWidgetRuntimeInstance,
  deleteWidgetRuntimeInstance,
  getIntegrationFeatureFlags,
  listWidgetRuntimeDataSources,
  listWidgetRuntimeInstances,
  listWidgetRuntimeWidgets,
  patchWidgetRuntimeInstance,
  validateWidgetRuntimeInstance,
  type DashboardDataSourceRegistryEntryDto,
  type DashboardWidgetInstanceDto,
  type DashboardWidgetRegistryEntryDto,
} from '@/api/client'
import WidgetRuntimeRenderer from '@/components/widget-runtime/WidgetRuntimeRenderer.vue'
import { askConfirm } from '@/composables/useConfirmDialog'
import { usePageSurfaces } from '@/composables/usePageSurfaces'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuthStore()
const { push } = useToast()
const { surfaces: ui } = usePageSurfaces()

const canManage = computed(() => auth.hasPermission('integrations', 'manage'))

const runtimeAvailable = ref(true)
const initialLoadDone = ref(false)

const widgets = ref<DashboardWidgetRegistryEntryDto[]>([])
const dataSources = ref<DashboardDataSourceRegistryEntryDto[]>([])
const instances = ref<DashboardWidgetInstanceDto[]>([])
const instancesLoading = ref(false)

const selectedId = ref<string | null>(null)
const editorTitle = ref('')
const editorDescription = ref('')
const editorWidgetKey = ref('')
const editorDataSourceKey = ref('')
const editorConfigText = ref('{}')
const editorEnabled = ref(true)
const configError = ref<string | null>(null)

const previewData = ref<unknown>(undefined)
const previewError = ref<string | null>(null)
const validationErrors = ref<string[]>([])
const saving = ref(false)

const draftInstance = computed((): DashboardWidgetInstanceDto | null => {
  if (!editorWidgetKey.value) return null
  let widgetConfig: Record<string, unknown> = {}
  try {
    widgetConfig = JSON.parse(editorConfigText.value) as Record<string, unknown>
    configError.value = null
  } catch {
    configError.value = t('widgetRuntimeStudio.configInvalid')
    return null
  }
  return {
    id: selectedId.value || 'draft',
    widgetKey: editorWidgetKey.value,
    title: editorTitle.value || null,
    description: editorDescription.value || null,
    widgetConfig,
    dataSourceKey: editorDataSourceKey.value || null,
    enabled: editorEnabled.value,
    createdBy: null,
    updatedBy: null,
  }
})

async function probeAndLoad() {
  runtimeAvailable.value = true
  try {
    const flags = await getIntegrationFeatureFlags()
    if (!flags.widgetRuntimeEnabled) {
      runtimeAvailable.value = false
      return
    }
    await loadAll()
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) {
      runtimeAvailable.value = false
    } else {
      push(e instanceof Error ? e.message : t('widgetRuntimeStudio.loadError'), 'error')
    }
  } finally {
    initialLoadDone.value = true
  }
}

async function loadAll() {
  instancesLoading.value = true
  try {
    const [w, d, i] = await Promise.all([
      listWidgetRuntimeWidgets(),
      listWidgetRuntimeDataSources(),
      listWidgetRuntimeInstances(),
    ])
    widgets.value = w
    dataSources.value = d
    instances.value = i
  } finally {
    instancesLoading.value = false
  }
}

function selectInstance(row: DashboardWidgetInstanceDto) {
  selectedId.value = row.id
  editorTitle.value = row.title || ''
  editorDescription.value = row.description || ''
  editorWidgetKey.value = row.widgetKey
  editorDataSourceKey.value = row.dataSourceKey || ''
  editorConfigText.value = JSON.stringify(row.widgetConfig || {}, null, 2)
  editorEnabled.value = row.enabled !== false
  previewData.value = undefined
  previewError.value = null
  validationErrors.value = []
}

function startNew() {
  selectedId.value = null
  editorTitle.value = ''
  editorDescription.value = ''
  editorWidgetKey.value = widgets.value[0]?.widgetKey || ''
  editorDataSourceKey.value = dataSources.value[0]?.dataSourceKey || ''
  editorConfigText.value = '{}'
  editorEnabled.value = true
  previewData.value = undefined
  previewError.value = null
  validationErrors.value = []
}

function parseConfig(): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(editorConfigText.value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      configError.value = t('widgetRuntimeStudio.configInvalid')
      return null
    }
    configError.value = null
    return parsed as Record<string, unknown>
  } catch {
    configError.value = t('widgetRuntimeStudio.configInvalid')
    return null
  }
}

async function saveInstance() {
  if (!canManage.value) return
  const widgetConfig = parseConfig()
  if (!widgetConfig || !editorWidgetKey.value) return
  saving.value = true
  try {
    const body = {
      widgetKey: editorWidgetKey.value,
      title: editorTitle.value || null,
      description: editorDescription.value || null,
      widgetConfig,
      dataSourceKey: editorDataSourceKey.value || null,
      enabled: editorEnabled.value,
    }
    if (selectedId.value) {
      await patchWidgetRuntimeInstance(selectedId.value, body)
      push(t('widgetRuntimeStudio.saved'), 'success')
    } else {
      const created = await createWidgetRuntimeInstance(body)
      selectedId.value = created.id
      push(t('widgetRuntimeStudio.created'), 'success')
    }
    await loadAll()
    const row = instances.value.find((i) => i.id === selectedId.value)
    if (row) selectInstance(row)
  } catch (e) {
    push(e instanceof Error ? e.message : t('widgetRuntimeStudio.saveError'), 'error')
  } finally {
    saving.value = false
  }
}

async function removeInstance() {
  if (!selectedId.value || !canManage.value) return
  const ok = await askConfirm({
    title: t('widgetRuntimeStudio.deleteConfirmTitle'),
    message: t('widgetRuntimeStudio.deleteConfirmMessage'),
  })
  if (!ok) return
  await deleteWidgetRuntimeInstance(selectedId.value)
  push(t('widgetRuntimeStudio.deleted'), 'success')
  selectedId.value = null
  await loadAll()
  startNew()
}

async function runValidate() {
  if (!selectedId.value) {
    push(t('widgetRuntimeStudio.validateNeedsSave'), 'info')
    return
  }
  try {
    const res = await validateWidgetRuntimeInstance(selectedId.value)
    validationErrors.value = res.errors || []
    previewData.value = res.previewData
    previewError.value = res.valid ? null : res.errors?.join('; ') || t('widgetRuntimeStudio.validationFailed')
    push(
      res.valid ? t('widgetRuntimeStudio.validationOk') : t('widgetRuntimeStudio.validationFailed'),
      res.valid ? 'success' : 'warning'
    )
  } catch (e) {
    push(e instanceof Error ? e.message : t('widgetRuntimeStudio.validationError'), 'error')
  }
}

onMounted(() => {
  void probeAndLoad()
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-6" data-testid="widget-runtime-studio-root">
    <header class="mb-6">
      <h1 :class="ui.title">{{ t('widgetRuntimeStudio.title') }}</h1>
      <p :class="['mt-1', ui.muted]">{{ t('widgetRuntimeStudio.subtitle') }}</p>
    </header>

    <div
      v-if="initialLoadDone && !runtimeAvailable"
      class="mb-6 rounded-lg border border-amber-700/50 bg-amber-950/20 p-4"
      data-testid="widget-runtime-studio-disabled"
    >
      <p class="font-medium text-amber-200">{{ t('widgetRuntimeStudio.disabledTitle') }}</p>
      <p class="mt-1 text-sm text-amber-100/80">{{ t('widgetRuntimeStudio.disabledHint') }}</p>
    </div>

    <template v-else-if="runtimeAvailable">
      <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside class="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
          <div class="mb-3 flex items-center justify-between">
            <h2 :class="ui.h2">{{ t('widgetRuntimeStudio.instances') }}</h2>
            <button
              v-if="canManage"
              type="button"
              class="text-xs font-medium text-brand-400 hover:text-brand-300"
              data-testid="widget-runtime-studio-new"
              @click="startNew"
            >
              {{ t('widgetRuntimeStudio.new') }}
            </button>
          </div>
          <p v-if="instancesLoading" class="text-sm text-slate-400">{{ t('widgetRuntime.loading') }}</p>
          <ul v-else class="space-y-1" data-testid="widget-runtime-studio-instance-list">
            <li v-for="row in instances" :key="row.id">
              <button
                type="button"
                class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                :class="selectedId === row.id ? 'bg-brand-500/15 text-brand-200' : 'text-slate-300'"
                @click="selectInstance(row)"
              >
                {{ row.title || row.widgetKey }}
              </button>
            </li>
          </ul>
        </aside>

        <div class="space-y-6">
          <section class="rounded-lg border border-slate-700/80 bg-slate-900/40 p-4">
            <h2 :class="[ui.h2, 'mb-4']">{{ t('widgetRuntimeStudio.editor') }}</h2>
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <label :class="ui.label">{{ t('widgetRuntimeStudio.widgetType') }}</label>
                <select v-model="editorWidgetKey" :class="ui.control" :disabled="!canManage">
                  <option v-for="w in widgets" :key="w.widgetKey" :value="w.widgetKey">
                    {{ w.displayName }}
                  </option>
                </select>
              </div>
              <div>
                <label :class="ui.label">{{ t('widgetRuntimeStudio.dataSource') }}</label>
                <select v-model="editorDataSourceKey" :class="ui.control" :disabled="!canManage">
                  <option value="">{{ t('widgetRuntimeStudio.noDataSource') }}</option>
                  <option v-for="d in dataSources" :key="d.dataSourceKey" :value="d.dataSourceKey">
                    {{ d.displayName }}
                  </option>
                </select>
              </div>
              <div>
                <label :class="ui.label">{{ t('widgetRuntimeStudio.titleField') }}</label>
                <input v-model="editorTitle" :class="ui.control" :disabled="!canManage" />
              </div>
              <div class="flex items-end gap-2">
                <label class="flex items-center gap-2 text-sm text-slate-300">
                  <input v-model="editorEnabled" type="checkbox" :disabled="!canManage" />
                  {{ t('widgetRuntimeStudio.enabled') }}
                </label>
              </div>
            </div>
            <div class="mt-4">
              <label :class="ui.label">{{ t('widgetRuntimeStudio.widgetConfig') }}</label>
              <textarea
                v-model="editorConfigText"
                :class="ui.control"
                rows="8"
                spellcheck="false"
                :disabled="!canManage"
              />
              <p v-if="configError" class="mt-1 text-sm text-red-400">{{ configError }}</p>
            </div>
            <div v-if="canManage" class="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                :disabled="saving"
                data-testid="widget-runtime-studio-save"
                @click="saveInstance"
              >
                {{ t('widgetRuntimeStudio.save') }}
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                data-testid="widget-runtime-studio-validate"
                @click="runValidate"
              >
                {{ t('widgetRuntimeStudio.validate') }}
              </button>
              <button
                v-if="selectedId"
                type="button"
                class="rounded-lg border border-red-800/60 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
                data-testid="widget-runtime-studio-delete"
                @click="removeInstance"
              >
                {{ t('widgetRuntimeStudio.delete') }}
              </button>
            </div>
            <ul v-if="validationErrors.length" class="mt-3 list-disc pl-5 text-sm text-amber-200">
              <li v-for="(err, i) in validationErrors" :key="i">{{ err }}</li>
            </ul>
          </section>

          <section class="rounded-lg border border-slate-700/80 bg-slate-900/40 p-4">
            <h2 :class="[ui.h2, 'mb-4']">{{ t('widgetRuntimeStudio.preview') }}</h2>
            <WidgetRuntimeRenderer
              v-if="draftInstance"
              :widget-instance="draftInstance"
              :widget-registry="widgets"
              :preview-data="previewData"
              :preview-error="previewError"
              readonly
            />
            <p v-else class="text-sm text-slate-500">{{ t('widgetRuntimeStudio.previewEmpty') }}</p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
