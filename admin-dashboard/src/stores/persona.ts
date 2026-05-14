import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  MVP_DOMAINS,
  personas as personaManifest,
  resolvePersona,
  type MvpDomain,
  type PersonaCode,
} from '@/constants/rbac'
import { useAuthStore } from '@/stores/auth'

/**
 * F2-MVP persona store.
 *
 * Resolves the active persona from `auth.user.roles` and exposes the four
 * fields the sidebar / guards / command palette need:
 *   - `current`        : the resolved PersonaCode
 *   - `navDomains`     : the 5-domain allow-list for the sidebar
 *   - `defaultRoute`   : the persona's landing path
 *   - `entry`          : the raw manifest entry (label key etc.)
 *
 * The persona is read-only and re-resolved automatically whenever
 * `auth.user.roles` changes.
 */
export const usePersonaStore = defineStore('persona', () => {
  const auth = useAuthStore()

  const overrideForTests = ref<PersonaCode | null>(null)

  const current = computed<PersonaCode>(() => {
    if (overrideForTests.value) return overrideForTests.value
    return resolvePersona(auth.user?.roles ?? [])
  })

  const entry = computed(() => personaManifest[current.value])

  const navDomains = computed<readonly MvpDomain[]>(() => entry.value?.navDomains ?? [])

  const defaultRoute = computed(() => entry.value?.defaultRoute ?? '/')

  const resolved = computed(() => Boolean(auth.user))

  function canSeeDomain(domain: MvpDomain): boolean {
    return navDomains.value.includes(domain)
  }

  function setOverrideForTests(p: PersonaCode | null) {
    overrideForTests.value = p
  }

  return {
    current,
    entry,
    navDomains,
    defaultRoute,
    resolved,
    domains: MVP_DOMAINS,
    canSeeDomain,
    setOverrideForTests,
  }
})
