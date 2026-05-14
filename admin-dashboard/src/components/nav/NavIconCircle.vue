<script setup lang="ts">
import { computed } from 'vue'
import { resolveNavIcon } from '@/nav/navIconMap'

const props = withDefaults(
  defineProps<{
    name?: string | null
    active?: boolean
    light?: boolean
    size?: 'sm' | 'md'
  }>(),
  { active: false, light: false, size: 'sm' },
)

const Icon = computed(() => resolveNavIcon(props.name))

const ring = computed(() => {
  const L = props.light
  const A = props.active
  if (L) {
    if (A) return 'border-brand-400 text-brand-600 bg-brand-50/70 shadow-sm'
    return 'border-slate-200 text-brand-500/85 bg-white/90'
  }
  if (A) {
    return 'border-brand-400 text-brand-100 bg-brand-500/20 shadow-[0_0_18px_-3px_rgba(50,145,255,0.45)]'
  }
  return 'border-brand-500/40 text-brand-300 bg-slate-950/50 shadow-[0_0_14px_-6px_rgba(50,145,255,0.22)]'
})

const box = computed(() => (props.size === 'md' ? 'h-11 w-11' : 'h-8 w-8'))
const iconSize = computed(() => (props.size === 'md' ? 20 : 15))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full border transition-colors duration-150"
    :class="[box, ring]"
    aria-hidden="true"
  >
    <component :is="Icon" :size="iconSize" :stroke-width="1.75" class="shrink-0" />
  </span>
</template>
