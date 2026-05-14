<script setup lang="ts">
/**
 * Shared “help / how it works” trigger — emerald accent to align with OK-style status chips.
 */
defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    expanded?: boolean
    controlsId?: string
    disabled?: boolean
  }>(),
  { expanded: undefined, controlsId: undefined }
)

defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-700/55 bg-emerald-950/65 px-3 py-2 text-sm font-medium text-emerald-50 shadow-sm shadow-emerald-950/25 ring-1 ring-emerald-500/15 transition-colors hover:border-emerald-400/55 hover:bg-emerald-900/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-45 dark:border-emerald-600/45 dark:bg-emerald-950/45 dark:text-emerald-50 dark:shadow-emerald-950/40 dark:ring-emerald-400/10 dark:hover:border-emerald-400/50 dark:hover:bg-emerald-900/55 dark:focus-visible:ring-offset-slate-950"
    :class="$attrs.class as string | string[] | Record<string, boolean> | undefined"
    :aria-expanded="expanded"
    :aria-controls="controlsId"
    :disabled="disabled"
    v-bind="{ ...$attrs, class: undefined }"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>
