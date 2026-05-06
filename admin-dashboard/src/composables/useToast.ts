import { ref } from 'vue'

export type ToastLevel = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: number
  message: string
  level: ToastLevel
}

const toasts = ref<ToastItem[]>([])
let seq = 0

export function useToast() {
  function push(message: string, level: ToastLevel = 'info') {
    const id = ++seq
    toasts.value = [...toasts.value, { id, message, level }]
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 4500)
  }
  return { toasts, push }
}
