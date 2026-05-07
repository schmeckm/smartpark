#!/usr/bin/env node
/**
 * Adapter-keys baseline gate (Phase C0/C1).
 *
 * Asserts that the set of adapter packages on disk under
 * `src/integrations/adapter-packages/<key>/` exactly matches the closed
 * allowlist in `docs/governance/adapter-keys-baseline.json`.
 *
 * Failure modes (each prints a concrete diff):
 *   - A directory exists on disk that is not in the baseline.
 *     => The adapter is undocumented; add it to the baseline AND to all the
 *        references the baseline lists.
 *   - A baseline entry has no directory on disk.
 *     => The package was deleted/renamed without updating the baseline.
 *        Either restore the package, or remove the entry AND ensure no
 *        DB rows / install configs / dashboard code references it.
 *   - The directory's `manifest.json` declares a different `adapterKey`
 *     than its directory name.
 *     => This breaks the loader's per-directory shortcut path (see
 *        `AdapterPackageLoaderService._findPackageDir`). Rename the
 *        directory OR fix the manifest so they agree.
 *   - The manifest's `adapterKey` is not in the baseline.
 *     => Same fix as the first case.
 *
 * The point of this gate is to make adapter-key changes IMPOSSIBLE without
 * an explicit baseline update — i.e. without an explicit migration plan —
 * because the unique `adapter_packages.adapter_key` DB column would otherwise
 * silently desync from the on-disk slug.
 *
 * Used by `npm run check:adapter-keys-baseline` and chained into
 * `npm run governance:ci`.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'docs', 'governance', 'adapter-keys-baseline.json');
const PACKAGES_DIR = path.join(ROOT, 'src', 'integrations', 'adapter-packages');

/**
 * @returns {{ adapterKeys: string[], referencesByKey: Record<string, object> }}
 */
export function loadBaseline(file = BASELINE_FILE) {
  const text = fs.readFileSync(file, 'utf8');
  const doc = JSON.parse(text);
  if (!doc || !Array.isArray(doc.adapterKeys)) {
    throw new Error(`Invalid baseline at ${file}: adapterKeys array missing`);
  }
  return doc;
}

/**
 * @param {string} dir
 * @returns {Array<{ dirName: string, packageDir: string, manifest: object | null, manifestError: string | null }>}
 */
export function scanPackagesDir(dir = PACKAGES_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const packageDir = path.join(dir, ent.name);
    const manifestPath = path.join(packageDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest = null;
    let manifestError = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      manifestError = err instanceof Error ? err.message : String(err);
    }
    out.push({ dirName: ent.name, packageDir, manifest, manifestError });
  }
  return out;
}

/**
 * @param {object} baseline
 * @param {ReturnType<typeof scanPackagesDir>} scan
 * @returns {{ failures: string[], counts: { onDisk: number, baseline: number } }}
 */
export function diffBaselineAgainstDisk(baseline, scan) {
  const baselineSet = new Set(baseline.adapterKeys);
  const diskKeys = new Set();
  const failures = [];

  for (const item of scan) {
    if (item.manifestError) {
      failures.push(`package ${item.dirName}: manifest.json failed to parse — ${item.manifestError}`);
      continue;
    }
    const declared = String(item.manifest?.adapterKey || '').trim();
    if (!declared) {
      failures.push(`package ${item.dirName}: manifest.json has no adapterKey`);
      continue;
    }
    if (declared !== item.dirName) {
      failures.push(
        `package ${item.dirName}: manifest.adapterKey="${declared}" does not match directory name`
      );
    }
    if (!baselineSet.has(declared)) {
      failures.push(
        `package ${item.dirName}: adapterKey="${declared}" is not in the baseline allowlist`
      );
    }
    diskKeys.add(declared);
  }

  for (const key of baseline.adapterKeys) {
    if (!diskKeys.has(key)) {
      failures.push(
        `baseline entry "${key}": no package directory found at src/integrations/adapter-packages/${key}/manifest.json`
      );
    }
  }

  return {
    failures,
    counts: { onDisk: diskKeys.size, baseline: baseline.adapterKeys.length },
  };
}

function main() {
  const baseline = loadBaseline();
  const scan = scanPackagesDir();
  const { failures, counts } = diffBaselineAgainstDisk(baseline, scan);

  if (failures.length > 0) {
    process.stderr.write(
      `[check:adapter-keys-baseline] FAIL — ${failures.length} mismatch(es):\n`
    );
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    process.stderr.write(
      `\nFix by editing ${path.relative(ROOT, BASELINE_FILE)} OR by restoring/renaming the directory(ies).\n` +
        'See the baseline file header for the migration policy.\n'
    );
    process.exit(1);
  }

  process.stdout.write(
    `[check:adapter-keys-baseline] OK — ${counts.onDisk}/${counts.baseline} adapter keys agree with the baseline.\n`
  );
}

const isMain = import.meta.url === url.pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  main();
}
