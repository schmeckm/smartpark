/**
 * Minimal contract for Node adapter packages (`index.js` + `manifest.json`).
 * Runtime orchestration: `AdapterRuntimeService` + `AdapterPackageLoaderService`.
 * @see docs/adapter-runtime.md
 */

function assertRuntimeContract(runtime) {
  const required = ['validateConfig', 'discover', 'poll', 'health'];
  for (const fn of required) {
    if (typeof runtime?.[fn] !== 'function') {
      throw new Error(`Adapter runtime missing required function: ${fn}`);
    }
  }
}

const { AdapterManifestValidatorService } = require('./adapter-manifest-validator.service');

function assertManifest(manifest) {
  const v = new AdapterManifestValidatorService().validateManifest(manifest);
  if (!v.valid) throw new Error(`Invalid adapter manifest: ${v.errors.join('; ')}`);
}

module.exports = { assertRuntimeContract, assertManifest };
