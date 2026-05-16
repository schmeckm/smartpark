import { io, type Socket } from 'socket.io-client'
import { resolveApiOrigin } from '@/utils/apiOrigin'

/** Polling first avoids noisy WS-abort warnings when replacing sockets during handshake (dev/HMR). */
export const APP_SOCKET_IO_OPTIONS = {
  path: '/socket.io',
  transports: ['polling', 'websocket'] as ('polling' | 'websocket')[],
}

export function createAppSocket(token: string): Socket {
  const origin = resolveApiOrigin()
  const opts = { ...APP_SOCKET_IO_OPTIONS, auth: { token } }
  return origin ? io(origin, opts) : io(opts)
}

/** Tear down without "WebSocket closed before connection established" when still connecting. */
export function disconnectAppSocket(socket: Socket | null | undefined): void {
  if (!socket) return
  socket.removeAllListeners()
  if (socket.active && !socket.connected) {
    socket.io.engine?.close()
  }
  socket.disconnect()
}
