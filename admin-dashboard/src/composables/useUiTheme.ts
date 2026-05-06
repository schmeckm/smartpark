import { ref } from 'vue'

export type UiTheme = 'dark' | 'light'

const THEME_KEY = 'sp_theme'

/** Shell theme (localStorage `sp_theme`). */
export const themePreference = ref<UiTheme>('dark')

export function applyThemeClass(t: UiTheme) {
  document.documentElement.classList.toggle('sp-theme-light', t === 'light')
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
