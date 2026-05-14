import { createI18n } from 'vue-i18n'
import en from './en.json'
import de from './de.json'
import fr from './fr.json'
import es from './es.json'

export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

const STORAGE_KEY = 'sp_locale'

export function isAppLocale(code: string | null | undefined): code is AppLocale {
  return Boolean(code && (SUPPORTED_LOCALES as readonly string[]).includes(code))
}

/** Map `de-DE`, `de_DE`, `DE` → `de` so vue-i18n resolves nested keys (avoids raw `sqdc.*` in UI). */
export function normalizeToAppLocale(code: string | null | undefined): AppLocale | null {
  if (code == null || !String(code).trim()) return null
  const raw = String(code).trim()
  const lower = raw.toLowerCase()
  if (isAppLocale(lower)) return lower
  const base = lower.split(/[-_]/)[0] ?? ''
  if (isAppLocale(base)) return base
  return null
}

export function readStoredLocale(): AppLocale {
  const s = localStorage.getItem(STORAGE_KEY)
  return normalizeToAppLocale(s) ?? 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: readStoredLocale(),
  fallbackLocale: 'en',
  messages: { en, de, fr, es },
  missingWarn: false,
  fallbackWarn: false,
})

export function setI18nLocale(code: AppLocale) {
  i18n.global.locale.value = code
  localStorage.setItem(STORAGE_KEY, code)
}

/** Prefer server profile when valid; otherwise persisted UI choice. */
export function resolveLocaleFromUser(languageCode: string | null | undefined): AppLocale {
  return normalizeToAppLocale(languageCode) ?? readStoredLocale()
}
