<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import UnsAssetHierarchyExplorerView from '@/views/uns/UnsAssetHierarchyExplorerView.vue'
import UnsTreeBuilderView from '@/views/uns/UnsTreeBuilderView.vue'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

type ExplorerTab = 'assets' | 'tree'

const canIotOt = computed(() => auth.hasPermission('iotOt', 'settings.read'))
const canAssetHierarchy = computed(
  () => canIotOt.value || auth.hasPermission('rides', 'read')
)

/** Asset hierarchy first (primary entry), then UNS namespace editor. */
const allowedTabs = computed((): ExplorerTab[] => {
  const out: ExplorerTab[] = []
  if (canAssetHierarchy.value) out.push('assets')
  if (canIotOt.value) out.push('tree')
  return out
})

function rawQueryTab(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '').trim()
  return String(v ?? '').trim()
}

function coerceTab(raw: unknown): ExplorerTab {
  const s = rawQueryTab(raw).toLowerCase()
  if (!s) {
    return allowedTabs.value[0] ?? 'assets'
  }
  /* Legacy: entity list tab removed — send users to asset hierarchy */
  const candidate: ExplorerTab =
    s === 'assets' || s === 'asset' || s === 'hierarchy' || s === 'list' ? 'assets' : 'tree'
  if (allowedTabs.value.includes(candidate)) return candidate
  return allowedTabs.value[0] ?? 'assets'
}

const tab = computed(() => coerceTab(rawQueryTab(route.query.tab)))

function replaceTabQuery(next: ExplorerTab) {
  const q = { ...route.query, tab: next }
  void router.replace({ path: route.path, query: q })
}

function setTab(next: ExplorerTab) {
  replaceTabQuery(coerceTab(next))
}

onMounted(() => {
  if (!allowedTabs.value.length) return
  const q = rawQueryTab(route.query.tab)
  const desired = coerceTab(q)
  if (q !== desired) {
    replaceTabQuery(desired)
  }
})

watch(allowedTabs, (tabs) => {
  if (!tabs.length) return
  if (!tabs.includes(tab.value)) {
    replaceTabQuery(tabs[0])
  }
})
</script>

<template>
  <div class="min-h-full">
    <div class="border-b border-slate-800 bg-slate-900/40 px-4 sm:px-6">
      <div class="flex flex-col gap-3 pb-3 pt-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="font-display text-lg font-semibold text-white">{{ t('realtime.topicExplorer.title') }}</h1>
          <p class="mt-0.5 text-xs text-slate-500">{{ t('realtime.topicExplorer.subtitle') }}</p>
        </div>
        <div
          v-if="allowedTabs.length > 1"
          class="inline-flex flex-wrap gap-0.5 rounded-lg border border-slate-700 bg-slate-950 p-0.5"
        >
          <button
            v-if="canAssetHierarchy"
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition"
            :class="tab === 'assets' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="setTab('assets')"
          >
            {{ t('realtime.topicExplorer.modeAssets') }}
          </button>
          <button
            v-if="canIotOt"
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition"
            :class="tab === 'tree' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="setTab('tree')"
          >
            {{ t('realtime.topicExplorer.modeTree') }}
          </button>
        </div>
      </div>
    </div>
    <UnsAssetHierarchyExplorerView v-if="tab === 'assets' && canAssetHierarchy" />
    <UnsTreeBuilderView v-else-if="tab === 'tree' && canIotOt" />
  </div>
</template>
