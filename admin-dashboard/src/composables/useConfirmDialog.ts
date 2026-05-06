import { ref } from 'vue'

export type ConfirmDialogVariant = 'default' | 'danger'

export interface ConfirmDialogPayload {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmDialogVariant
  /** When set, the confirm button stays disabled until the input matches exactly (after trim). */
  mustMatch?: string
  /** Shown above the input (e.g. “Type DELETE”). */
  mustMatchHint?: string
}

const visible = ref(false)
const payload = ref<ConfirmDialogPayload | null>(null)
const matchInput = ref('')
let pendingResolve: ((ok: boolean) => void) | null = null

function finish(ok: boolean) {
  visible.value = false
  payload.value = null
  matchInput.value = ''
  pendingResolve?.(ok)
  pendingResolve = null
}

/**
 * App-wide confirm modal (see ConfirmDialogHost in App.vue). Returns true if user confirmed.
 */
export function askConfirm(p: ConfirmDialogPayload): Promise<boolean> {
  return new Promise((resolve) => {
    if (pendingResolve) pendingResolve(false)
    pendingResolve = resolve
    payload.value = { variant: 'default', ...p }
    matchInput.value = ''
    visible.value = true
  })
}

export function submitConfirmDialog() {
  if (!visible.value || !payload.value) return
  const must = payload.value.mustMatch
  if (must != null && matchInput.value.trim() !== must) return
  finish(true)
}

export function dismissConfirmDialog() {
  if (!visible.value) return
  finish(false)
}

/** Bindings for ConfirmDialogHost.vue */
export function useConfirmDialog() {
  return {
    visible,
    payload,
    matchInput,
    submitConfirmDialog,
    dismissConfirmDialog,
  }
}
