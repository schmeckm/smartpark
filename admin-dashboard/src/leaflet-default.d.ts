/** Vite serves Leaflet UMD `exports` as default; required for leaflet.heat (mutates `L`). */
import type * as Leaflet from 'leaflet'

declare module 'leaflet' {
  const L: typeof Leaflet
  export default L
}
