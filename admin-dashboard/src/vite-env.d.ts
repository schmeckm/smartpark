/// <reference types="vite/client" />

declare module 'leaflet.heat'

interface ImportMetaEnv {
  readonly VITE_USE_OPERATIONS_FACTS_FOR_RIDE_DASHBOARD?: string
  readonly VITE_API_URL?: string
  /** Repository root semver (injected in vite.config.ts from ../package.json). */
  readonly VITE_REPO_VERSION?: string
  /** Optional Git SHA from build env GIT_COMMIT. */
  readonly VITE_GIT_COMMIT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
