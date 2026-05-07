'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProviderAdapterInterface } = require('./provider-adapter.interface');
const { AppError } = require('../../utils/app-error');

const DEFAULT_PACKAGES_DIR = path.join(__dirname, '..', 'adapter-packages');

/**
 * Resolve the constructor for a provider-adapter from a CommonJS module export.
 *
 * Each `client.js` exports `{ <ClassName>: class extends ProviderAdapterInterface {…} }`.
 * The historical convention was a single named export per file, but to stay tolerant
 * we accept any export value that is a class extending `ProviderAdapterInterface`.
 *
 * @param {Record<string, unknown>} mod the module's exports object
 * @returns {Function | null} constructor or null if no matching class is exported
 */
function findProviderAdapterConstructor(mod) {
  if (!mod || typeof mod !== 'object') return null;
  for (const value of Object.values(mod)) {
    if (typeof value !== 'function') continue;
    if (value.prototype instanceof ProviderAdapterInterface) return value;
  }
  return null;
}

/**
 * Read every adapter-package manifest under `packagesDir` and instantiate the
 * `providerAdapterClient` (if declared). Failures on any single package are
 * reported but do not prevent the registry from booting — the others still load.
 *
 * @param {string} packagesDir absolute path to `src/integrations/adapter-packages`
 * @returns {{ instances: object[], errors: Array<{ adapterKey: string, reason: string }> }}
 */
function loadProviderAdaptersFromPackages(packagesDir = DEFAULT_PACKAGES_DIR) {
  const instances = [];
  const errors = [];
  if (!fs.existsSync(packagesDir)) {
    return { instances, errors };
  }
  for (const ent of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const packageDir = path.join(packagesDir, ent.name);
    const manifestPath = path.join(packageDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push({ adapterKey: ent.name, reason: `manifest parse: ${err.message}` });
      continue;
    }
    const adapterKey = String(manifest.adapterKey || ent.name);
    const clientRel = manifest.providerAdapterClient;
    if (!clientRel || typeof clientRel !== 'string') {
      // Package has no provider-adapter contribution; skip silently. Most
      // packages (weather_open_meteo, calendar_school_holidays, opcua_edge)
      // are pure runtime-contract packages with no upstream HTTP class.
      continue;
    }
    const clientPath = path.join(packageDir, clientRel);
    if (!fs.existsSync(clientPath)) {
      errors.push({
        adapterKey,
        reason: `manifest.providerAdapterClient="${clientRel}" but file does not exist at ${clientPath}`,
      });
      continue;
    }
    let mod;
    try {
      // require() is intentional: provider-adapter clients are CommonJS modules
      // bundled with the server. The path comes from a server-controlled
      // manifest under src/integrations/adapter-packages/, never from user input.
      mod = require(clientPath);
    } catch (err) {
      errors.push({ adapterKey, reason: `require failed: ${err.message}` });
      continue;
    }
    const Ctor = findProviderAdapterConstructor(mod);
    if (!Ctor) {
      errors.push({
        adapterKey,
        reason: `module at ${clientRel} does not export a class extending ProviderAdapterInterface`,
      });
      continue;
    }
    let instance;
    try {
      instance = new Ctor();
    } catch (err) {
      errors.push({ adapterKey, reason: `constructor threw: ${err.message}` });
      continue;
    }
    instances.push(instance);
  }
  // Stable order: sort by reported provider key. Pre-C2, the constructor relied
  // on hard-coded `new XAdapter()` order. Keeping a deterministic order makes
  // any consumer that snapshots `listAdapters()` reproducible across boots.
  instances.sort((a, b) => {
    const ap = String(a.getProviderInfo()?.provider || '');
    const bp = String(b.getProviderInfo()?.provider || '');
    return ap.localeCompare(bp);
  });
  return { instances, errors };
}

class ProviderAdapterRegistry {
  /**
   * @param {object} [options]
   * @param {string} [options.packagesDir] override the adapter-packages root
   *   (used by tests; production always uses the default).
   * @param {(reason: string) => void} [options.onLoadError] callback invoked
   *   for each per-package load failure. Defaults to `console.warn` so the
   *   server doesn't crash silently when a package is malformed at boot.
   */
  constructor(options = {}) {
    this.adapters = new Map();
    const { instances, errors } = loadProviderAdaptersFromPackages(
      options.packagesDir || DEFAULT_PACKAGES_DIR
    );
    for (const adapter of instances) {
      const key = adapter.getProviderInfo()?.provider;
      if (!key) continue;
      this.adapters.set(key, adapter);
    }
    if (errors.length > 0) {
      const onError = options.onLoadError || ((msg) => {
        // eslint-disable-next-line no-console
        console.warn(msg);
      });
      for (const e of errors) {
        onError(`[ProviderAdapterRegistry] failed to load provider for "${e.adapterKey}": ${e.reason}`);
      }
    }
  }

  listAdapters() {
    return [...this.adapters.values()];
  }

  listProviderInfos() {
    return this.listAdapters().map((a) => a.getProviderInfo());
  }

  get(provider) {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new AppError(`Unknown provider: ${provider}`, 404, { code: 'NOT_FOUND' });
    }
    return adapter;
  }
}

module.exports = {
  ProviderAdapterRegistry,
  loadProviderAdaptersFromPackages,
  findProviderAdapterConstructor,
};
