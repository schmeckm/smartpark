import type { NavigationGuardWithThis } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { usePersonaStore } from '@/stores/persona'
import { MVP_DOMAINS, type MvpDomain } from '@/constants/rbac'

function isMvpDomain(value: unknown): value is MvpDomain {
  return typeof value === 'string' && (MVP_DOMAINS as readonly string[]).includes(value)
}

/**
 * Optional persona-domain gate — runs **only** when `meta.enforcePersonaDomain === true`.
 *
 * Legacy and most RBAC-only routes omit this flag; `rbacGuard` stays authoritative.
 * Use on MVP surfaces where sidebar persona intent must match (e.g. ride drilldown).
 */
export const personaGuard: NavigationGuardWithThis<undefined> = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) return true
  const persona = usePersonaStore()

  for (const record of to.matched) {
    const meta = record.meta as { enforcePersonaDomain?: boolean; domain?: unknown }
    if (!meta.enforcePersonaDomain) continue
    const domain = meta.domain
    if (!isMvpDomain(domain)) continue
    if (!persona.canSeeDomain(domain)) {
      return { name: 'unauthorized' }
    }
  }
  return true
}
