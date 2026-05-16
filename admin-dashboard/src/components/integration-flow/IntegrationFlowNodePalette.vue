<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IntegrationNodeRegistryEntryDto } from '@/api/client'
import {
  categorySortIndex,
  resolvePaletteCategory,
  type PaletteCategory,
} from '@/utils/integrationFlowPaletteCategories'

const DRAG_MIME = 'application/x-integration-flow-node-key'

const props = withDefaults(
  defineProps<{
    nodeRegistry: IntegrationNodeRegistryEntryDto[]
    readonly?: boolean
  }>(),
  { readonly: false }
)

const emit = defineEmits<{
  'add-node': [entry: IntegrationNodeRegistryEntryDto]
  'pick-node': [nodeKey: string]
}>()

const { t } = useI18n()

const search = ref('')
const selectedKey = ref('')
const dragKey = ref<string | null>(null)

const paletteGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const byCat = new Map<PaletteCategory, IntegrationNodeRegistryEntryDto[]>()
  for (const r of props.nodeRegistry) {
    if (!r.nodeKey) continue
    const cat = resolvePaletteCategory(r.category, r.nodeType)
    const hay = `${r.displayName} ${r.nodeKey} ${cat} ${r.description ?? ''}`.toLowerCase()
    if (q && !hay.includes(q)) continue
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push(r)
  }
  return [...byCat.entries()]
    .sort((a, b) => categorySortIndex(a[0]) - categorySortIndex(b[0]))
    .map(([category, entries]) => ({
      category,
      entries: [...entries].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
})

function categoryBadgeClass(cat: PaletteCategory): string {
  const m: Record<string, string> = {
    Trigger: 'bg-emerald-500/20 text-emerald-200',
    Adapter: 'bg-sky-500/20 text-sky-200',
    Transform: 'bg-violet-500/20 text-violet-200',
    Canonical: 'bg-indigo-500/20 text-indigo-200',
    Output: 'bg-amber-500/20 text-amber-200',
    AI: 'bg-fuchsia-500/20 text-fuchsia-200',
    Utility: 'bg-slate-500/30 text-slate-300',
    Other: 'bg-slate-600/30 text-slate-400',
  }
  return m[cat] || m.Other
}

function onDragStart(entry: IntegrationNodeRegistryEntryDto, ev: DragEvent) {
  if (props.readonly || entry.enabled === false) return
  dragKey.value = entry.nodeKey
  ev.dataTransfer?.setData(DRAG_MIME, entry.nodeKey)
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  dragKey.value = null
}

function onItemClick(entry: IntegrationNodeRegistryEntryDto) {
  selectedKey.value = entry.nodeKey
  emit('pick-node', entry.nodeKey)
}

function onAddSelected() {
  const entry = props.nodeRegistry.find((r) => r.nodeKey === selectedKey.value)
  if (entry) emit('add-node', entry)
}

function onAddEntry(entry: IntegrationNodeRegistryEntryDto) {
  if (props.readonly || entry.enabled === false) return
  emit('add-node', entry)
}
</script>

<template>
  <aside
    class="iff-palette flex h-full min-h-0 w-full flex-col rounded-lg border border-slate-700/80 bg-slate-900/70"
    data-testid="integration-flow-node-palette"
  >
    <div class="border-b border-slate-700/80 p-3">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {{ t('integrationFlowDesigner.paletteTitle') }}
      </h2>
      <label class="mt-2 block text-[10px] text-slate-500" for="iff-palette-search">
        {{ t('integrationFlowVisual.paletteSearch') }}
      </label>
      <input
        id="iff-palette-search"
        v-model="search"
        type="search"
        class="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        data-testid="integration-flow-palette-search"
        :placeholder="t('integrationFlowVisual.paletteSearchPlaceholder')"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2" data-testid="integration-flow-palette-list">
      <p v-if="!paletteGroups.length" class="px-2 py-3 text-xs text-slate-500">
        {{ t('integrationFlowVisual.paletteEmpty') }}
      </p>
      <div v-for="group in paletteGroups" :key="group.category" class="mb-3" data-testid="integration-flow-palette-group">
        <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {{ group.category }}
        </div>
        <ul class="space-y-1">
          <li
            v-for="entry in group.entries"
            :key="entry.id"
            class="rounded-md border border-transparent px-2 py-1.5 transition-colors"
            :class="[
              entry.enabled === false ? 'opacity-50' : 'cursor-grab hover:border-slate-600 hover:bg-slate-800/80',
              selectedKey === entry.nodeKey ? 'border-indigo-500/50 bg-indigo-500/10' : '',
              dragKey === entry.nodeKey ? 'border-indigo-400/60' : '',
            ]"
            :draggable="!readonly && entry.enabled !== false"
            data-testid="integration-flow-palette-item"
            @click="onItemClick(entry)"
            @dragstart="onDragStart(entry, $event)"
            @dragend="onDragEnd"
            @dblclick="onAddEntry(entry)"
          >
            <div class="flex items-start justify-between gap-2">
              <span class="text-sm font-medium text-slate-100">{{ entry.displayName }}</span>
              <span
                class="shrink-0 rounded px-1 text-[9px] font-semibold uppercase"
                :class="categoryBadgeClass(resolvePaletteCategory(entry.category, entry.nodeType))"
              >
                {{ resolvePaletteCategory(entry.category, entry.nodeType) }}
              </span>
            </div>
            <div class="mt-0.5 font-mono text-[10px] text-slate-500">{{ entry.nodeKey }}</div>
            <p v-if="entry.description" class="mt-1 line-clamp-2 text-[10px] text-slate-400">{{ entry.description }}</p>
            <span
              v-if="entry.enabled === false"
              class="mt-1 inline-block rounded px-1 text-[9px] uppercase text-slate-400 ring-1 ring-slate-600"
            >
              {{ t('integrationFlowVisual.registryDisabled') }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="!readonly" class="border-t border-slate-700/80 p-3">
      <button
        type="button"
        class="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        :disabled="!selectedKey"
        data-testid="integration-flow-palette-add"
        @click="onAddSelected"
      >
        {{ t('integrationFlowVisual.addNode') }}
      </button>
    </div>
  </aside>
</template>
