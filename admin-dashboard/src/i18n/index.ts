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

export function readStoredLocale(): AppLocale {
  const s = localStorage.getItem(STORAGE_KEY)
  return isAppLocale(s) ? s : 'en'
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
  if (isAppLocale(languageCode)) return languageCode
  return readStoredLocale()
}
