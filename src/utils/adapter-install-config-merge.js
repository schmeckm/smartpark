/**
 * Install UI stores park binding and optional coords in contextJson; adapters often read config only.
 * Context fills gaps; keys in configJson win on overlap.
 * @param {object} [config]
 * @param {object} [context]
 * @returns {Record<string, unknown>}
 */
function mergeAdapterInstallConfig(config, context) {
  const cfg = config && typeof config === 'object' ? config : {};
  const ctx = context && typeof context === 'object' ? context : {};
  return { ...ctx, ...cfg };
}

/**
 * Many installs put `parkSlug` only in configJson (manifest defaults). Encoder/scheduler still need context.parkSlug.
 * Copies sparkplugGroupId → parkSlug when needed, then configJson fallbacks.
 * @param {object} [context]
 * @param {object} [config]
 * @returns {Record<string, unknown>}
 */
function ensureContextParkSlug(context, config) {
  let ctx = context && typeof context === 'object' ? { ...context } : {};
  const cfg = config && typeof config === 'object' ? config : {};
  if (!String(ctx.parkSlug || '').trim() && String(ctx.sparkplugGroupId || '').trim()) {
    ctx = { ...ctx, parkSlug: String(ctx.sparkplugGroupId).trim() };
  }
  if (!String(ctx.parkSlug || '').trim() && String(cfg.parkSlug || '').trim()) {
    ctx = { ...ctx, parkSlug: String(cfg.parkSlug).trim() };
  }
  if (!String(ctx.parkSlug || '').trim() && String(cfg.sparkplugGroupId || '').trim()) {
    ctx = { ...ctx, parkSlug: String(cfg.sparkplugGroupId).trim() };
  }
  return ctx;
}

module.exports = { mergeAdapterInstallConfig, ensureContextParkSlug };
