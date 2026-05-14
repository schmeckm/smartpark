<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'

const { visible, payload, matchInput, submitConfirmDialog, dismissConfirmDialog } = useConfirmDialog()

const confirmDisabled = computed(() => {
  const p = payload.value
  if (!p?.mustMatch) return false
  return matchInput.value.trim() !== p.mustMatch
})

const confirmLabel = computed(() => payload.value?.confirmLabel ?? 'Ja')
const cancelLabel = computed(() => payload.value?.cancelLabel ?? 'Abbrechen')

const variantClasses = computed(() => {
  const v = payload.value?.variant ?? 'default'
  if (v === 'danger') {
    return {
      panel: 'border-rose-800/60 bg-slate-950 shadow-black/50',
      confirm:
        'bg-rose-600 text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40',
    }
  }
  return {
    panel: 'border-slate-600 bg-slate-950 shadow-black/50',
    confirm: 'bg-brand-600 text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40',
  }
})

function onBackdropMouseDown(e: MouseEvent) {
  if (e.target === e.currentTarget) dismissConfirmDialog()
}

function onKeydown(e: KeyboardEvent) {
  if (!visible.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    dismissConfirmDialog()
  }
}

onMounted(() => globalThis.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => globalThis.removeEventListener('keydown', onKeydown))

watch(visible, (v) => {
  if (v) matchInput.value = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && payload"
      class="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="presentation"
      @mousedown="onBackdropMouseDown"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-labelledby="payload.title ? 'confirm-dialog-title' : undefined"
        aria-describedby="confirm-dialog-desc"
        class="w-full max-w-md rounded-xl border p-5 shadow-2xl"
        :class="variantClasses.panel"
        @mousedown.stop
      >
        <h2
          v-if="payload.title"
          id="confirm-dialog-title"
          class="font-display text-lg font-semibold text-white"
        >
          {{ payload.title }}
        </h2>
        <p
          id="confirm-dialog-desc"
          class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300"
          :class="payload.title ? '' : 'mt-0'"
        >
          {{ payload.message }}
        </p>

        <div v-if="payload.mustMatch != null" class="mt-4 space-y-2">
          <label v-if="payload.mustMatchHint" class="block text-xs text-slate-400" for="confirm-dialog-match">
            {{ payload.mustMatchHint }}
          </label>
          <input
            id="confirm-dialog-match"
            v-model="matchInput"
            type="text"
            autocomplete="off"
            class="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            :placeholder="payload.mustMatch"
          />
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            @click="dismissConfirmDialog"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium"
            :class="variantClasses.confirm"
            :disabled="confirmDisabled"
            @click="submitConfirmDialog"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
