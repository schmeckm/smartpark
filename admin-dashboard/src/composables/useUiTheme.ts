import { ref } from 'vue'

export type UiTheme = 'dark' | 'light'

const THEME_KEY = 'sp_theme'

/** Shell theme (localStorage `sp_theme`). */
export const themePreference = ref<UiTheme>('dark')

export function applyThemeClass(t: UiTheme) {
  const root = document.documentElement
  root.classList.toggle('sp-theme-light', t === 'light')
  /** Keeps Tailwind `dark:` variants in sync with app theme (not OS `prefers-color-scheme`). */
  root.classList.toggle('dark', t === 'dark')
}

export function initThemeFromStorage() {
  const v = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  themePreference.value = v
  applyThemeClass(v)
}

export function persistThemePreference(t: UiTheme) {
  themePreference.value = t
  localStorage.setItem(THEME_KEY, t)
  applyThemeClass(t)
}
