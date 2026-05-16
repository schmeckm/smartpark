/**
 * leaflet.heat / simpleheat call `getImageData` on every redraw. Chrome suggests
 * `willReadFrequently: true` on the 2d context — patch only heatmap canvases.
 */
export function installLeafletHeatCanvasReadbackHint(): () => void {
  const proto = HTMLCanvasElement.prototype
  const original = proto.getContext
  const patched = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: CanvasRenderingContext2DSettings,
  ) {
    if (contextId === '2d' && this.classList.contains('leaflet-heatmap-layer')) {
      return original.call(this, contextId, { ...options, willReadFrequently: true })
    }
    return original.call(this, contextId, options)
  }
  proto.getContext = patched as typeof proto.getContext
  return () => {
    proto.getContext = original
  }
}
