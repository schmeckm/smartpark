/**
 * One-off migration: copy adapter_packages.metadata.install into per-adapter YAML
 * (data/adapter-install-config/<adapterKey>.install.yaml) and remove install from DB metadata.
 *
 * Usage:
 *   npm run migrate:adapter-install-yaml              # migrate rows where YAML is missing
 *   npm run migrate:adapter-install-yaml -- --force # overwrite existing YAML from DB
 *   npm run migrate:adapter-install-yaml -- --dry-run
 *
 * Requires DB (same env as API). Does not load Express.
 */
/* eslint-disable no-console */
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize, AdapterPackage } = require(path.join(__dirname, '..', 'src', 'models'));
const {
  AdapterInstallConfigRepository,
  defaultInstallDocument,
} = require(path.join(__dirname, '..', 'src', 'repositories', 'adapter-install-config.repository.js'));

function legacyInstallHasPayload(install) {
  if (!install || typeof install !== 'object') return false;
  if (install.storage === 'yaml' || install.storage === 'legacy_db' || install.storage === 'none') {
    /* hydrated API shape — not raw legacy */
    return false;
  }
  const keys = Object.keys(install).filter((k) => !['storage', 'configFile', 'updatedAt'].includes(k));
  if (keys.length === 0) return false;
  if (
    install.configJson &&
    typeof install.configJson === 'object' &&
    Object.keys(install.configJson).length > 0
  ) {
    return true;
  }
  if (
    install.contextJson &&
    typeof install.contextJson === 'object' &&
    Object.keys(install.contextJson).length > 0
  ) {
    return true;
  }
  if (Array.isArray(install.outputProfiles) && install.outputProfiles.length > 0) return true;
  if (install.emitEnabled === true) return true;
  if (install.ingestCanonicalEnabled === true) return true;
  if (install.scheduleCron != null && String(install.scheduleCron).trim() !== '') return true;
  if (install.installedAt != null && String(install.installedAt).trim() !== '') return true;
  return false;
}

function buildDocFromLegacy(adapterKey, install) {
  const now = new Date().toISOString();
  return {
    ...defaultInstallDocument(adapterKey),
    installedAt: install.installedAt || now,
    updatedAt: now,
    configJson: install.configJson && typeof install.configJson === 'object' ? install.configJson : {},
    contextJson: install.contextJson && typeof install.contextJson === 'object' ? install.contextJson : {},
    outputProfiles: Array.isArray(install.outputProfiles) ? install.outputProfiles : ['UNS_JSON'],
    emitEnabled: install.emitEnabled === true,
    ingestCanonicalEnabled: install.ingestCanonicalEnabled === true,
    scheduleCron:
      install.scheduleCron != null && String(install.scheduleCron).trim() !== ''
        ? String(install.scheduleCron).trim()
        : null,
  };
}

async function main() {
  const force = process.argv.includes('--force');
  const dry = process.argv.includes('--dry-run');
  const repo = new AdapterInstallConfigRepository();
  const rows = await AdapterPackage.findAll({ order: [['adapterKey', 'ASC']] });
  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const j = row.toJSON();
    const key = j.adapterKey;
    const install = j.metadata?.install;
    if (!legacyInstallHasPayload(install)) {
      skipped += 1;
      continue;
    }
    const yamlPath = repo.filePath(key);
    if (fs.existsSync(yamlPath) && !force) {
      console.log(`[skip] ${key}: YAML already exists (${path.basename(yamlPath)}), use --force to overwrite`);
      skipped += 1;
      continue;
    }
    const doc = buildDocFromLegacy(key, install);
    if (dry) {
      console.log(`[dry-run] would write ${yamlPath} and strip metadata.install for ${key}`);
      migrated += 1;
      continue;
    }
    repo.saveFull(key, doc);
    const metaRest = { ...(j.metadata && typeof j.metadata === 'object' ? j.metadata : {}) };
    delete metaRest.install;
    await row.update({ metadata: metaRest });
    console.log(`[ok] ${key} -> ${path.basename(yamlPath)}`);
    migrated += 1;
  }

  console.log(`Done. Migrated: ${migrated}, skipped (no legacy payload or yaml exists): ${skipped}, dry-run: ${dry}`);
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
