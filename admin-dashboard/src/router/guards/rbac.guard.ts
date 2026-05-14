import type { NavigationGuardWithThis } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Enforces `meta.roles`, `meta.permissionsAny` and `meta.permission`
 * across the entire matched route chain. Mirrors the inline logic of the
 * original `router.beforeEach` 1:1 — extracted so guards stay testable.
 */
export const rbacGuard: NavigationGuardWithThis<undefined> = (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) return true
  if (to.meta.public) return true

  for (const record of to.matched) {
    const rolesGuard = record.meta.roles
    if (rolesGuard?.length && !auth.canAny(rolesGuard)) {
      return { name: 'unauthorized' }
    }
    const anyPerms = record.meta.permissionsAny
    if (Array.isArray(anyPerms) && anyPerms.length) {
      const ok = anyPerms.some((p) => auth.hasPermission(p.resource, p.action))
      if (!ok) return { name: 'unauthorized' }
      continue
    }
    const perm = record.meta.permission as { resource: string; action: string } | undefined
    if (perm && !auth.hasPermission(perm.resource, perm.action)) {
      return { name: 'unauthorized' }
    }
  }
  return true
}
