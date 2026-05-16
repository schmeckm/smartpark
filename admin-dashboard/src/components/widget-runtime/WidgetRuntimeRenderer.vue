<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  getWidgetRuntimeInstanceData,
  listWidgetRuntimeWidgets,
  type DashboardWidgetInstanceDto,
  type DashboardWidgetRegistryEntryDto,
} from '@/api/client'
import { resolveApprovedWidgetComponent } from '@/components/widget-runtime/widgetComponentRegistry'

const props = withDefaults(
  defineProps<{
    widgetInstance: DashboardWidgetInstanceDto
    widgetRegistry?: DashboardWidgetRegistryEntryDto[] | null
    readonly?: boolean
    /** When set, use this data instead of fetching (studio preview). */
    previewData?: unknown
    previewError?: string | null
  }>(),
  { readonly: false, widgetRegistry: null, previewData: undefined, previewError: null }
)

const { t } = useI18n()

const registryLocal = ref<DashboardWidgetRegistryEntryDto[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<unknown>(null)

const registry = computed(() => props.widgetRegistry ?? registryLocal.value)

const registryEntry = computed(() =>
  registry.value.find((w) => w.widgetKey === props.widgetInstance.widgetKey) ?? null
)

const component = computed(() => {
  const name = registryEntry.value?.componentName
  if (!name) return null
  return resolveApprovedWidgetComponent(name)
})

const effectiveData = computed(() =>
  props.previewData !== undefined ? props.previewData : data.value
)
const effectiveError = computed(() => props.previewError ?? error.value)
const effectiveLoading = computed(() => props.previewData === undefined && loading.value)

async function loadRegistry() {
  if (props.widgetRegistry?.length) return
  try {
    registryLocal.value = await listWidgetRuntimeWidgets()
  } catch {
    registryLocal.value = []
  }
}

async function fetchData() {
  if (props.previewData !== undefined) return
  if (!props.widgetInstance.enabled) {
    error.value = t('widgetRuntime.errors.instanceDisabled')
    data.value = null
    return
  }
  if (!props.widgetInstance.dataSourceKey) {
    data.value = null
    error.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await getWidgetRuntimeInstanceData(props.widgetInstance.id)
    data.value = res.data ?? null
  } catch (e) {
    data.value = null
    error.value = e instanceof Error ? e.message : t('widgetRuntime.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadRegistry()
  await fetchData()
})

watch(
  () => [props.widgetInstance.id, props.widgetInstance.dataSourceKey, props.previewData],
  () => {
    void fetchData()
  }
)
</script>

<template>
  <div class="widget-runtime-renderer" data-testid="widget-runtime-renderer">
    <header v-if="widgetInstance.title" class="mb-2">
      <h3 class="text-sm font-semibold text-slate-100">{{ widgetInstance.title }}</h3>
      <p v-if="widgetInstance.description" class="text-xs text-slate-400">{{ widgetInstance.description }}</p>
    </header>

    <div
      v-if="!registryEntry?.enabled"
      class="rounded-lg border border-amber-700/50 bg-amber-950/30 p-4 text-sm text-amber-200"
      data-testid="widget-runtime-fallback-disabled-widget"
    >
      {{ t('widgetRuntime.errors.widgetTypeDisabled') }}
    </div>
    <div
      v-else-if="!component"
      class="rounded-lg border border-red-800/50 bg-red-950/30 p-4 text-sm text-red-200"
      data-testid="widget-runtime-fallback-unknown-component"
    >
      {{ t('widgetRuntime.errors.unknownComponent') }}
    </div>
    <component
      :is="component"
      v-else
      :data="effectiveData"
      :loading="effectiveLoading"
      :error="effectiveError"
    />
  </div>
</template>
