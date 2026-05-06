/**
 * Phase-1 filesystem loader for `src/adapters/packages` only.
 * For new work, prefer {@link AdapterPackageLoaderService} in `src/services/adapter-package-loader.service.js`
 * (integrations + legacy roots, single lookup API).
 */
const fs = require('node:fs');
const path = require('node:path');
const { assertManifest, assertRuntimeContract } = require('./adapter-runtime-contract');

const PACKAGES_DIR = path.resolve(__dirname, '..', 'adapters', 'packages');

class AdapterLoaderService {
  listLocalPackageDirs() {
    if (!fs.existsSync(PACKAGES_DIR)) return [];
    return fs
      .readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(PACKAGES_DIR, d.name));
  }

  loadLocalPackage(packageDir) {
    const manifestPath = path.join(packageDir, 'manifest.json');
    const runtimePath = path.join(packageDir, 'index.js');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(runtimePath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assertManifest(manifest);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const runtime = require(runtimePath);
    assertRuntimeContract(runtime);
    return { manifest, runtime, packageDir };
  }

  loadAllLocalPackages() {
    const loaded = [];
    for (const packageDir of this.listLocalPackageDirs()) {
      const row = this.loadLocalPackage(packageDir);
      if (row) loaded.push(row);
    }
    return loaded;
  }
}

module.exports = { AdapterLoaderService, PACKAGES_DIR };
