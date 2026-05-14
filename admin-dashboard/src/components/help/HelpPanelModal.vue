<script setup lang="ts">
import { watchEffect } from 'vue'

const open = defineModel<boolean>({ default: false })

defineProps<{
  panelId: string
  titleId: string
}>()

function close() {
  open.value = false
}

watchEffect((onCleanup) => {
  if (!open.value) return
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') open.value = false
  }
  document.addEventListener('keydown', onEsc)
  onCleanup(() => document.removeEventListener('keydown', onEsc))
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @click.self="close()"
    >
      <div
        :id="panelId"
        class="mt-6 w-full max-w-lg rounded-xl border border-emerald-900/45 bg-slate-950 shadow-2xl shadow-black/50 ring-1 ring-emerald-500/15"
        @click.stop
      >
        <div class="flex items-start justify-between gap-3 border-b border-emerald-900/35 bg-emerald-950/35 px-4 py-3">
          <h2 :id="titleId" class="text-base font-semibold tracking-tight text-emerald-50">
            <slot name="title" />
          </h2>
          <button
            type="button"
            class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-200/95 hover:bg-emerald-950/90 hover:text-emerald-50"
            @click="close()"
          >
            <slot name="closeLabel" />
          </button>
        </div>
        <div
          class="max-h-[min(70vh,36rem)] space-y-4 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-slate-300 [&_strong]:font-semibold [&_strong]:text-emerald-100/95"
        >
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
