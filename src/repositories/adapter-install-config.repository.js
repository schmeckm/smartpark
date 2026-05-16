const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yamljs');
const { DEFAULT_INSTALL_OUTPUT_PROFILES } = require('../modules/integrations/adapter-framework/adapter-output-profile-names');

/**
 * Per-adapter install configuration on disk (YAML), same mechanism for all packages.
 * DB `adapter_packages` holds registry/manifest sync only — not configJson/contextJson.
 */
function getConfigRootDir() {
  const fromEnv = process.env.ADAPTER_INSTALL_CONFIG_DIR;
  if (fromEnv && String(fromEnv).trim()) {
    return path.resolve(String(fromEnv).trim());
  }
  return path.join(process.cwd(), 'data', 'adapter-install-config');
}

function assertSafeAdapterKey(adapterKey) {
  const k = String(adapterKey || '').trim();
  if (!/^[a-z0-9_-]{1,120}$/i.test(k)) {
    throw new Error(`Invalid adapterKey for install config file: ${adapterKey}`);
  }
  return k;
}

function defaultInstallDocument(adapterKey) {
  const k = assertSafeAdapterKey(adapterKey);
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    adapterKey: k,
    installedAt: now,
    updatedAt: now,
    configJson: {},
    contextJson: { parkSlug: 'europapark' },
    outputProfiles: [...DEFAULT_INSTALL_OUTPUT_PROFILES],
    emitEnabled: false,
    ingestCanonicalEnabled: false,
    scheduleCron: null,
  };
}

class AdapterInstallConfigRepository {
  filePath(adapterKey) {
    const k = assertSafeAdapterKey(adapterKey);
    return path.join(getConfigRootDir(), `${k}.install.yaml`);
  }

  /** Tombstone: user removed integration; boot-time reload must not re-upsert a DB row from disk. */
  removedMarkerPath(adapterKey) {
    const k = assertSafeAdapterKey(adapterKey);
    return path.join(getConfigRootDir(), `${k}.removed`);
  }

  isMarkedRemoved(adapterKey) {
    try {
      return fs.existsSync(this.removedMarkerPath(adapterKey));
    } catch {
      return false;
    }
  }

  writeRemovedMarker(adapterKey) {
    this.ensureDir();
    const p = this.removedMarkerPath(adapterKey);
    fs.writeFileSync(p, `${new Date().toISOString()}\n`, 'utf8');
  }

  clearRemovedMarker(adapterKey) {
    try {
      const p = this.removedMarkerPath(adapterKey);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }

  ensureDir() {
    const d = getConfigRootDir();
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /**
   * @param {string} adapterKey
   * @returns {object | null} raw YAML document
   */
  load(adapterKey) {
    try {
      const p = this.filePath(adapterKey);
      if (!fs.existsSync(p)) return null;
      const text = fs.readFileSync(p, 'utf8');
      const doc = YAML.parse(text);
      return doc && typeof doc === 'object' ? doc : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} adapterKey
   * @param {object} doc full document (schemaVersion, adapterKey, …)
   */
  saveFull(adapterKey, doc) {
    this.ensureDir();
    const k = assertSafeAdapterKey(adapterKey);
    this.clearRemovedMarker(k);
    const merged = { ...defaultInstallDocument(k), ...doc, adapterKey: k };
    merged.updatedAt = new Date().toISOString();
    if (!merged.installedAt) merged.installedAt = merged.updatedAt;
    const p = this.filePath(k);
    const header =
      '# Smart Park OS — adapter install config (YAML). Managed by PATCH/POST install-local only.\n';
    const body = YAML.stringify(merged, 8, 2);
    fs.writeFileSync(p, `${header}${body}`, 'utf8');
    return merged;
  }

  /**
   * @param {string} adapterKey
   */
  delete(adapterKey) {
    try {
      const p = this.filePath(adapterKey);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      this.writeRemovedMarker(adapterKey);
    } catch {
      /* ignore */
    }
  }

  /**
   * API/UI shape under metadata.install (always includes storage hint).
   * @param {object} doc
   */
  toMetadataInstall(doc) {
    const k = assertSafeAdapterKey(doc.adapterKey);
    return {
      storage: 'yaml',
      configFile: `${k}.install.yaml`,
      configJson: doc.configJson && typeof doc.configJson === 'object' ? doc.configJson : {},
      contextJson: doc.contextJson && typeof doc.contextJson === 'object' ? doc.contextJson : {},
      outputProfiles: Array.isArray(doc.outputProfiles) ? doc.outputProfiles : [],
      emitEnabled: doc.emitEnabled === true,
      ingestCanonicalEnabled: doc.ingestCanonicalEnabled === true,
      scheduleCron:
        doc.scheduleCron != null && String(doc.scheduleCron).trim() !== ''
          ? String(doc.scheduleCron).trim()
          : null,
      installedAt: doc.installedAt || null,
      updatedAt: doc.updatedAt || null,
    };
  }

  defaultMetadataInstall(adapterKey) {
    return this.toMetadataInstall(defaultInstallDocument(adapterKey));
  }
}

module.exports = {
  AdapterInstallConfigRepository,
  getConfigRootDir,
  assertSafeAdapterKey,
  defaultInstallDocument,
};
