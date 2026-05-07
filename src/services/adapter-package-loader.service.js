/**
 * Loader for local adapter packages (runtime + HTTP).
 * Scans `src/integrations/adapter-packages` only.
 *
 * TODO: Support installing adapters from private Git / tarball URLs (registry + semver).
 *
 * @see docs/adapter-runtime.md
 */
const fs = require('node:fs');
const path = require('node:path');
const { assertRuntimeContract } = require('../adapter-framework/adapter-runtime-contract');
const { AdapterManifestValidatorService } = require('./adapter-manifest-validator.service');

const INTEGRATIONS_ADAPTER_PACKAGES = path.join(__dirname, '..', 'integrations', 'adapter-packages');

function _normRel(p) {
  return String(p || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\\/g, '/');
}

function _resolveReadmePath(packageDir, manifest) {
  if (manifest?.readmePath && typeof manifest.readmePath === 'string') {
    const rp = _normRel(manifest.readmePath);
    const abs = path.join(packageDir, rp);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return rp;
  }
  if (fs.existsSync(path.join(packageDir, 'README.md'))) return 'README.md';
  return null;
}

function _resolveBannerPath(packageDir, manifest) {
  if (manifest?.bannerPath && typeof manifest.bannerPath === 'string') {
    const bp = _normRel(manifest.bannerPath);
    const abs = path.join(packageDir, bp);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return bp;
  }
  const candidates = ['assets/banner.png', 'assets/banner.jpg', 'assets/banner.webp', 'assets/banner.svg'];
  for (const rel of candidates) {
    const abs = path.join(packageDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return rel;
  }
  return null;
}

class AdapterPackageLoaderService {
  constructor() {
    this.manifestValidator = new AdapterManifestValidatorService();
  }

  /**
   * Scan `src/integrations/adapter-packages/*` for folders containing manifest.json + index.js (or entrypoint).
   * Does not require(); use for discovery UI and smoke tests.
   * @returns {Array<{ adapterKey: string, packageDir: string, manifest: object, manifestValid: boolean, manifestErrors: string[] }>}
   */
  /**
   * @param {string} rootDir
   * @returns {Array<{ adapterKey: string, packageDir: string, manifest: object, manifestValid: boolean, manifestErrors: string[], readmePath: string|null, bannerPath: string|null }>}
   */
  _scanRoot(rootDir) {
    const out = [];
    if (!fs.existsSync(rootDir)) return out;
    for (const ent of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const packageDir = path.join(rootDir, ent.name);
      const manifestPath = path.join(packageDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        continue;
      }
      const entry = manifest.entrypoint || 'index.js';
      const entryPath = path.join(packageDir, entry);
      if (!fs.existsSync(entryPath)) continue;
      const v = this.manifestValidator.validateManifest(manifest);
      const readmePath = _resolveReadmePath(packageDir, manifest);
      const bannerPath = _resolveBannerPath(packageDir, manifest);
      out.push({
        adapterKey: manifest.adapterKey || ent.name,
        packageDir,
        manifest,
        manifestValid: v.valid,
        manifestErrors: v.errors,
        readmePath,
        bannerPath,
      });
    }
    return out;
  }

  /**
   * Scan `src/integrations/adapter-packages`. Same `adapterKey` collisions are deduplicated
   * (last-wins inside a single root, which today always picks one folder per key).
   */
  scanPackages() {
    const primary = this._scanRoot(INTEGRATIONS_ADAPTER_PACKAGES);
    const byKey = new Map();
    for (const item of primary) {
      byKey.set(item.adapterKey, item);
    }
    return [...byKey.values()];
  }

  /**
   * Read and validate manifest.json for an adapterKey under known roots (no require).
   * @param {string} adapterKey
   * @returns {object} manifest
   */
  loadManifest(adapterKey) {
    const packageDir = this._findPackageDir(adapterKey);
    if (!packageDir) {
      throw new Error(`No package directory for adapterKey: ${adapterKey}`);
    }
    const manifestPath = path.join(packageDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const v = this.manifestValidator.validateManifest(manifest);
    if (!v.valid) {
      throw new Error(`Invalid manifest: ${v.errors.join('; ')}`);
    }
    return manifest;
  }

  /**
   * require() entrypoint after manifest validation + runtime contract check.
   * @param {string} adapterKey
   * @returns {{ manifest: object, runtime: object, packageDir: string }}
   */
  loadAdapter(adapterKey) {
    return this.loadByAdapterKey(adapterKey);
  }

  /**
   * @param {object} adapter — module.exports from index.js
   */
  validateAdapterContract(adapter) {
    assertRuntimeContract(adapter);
  }

  listPackageDirs() {
    const dirs = [];
    for (const root of this.getRoots()) {
      if (!fs.existsSync(root)) continue;
      for (const name of fs.readdirSync(root, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        dirs.push(path.join(root, name.name));
      }
    }
    return dirs;
  }

  getRoots() {
    return [INTEGRATIONS_ADAPTER_PACKAGES];
  }

  _findPackageDir(adapterKey) {
    for (const root of this.getRoots()) {
      const dir = path.join(root, adapterKey);
      if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
    }
    for (const packageDir of this.listPackageDirs()) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
        if (m.adapterKey === adapterKey) return packageDir;
      } catch {
        /* skip */
      }
    }
    return null;
  }

  /**
   * @param {string} packageDir
   * @returns {{ manifest: object, runtime: object, packageDir: string } | null}
   */
  loadFromDir(packageDir) {
    const manifestPath = path.join(packageDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const v = this.manifestValidator.validateManifest(manifest);
    if (!v.valid) {
      throw new Error(`Invalid manifest in ${packageDir}: ${v.errors.join('; ')}`);
    }
    const entry = manifest.entrypoint || 'index.js';
    const runtimePath = path.join(packageDir, entry);
    if (!fs.existsSync(runtimePath)) return null;
    const runtime = require(runtimePath);
    assertRuntimeContract(runtime);
    return { manifest, runtime, packageDir };
  }

  /**
   * @param {string} adapterKey manifest.adapterKey
   * @returns {{ manifest: object, runtime: object, packageDir: string } | null}
   */
  loadByAdapterKey(adapterKey) {
    for (const root of this.getRoots()) {
      const dir = path.join(root, adapterKey);
      if (fs.existsSync(path.join(dir, 'manifest.json'))) {
        try {
          return this.loadFromDir(dir);
        } catch {
          return null;
        }
      }
    }
    for (const packageDir of this.listPackageDirs()) {
      try {
        const row = this.loadFromDir(packageDir);
        if (row?.manifest?.adapterKey === adapterKey) return row;
      } catch {
        /* skip invalid package */
      }
    }
    return null;
  }

  loadAll() {
    const byKey = new Map();
    for (const d of this.listPackageDirs()) {
      try {
        const row = this.loadFromDir(d);
        if (row) byKey.set(row.manifest.adapterKey, row);
      } catch {
        /* skip */
      }
    }
    return [...byKey.values()];
  }
}

module.exports = { AdapterPackageLoaderService, INTEGRATIONS_ADAPTER_PACKAGES };
