import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

function parseDotEnvLineForKey(line: string, key: string): string | undefined {
  const t = line.trim()
  if (!t || t.startsWith('#')) return undefined
  const eq = t.indexOf('=')
  if (eq === -1) return undefined
  if (t.slice(0, eq).trim() !== key) return undefined
  let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return v.trim()
}

/** Read one `KEY=value` from `.env` then `.env.local` (later file wins). Bypasses empty `process.env.VITE_*` shadowing `.env` in Docker. */
function readDotEnvKey(envDir: string, key: string): string {
  let last = ''
  for (const file of [path.join(envDir, '.env'), path.join(envDir, '.env.local')]) {
    try {
      const raw = readFileSync(file, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const parsed = parseDotEnvLineForKey(line, key)
        if (parsed !== undefined) last = parsed
      }
    } catch {
      /* file missing */
    }
  }
  return last
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll("'", '&#39;')
}

function resolveLoginHeroImageUrl(opts: {
  projectRoot: string
  parentRoot: string
  isMonorepoLayout: boolean
  projectEnv: Record<string, string>
  parentEnv: Record<string, string>
}): string {
  const proc = process.env.VITE_LOGIN_HERO_IMAGE
  if (typeof proc === 'string' && proc.trim() !== '') return proc.trim()

  const fromProjectFile = readDotEnvKey(opts.projectRoot, 'VITE_LOGIN_HERO_IMAGE')
  if (fromProjectFile) return fromProjectFile

  if (opts.isMonorepoLayout) {
    const fromParentFile = readDotEnvKey(opts.parentRoot, 'VITE_LOGIN_HERO_IMAGE')
    if (fromParentFile) return fromParentFile
  }

  const fromLoaded = (
    opts.projectEnv.VITE_LOGIN_HERO_IMAGE ||
    opts.parentEnv.VITE_LOGIN_HERO_IMAGE ||
    ''
  ).trim()
  if (fromLoaded) return fromLoaded

  const pubDir = path.join(opts.projectRoot, 'public')
  for (const name of ['login-hero.jpg', 'login-hero.jpeg', 'login-hero.png', 'login-hero.webp']) {
    if (existsSync(path.join(pubDir, name))) return `/${name}`
  }
  return ''
}

export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url))
  const parentRoot = path.resolve(projectRoot, '..')
  const isMonorepoLayout =
    existsSync(path.join(parentRoot, 'package.json')) &&
    existsSync(path.join(parentRoot, 'admin-dashboard', 'package.json'))

  /** Root `.env` is not read when `envDir` is only `admin-dashboard/` — merge for local dev. */
  const parentEnv = isMonorepoLayout ? loadEnv(mode, parentRoot, '') : {}
  const projectEnv = loadEnv(mode, projectRoot, '')
  const env = { ...parentEnv, ...projectEnv }

  const loginHeroResolved = resolveLoginHeroImageUrl({
    projectRoot,
    parentRoot,
    isMonorepoLayout,
    projectEnv,
    parentEnv,
  })

  /** Root-only `VITE_*` (not overridden in `admin-dashboard/.env`) — optional extras without touching login hero. */
  const viteFromParentOnly = Object.fromEntries(
    Object.entries(parentEnv)
      .filter(
        ([key, val]) =>
          key.startsWith('VITE_') &&
          key !== 'VITE_LOGIN_HERO_IMAGE' &&
          projectEnv[key] === undefined &&
          val !== '',
      )
      .map(([key, val]) => [`import.meta.env.${key}`, JSON.stringify(val)]),
  )

  const usePolling = env.CHOKIDAR_USEPOLLING === 'true' || process.env.CHOKIDAR_USEPOLLING === 'true'
  const proxyTarget =
    process.env.VITE_PROXY_API_TARGET || env.VITE_PROXY_API_TARGET || 'http://localhost:3000'

  const repoRoot = path.resolve(projectRoot, '..')
  /**
   * Repo-root `src/utils` modules used by the dashboard. Local dev: read from parent repo.
   * Docker (`./admin-dashboard:/app`): parent repo is not at `/app/..`, so compose mounts `./src/utils`
   * → `/app/monorepo-src-utils`. Production image: Dockerfile copies the same two files there.
   */
  const rootUtilsFromMount = path.join(projectRoot, 'monorepo-src-utils')
  const rootUtilsFromRepo = path.join(repoRoot, 'src', 'utils')
  const rootUtilsDir = existsSync(path.join(rootUtilsFromMount, 'signal-availability-resolver.mjs'))
    ? rootUtilsFromMount
    : rootUtilsFromRepo

  /** UMD bundle; pin path so `import('leaflet.heat/dist/leaflet-heat.js')` and flaky subpath resolution still work in Docker. */
  const leafletHeatDist = path.join(projectRoot, 'node_modules', 'leaflet.heat', 'dist', 'leaflet-heat.js')
  const repoPkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
  let repoVersion = '0.0.0'
  try {
    repoVersion = String(JSON.parse(readFileSync(repoPkgPath, 'utf8')).version || '0.0.0')
  } catch {
    /* keep default */
  }
  const gitCommit = process.env.GIT_COMMIT || ''

  return {
    envDir: projectRoot,
    define: {
      ...viteFromParentOnly,
      /** Same semver as repository root `package.json` — use for “about” / support (optional in UI). */
      'import.meta.env.VITE_REPO_VERSION': JSON.stringify(repoVersion),
      /** Set `GIT_COMMIT` in Docker/CI so the bundle can show exact source revision. */
      'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommit),
      'import.meta.env.VITE_LOGIN_HERO_IMAGE': JSON.stringify(loginHeroResolved),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        'leaflet.heat/dist/leaflet-heat.js': leafletHeatDist,
        /** Root `src/utils` CommonJS modules (see `rootUtilsDir` above). */
        '@smartpark-root-utils/signal-availability-resolver.js': path.join(
          rootUtilsDir,
          'signal-availability-resolver.mjs',
        ),
        '@smartpark-root-utils/uns-mqtt-live-signal-match.js': path.join(
          rootUtilsDir,
          'uns-mqtt-live-signal-match.mjs',
        ),
      },
    },
    /** IIFE plugin mutates global `L`; skipping prebundle avoids broken transforms and import-analysis edge cases. */
    optimizeDeps: {
      exclude: ['leaflet.heat'],
    },
    plugins: [
      {
        name: 'smartpark-login-hero-html',
        enforce: 'pre',
        transformIndexHtml(html) {
          const marker = '<!--@SMARTPARK_LOGIN_HERO@-->'
          if (!html.includes(marker)) return html
          const url = resolveLoginHeroImageUrl({
            projectRoot,
            parentRoot,
            isMonorepoLayout,
            projectEnv: loadEnv(mode, projectRoot, ''),
            parentEnv: isMonorepoLayout ? loadEnv(mode, parentRoot, '') : {},
          })
          if (!url) return html.replace(marker, '')
          const meta = `<meta name="smartpark-login-hero" content="${escapeHtmlAttr(url)}" />`
          const script = `<script>window.__SP_LOGIN_HERO__=${JSON.stringify(url)}</` + `script>`
          return html.replace(marker, `${meta}${script}`)
        },
      },
      vue(),
    ],
    server: {
      fs: {
        allow: [projectRoot, repoRoot],
      },
      host: true,
      port: 5173,
      strictPort: true,
      watch: usePolling
        ? {
            usePolling: true,
            interval: 1000,
          }
        : undefined,
      hmr: {
        protocol: 'ws',
        port: 5173,
        clientPort: 5173,
      },
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: proxyTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    preview: {
      fs: {
        allow: [projectRoot, repoRoot],
      },
      host: true,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: proxyTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})
