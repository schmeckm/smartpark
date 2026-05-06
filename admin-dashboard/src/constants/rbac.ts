/**
 * Multi-role RBAC: mirrors repo `shared/rbac.json` via `admin-dashboard/shared/rbac.json`
 * (same bytes; `npm run verify:rbac` / CI enforces sync — Vite must resolve inside the app root for Docker).
 * Legacy JWT / single-role fields are no longer used on the client.
 */
import manifest from '../../shared/rbac.json'

export const ROLE_CODES = Object.freeze(
  manifest.roles.reduce<Record<string, string>>((acc, code) => {
    acc[code] = code
    return acc
  }, {}),
)

/** Role codes from `shared/rbac.json` (`roles` array). */
export type RoleCode = (typeof manifest.roles)[number]

/** Permission keys from `shared/rbac.json` (`permissions` array, `resource.action`). */
export type PermissionCode = (typeof manifest.permissions)[number]

type Perms = string[] | 'ALL'

const ROLE_PERMISSIONS = manifest.rolePermissions as Record<string, Perms>

export type RbacManifest = typeof manifest

export type NavigationManifestItem = {
  to: string
  labelKey: string
  activePathPrefix?: string
  /** If the path starts with any of these, do not treat `activePathPrefix` as active (e.g. studio under /ai-insights). */
  activeExcludePrefixes?: string[]
  altActivePrefixes?: string[]
  exact?: boolean
  muted?: boolean
  permission: { resource: string; action: string }
  labelKeyIfPermission?: { resource: string; action: string; labelKey: string }
  /** If set, only these role codes see the item (e.g. SYSTEM_ADMIN-only entries). */
  requiredRoles?: string[]
}

export type NavigationManifestGroup = {
  id: string
  titleKey: string
  items: NavigationManifestItem[]
}

export const navigationGroups: readonly NavigationManifestGroup[] = manifest.navigationGroups ?? []

function key(resource: string, action: string) {
  return `${resource}.${action}`
}

/** @deprecated use rolesHavePermission */
export function roleHasPermission(role: RoleCode | string, resource: string, action: string): boolean {
  return rolesHavePermission([role], resource, action)
}

export function rolesHavePermission(roles: readonly string[] | null | undefined, resource: string, action: string): boolean {
  if (!roles?.length) return false
  const perm = key(resource, action)
  for (const r of roles) {
    const set = ROLE_PERMISSIONS[r]
    if (set === 'ALL') return true
    if (Array.isArray(set) && set.includes(perm)) return true
  }
  return false
}
