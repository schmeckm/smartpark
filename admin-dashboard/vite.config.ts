import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const usePolling = env.CHOKIDAR_USEPOLLING === 'true' || process.env.CHOKIDAR_USEPOLLING === 'true'
  const proxyTarget =
    env.VITE_PROXY_API_TARGET || process.env.VITE_PROXY_API_TARGET || 'http://localhost:3000'

  const projectRoot = fileURLToPath(new URL('.', import.meta.url))
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
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
    define: {
      /** Same semver as repository root `package.json` — use for “about” / support (optional in UI). */
      'import.meta.env.VITE_REPO_VERSION': JSON.stringify(repoVersion),
      /** Set `GIT_COMMIT` in Docker/CI so the bundle can show exact source revision. */
      'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommit),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        'leaflet.heat/dist/leaflet-heat.js': leafletHeatDist,
      },
    },
    /** IIFE plugin mutates global `L`; skipping prebundle avoids broken transforms and import-analysis edge cases. */
    optimizeDeps: {
      exclude: ['leaflet.heat'],
    },
    plugins: [vue()],
    server: {
      fs: {
        allow: [projectRoot, repoRoot],
      },
      host: '0.0.0.0',
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
        host: 'localhost',
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
      host: '0.0.0.0',
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
