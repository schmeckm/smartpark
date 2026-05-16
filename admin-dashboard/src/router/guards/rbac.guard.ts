import type { NavigationGuardWithThis, RouteLocationMatched } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useInstalledAdaptersStore } from '@/stores/installedAdapters'

function recordRbacDenied(auth: ReturnType<typeof useAuthStore>, record: RouteLocationMatched): boolean {  const rolesGuard = record.meta.roles
  if (rolesGuard?.length && !auth.canAny(rolesGuard)) return true

  const anyPerms = record.meta.permissionsAny
  if (Array.isArray(anyPerms) && anyPerms.length) {
    return !anyPerms.some((p) => auth.hasPermission(p.resource, p.action))
  }

  const perm = record.meta.permission
  if (perm && typeof perm === 'object' && 'resource' in perm && 'action' in perm) {
    return !auth.hasPermission(String(perm.resource), String(perm.action))
  }
  return false
}

function recordNeedsAdapterHydrate(record: RouteLocationMatched): boolean {
  const anyKeys = record.meta.requiresAnyInstalledAdapters
  if (Array.isArray(anyKeys) && anyKeys.some((k) => String(k || '').trim())) return true
  const single = record.meta.requiresInstalledAdapter
  return typeof single === 'string' && Boolean(single.trim())
}

function adapterRequirementsPass(
  record: RouteLocationMatched,
  adapters: ReturnType<typeof useInstalledAdaptersStore>
): boolean {
  const anyKeys = record.meta.requiresAnyInstalledAdapters
  if (Array.isArray(anyKeys) && anyKeys.length) {
    const normalized = anyKeys.map((k) => String(k).trim()).filter(Boolean)
    if (normalized.length && !normalized.some((k) => adapters.isInstalled(k))) return false
  }
  const single = record.meta.requiresInstalledAdapter
  if (typeof single === 'string' && single.trim()) {
    if (!adapters.isInstalled(single.trim())) return false
  }
  return true
}

/**
 * Enforces `meta.roles`, `meta.permissionsAny` and `meta.permission`
 * across the entire matched route chain. Mirrors the inline logic of the
 * original `router.beforeEach` 1:1 — extracted so guards stay testable.
 *
 * Adapter gates (after hydrate):
 * - `meta.requiresInstalledAdapter` — that key must be installed.
 * - `meta.requiresAnyInstalledAdapters` — at least one listed key must be installed.
 */
export const rbacGuard: NavigationGuardWithThis<undefined> = async (to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) return true
  if (to.meta.public) return true

  for (const record of to.matched) {
    if (recordRbacDenied(auth, record)) return { name: 'unauthorized' }
  }

  let needsAdapterCheck = false
  for (const record of to.matched) {
    if (recordNeedsAdapterHydrate(record)) {
      needsAdapterCheck = true
      break
    }
  }

  if (needsAdapterCheck) {
    const adapters = useInstalledAdaptersStore()
    if (!adapters.loaded) {
      await adapters.hydrate()
    }
    for (const record of to.matched) {
      if (!adapterRequirementsPass(record, adapters)) {
        return { name: 'unauthorized' }
      }
    }
  }

  return true
}
