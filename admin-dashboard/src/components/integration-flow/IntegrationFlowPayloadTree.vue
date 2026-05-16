<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({ name: 'IntegrationFlowPayloadTree' })

const props = withDefaults(
  defineProps<{
    value: unknown
    depth?: number
    label?: string
    maxDepth?: number
  }>(),
  { depth: 0, label: '', maxDepth: 6 }
)

const expanded = ref(true)

const isExpandable = computed(() => {
  const v = props.value
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  return typeof v === 'object'
})

const childEntries = computed(() => {
  const v = props.value
  if (v == null) return []
  if (Array.isArray(v)) {
    return v.slice(0, 40).map((item, i) => ({ key: String(i), value: item }))
  }
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !k.startsWith('_') || k === '_preview')
      .slice(0, 60)
      .map(([key, value]) => ({ key, value }))
  }
  return []
})

function primitiveLabel(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return `"${v.length > 80 ? `${v.slice(0, 80)}…` : v}"`
  return String(v)
}
</script>

<template>
  <div v-if="!isExpandable || depth >= maxDepth">
    <div v-if="label" class="iff-payload-tree__row">
      <span class="iff-payload-tree__key">{{ label }}</span>
      <span class="iff-payload-tree__val">{{ primitiveLabel(value) }}</span>
    </div>
    <span v-else class="iff-payload-tree__val">{{ primitiveLabel(value) }}</span>
  </div>
  <template v-else>
    <button type="button" class="iff-payload-tree__toggle" @click="expanded = !expanded">
      <span>{{ expanded ? '▼' : '▶' }}</span>
      <span v-if="label" class="iff-payload-tree__key">{{ label }}</span>
      <span class="iff-payload-tree__meta">
        {{ Array.isArray(value) ? `[${(value as unknown[]).length}]` : '{…}' }}
      </span>
    </button>
    <ul v-if="expanded" class="iff-payload-tree__children">
      <li v-for="entry in childEntries" :key="entry.key">
        <IntegrationFlowPayloadTree
          :value="entry.value"
          :label="entry.key"
          :depth="depth + 1"
          :max-depth="maxDepth"
        />
      </li>
    </ul>
  </template>
</template>

<style scoped>
.iff-payload-tree__row {
  display: flex;
  gap: 8px;
  font-size: 11px;
  line-height: 1.4;
}
.iff-payload-tree__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgb(203 213 225);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.iff-payload-tree__toggle:hover {
  color: rgb(226 232 240);
}
.iff-payload-tree__key {
  color: rgb(147 197 253);
  font-family: ui-monospace, monospace;
}
.iff-payload-tree__val {
  color: rgb(226 232 240);
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
.iff-payload-tree__meta {
  color: rgb(100 116 139);
}
.iff-payload-tree__children {
  list-style: none;
  margin: 4px 0 0;
  padding: 0 0 0 12px;
}
</style>
