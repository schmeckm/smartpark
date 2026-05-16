function defaultHttpPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80'
}

function effectivePort(u: URL): string {
  return u.port || defaultHttpPort(u.protocol)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/**
 * API origin for fetch and Socket.IO.
 *
 * Returns `''` when the browser should use same-origin relative paths (`/api`, `/socket.io`)
 * so Vite's dev proxy forwards to the API (see vite.config.ts).
 *
 * In dev, ignores `VITE_API_URL` when it clearly targets the dev UI instead of the API:
 * - Same origin as the page.
 * - Both loopback hosts and same port (e.g. env `http://localhost:5173`, tab `http://127.0.0.1:5173`).
 * - Loopback in env, non-loopback page, same port (LAN tab — relative paths use the tab host's proxy).
 */
export function resolveApiOrigin(): string {
  const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '')
  if (!raw) return ''
  if (import.meta.env.DEV && typeof globalThis.window !== 'undefined') {
    try {
      const configured = new URL(raw)
      const page = new URL(globalThis.window.location.href)
      if (configured.origin === page.origin) {
        console.warn(
          '[Smart Park] VITE_API_URL matches the dev UI origin — ignoring it so /api uses the Vite proxy. Unset VITE_API_URL or set it to the API (e.g. http://localhost:3000).'
        )
        return ''
      }
      const samePort = effectivePort(configured) === effectivePort(page)
      const loopbackLoopbackSamePort =
        samePort && isLoopbackHost(configured.hostname) && isLoopbackHost(page.hostname)
      const loopbackEnvButLanUi =
        samePort && isLoopbackHost(configured.hostname) && !isLoopbackHost(page.hostname)
      if (loopbackLoopbackSamePort || loopbackEnvButLanUi) {
        console.warn(
          '[Smart Park] VITE_API_URL looks like the dev UI host/port — ignoring it so /api uses the Vite proxy. Point VITE_API_URL at the API (e.g. http://localhost:3000) or leave it unset.'
        )
        return ''
      }
    } catch {
      /* invalid URL — fall through */
    }
  }
  return raw
}
