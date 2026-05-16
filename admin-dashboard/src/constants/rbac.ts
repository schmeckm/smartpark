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

/** Role codes assignable via admin user CRUD (excludes legacy `ADMIN` alias). */
export const ASSIGNABLE_ROLE_CODES = Object.freeze(
  manifest.roles.filter((code) => code !== 'ADMIN') as RoleCode[],
)

/** Permission keys from `shared/rbac.json` (`permissions` array, `resource.action`). */
export type PermissionCode = (typeof manifest.permissions)[number]

type Perms = string[] | 'ALL'

const ROLE_PERMISSIONS = manifest.rolePermissions as Record<string, Perms>

export type RbacManifest = typeof manifest

export type NavigationManifestItem = {
  to: string
  labelKey: string
  /** Optional Lucide-backed icon key; see `src/nav/navIconMap.ts`. */
  navIcon?: string
  activePathPrefix?: string
  /** If the path starts with any of these, do not treat `activePathPrefix` as active (e.g. studio under /ai-insights). */
  activeExcludePrefixes?: string[]
  altActivePrefixes?: string[]
  exact?: boolean
  muted?: boolean
  /** Single permission gate (AND with requiredRoles when both set). */
  permission?: { resource: string; action: string }
  /** When set, user needs at least one of these permissions (OR). Ignores `permission`. */
  permissionsAny?: { resource: string; action: string }[]
  labelKeyIfPermission?: { resource: string; action: string; labelKey: string }
  /** If set, only these role codes see the item (e.g. SYSTEM_ADMIN-only entries). */
  requiredRoles?: string[]
  /** If set, sidebar hides this item unless the adapter is installed (see `useInstalledAdaptersStore`). */
  requiresInstalledAdapter?: string
  /** If set, sidebar shows the item when any of these adapters is installed (OR). */
  requiresAnyInstalledAdapters?: string[]
}

export type NavigationManifestGroup = {
  id: string
  titleKey: string
  items: NavigationManifestItem[]
}

export const navigationGroups: readonly NavigationManifestGroup[] = manifest.navigationGroups ?? []

/** F2-MVP top-level domains. Hard cap: exactly 5. */
export const MVP_DOMAINS = ['operations', 'realtime', 'ai', 'assets', 'admin'] as const
export type MvpDomain = (typeof MVP_DOMAINS)[number]

export type PersonaCode = 'OPERATOR' | 'ENGINEER' | 'ANALYST' | 'ADMINISTRATOR' | 'VIEWER'

export type PersonaManifestEntry = {
  labelKey: string
  roles: string[]
  defaultRoute: string
  navDomains: MvpDomain[]
}

const personasFromManifest = (manifest as unknown as { personas?: Record<string, PersonaManifestEntry> }).personas

export const personas: Readonly<Record<PersonaCode, PersonaManifestEntry>> = Object.freeze(
  (personasFromManifest ?? {}) as Record<PersonaCode, PersonaManifestEntry>,
)

/**
 * Resolve the persona for a user from their roles, in declaration order.
 * Highest-privilege personas (ADMINISTRATOR, ENGINEER) win when ambiguous because
 * the manifest lists them in escalation order.
 */
export function resolvePersona(roles: readonly string[] | null | undefined): PersonaCode {
  if (!roles?.length) return 'VIEWER'
  const ordered: PersonaCode[] = ['ADMINISTRATOR', 'ENGINEER', 'ANALYST', 'OPERATOR', 'VIEWER']
  for (const code of ordered) {
    const entry = personas[code]
    if (!entry) continue
    if (entry.roles.some((r) => roles.includes(r))) return code
  }
  return 'VIEWER'
}

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
