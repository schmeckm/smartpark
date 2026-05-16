const { AdapterPackageRepository } = require('../../../repositories/adapter-package.repository');
const {
  AdapterInstallConfigRepository,
  defaultInstallDocument,
} = require('../../../repositories/adapter-install-config.repository');
const { AdapterPackageLoaderService } = require('./adapter-package-loader.service');
const { extractManifestUi } = require('../../../utils/adapter-manifest-ui');
const { AppError } = require('../../../utils/app-error');
const { DEFAULT_INSTALL_OUTPUT_PROFILES } = require('./adapter-output-profile-names');
const { mergeAdapterInstallConfig } = require('../../../utils/adapter-install-config-merge');

function resolveInstallOutputProfiles(list) {
  return Array.isArray(list) && list.length ? list : [...DEFAULT_INSTALL_OUTPUT_PROFILES];
}

/** `AdapterPackage.id` is UUID; `findByPk` with a slug adapterKey causes Postgres 22P02 before fallback runs. */
function looksLikeUuidPk(idOrKey) {
  const t = String(idOrKey || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

class AdapterFrameworkService {
  constructor() {
    this.unifiedLoader = new AdapterPackageLoaderService();
    this.repo = new AdapterPackageRepository();
    this.installConfigRepo = new AdapterInstallConfigRepository();
    this.runtimeMap = new Map();
  }

  async reloadLocalPackages() {
    // Single root (`src/integrations/adapter-packages`) — keeps DB/registry in sync with
    // scanPackages() / Devices & Services. Historical note: when a separate legacy root existed,
    // a legacy-only load left OPC-UA cards without rows → GET 404.
    const loaded = this.unifiedLoader.loadAll();
    this.runtimeMap.clear();
    for (const item of loaded) {
      this.runtimeMap.set(item.manifest.adapterKey, item);
      const key = item.manifest.adapterKey;
      if (this.installConfigRepo.isMarkedRemoved(key)) {
        continue;
      }
      const existing = await this.repo.findByAdapterKey(key);
      const prevMeta = existing?.metadata && typeof existing.metadata === 'object' ? { ...existing.metadata } : {};
      await this.repo.upsertByAdapterKey(key, {
        name: item.manifest.name,
        version: item.manifest.version,
        runtime: item.manifest.runtime,
        adapterType: item.manifest.adapterType,
        sourceType: 'LOCAL_PACKAGE',
        sourcePath: item.packageDir,
        capabilities: item.manifest.capabilities || [],
        configSchema: item.manifest.configSchema || {},
        permissions: item.manifest.permissions || {},
        enabled: true,
        status: 'INSTALLED',
        metadata: {
          ...prevMeta,
          description: typeof item.manifest.description === 'string' ? item.manifest.description : null,
          providedDomains: Array.isArray(item.manifest.providedDomains) ? item.manifest.providedDomains : [],
          providedMetrics: Array.isArray(item.manifest.providedMetrics) ? item.manifest.providedMetrics : [],
          iotClass: item.manifest.iotClass || null,
          ui: extractManifestUi(item.manifest),
        },
      });
    }
    return loaded.map((x) => x.manifest);
  }

  async listInstalled() {
    const rows = await this.repo.findAll();
    return rows.map((r) => this.hydrateInstallConfig(r));
  }

  getRuntime(adapterKey) {
    return this.runtimeMap.get(adapterKey)?.runtime || null;
  }

  /**
   * Resolve { manifest, runtime, packageDir } from bootstrap map or on-demand load
   * via {@link AdapterPackageLoaderService} (`src/integrations/adapter-packages`).
   */
  _resolveLoaded(adapterKey) {
    let loaded = this.runtimeMap.get(adapterKey);
    if (loaded?.runtime) return loaded;
    loaded = this.unifiedLoader.loadByAdapterKey(adapterKey);
    if (loaded?.runtime) {
      this.runtimeMap.set(adapterKey, loaded);
    }
    return loaded || null;
  }

  async health(adapterKey, config = {}, context = {}) {
    const loaded = this._resolveLoaded(adapterKey);
    if (!loaded?.runtime) {
      return { ok: false, error: 'Adapter runtime not loaded (package not found or invalid manifest)' };
    }
    const mergedConfig = mergeAdapterInstallConfig(config, context);
    return loaded.runtime.health(mergedConfig, context);
  }

  /** True if a filesystem adapter package (legacy or integrations/) loads for this key. */
  hasPackageRuntime(adapterKey) {
    return Boolean(this._resolveLoaded(adapterKey)?.runtime);
  }

  /**
   * Merge YAML (or legacy DB install) into API row shape.
   * @param {import('sequelize').Model|object} row
   */
  hydrateInstallConfig(row) {
    const j = row.toJSON ? row.toJSON() : row;
    const key = j.adapterKey;
    const fromFile = this.installConfigRepo.load(key);
    if (fromFile) {
      return {
        ...j,
        metadata: {
          ...(j.metadata && typeof j.metadata === 'object' ? j.metadata : {}),
          install: this.installConfigRepo.toMetadataInstall(fromFile),
        },
      };
    }
    const legacy = j.metadata?.install;
    if (legacy && typeof legacy === 'object' && Object.keys(legacy).length > 0) {
      return {
        ...j,
        metadata: {
          ...(j.metadata && typeof j.metadata === 'object' ? j.metadata : {}),
          install: { ...legacy, storage: 'legacy_db' },
        },
      };
    }
    return {
      ...j,
      metadata: {
        ...(j.metadata && typeof j.metadata === 'object' ? j.metadata : {}),
        install: { ...this.installConfigRepo.defaultMetadataInstall(key), storage: 'none' },
      },
    };
  }

  _stripInstallFromMetadata(meta) {
    if (!meta || typeof meta !== 'object') return {};
    const { install: _removed, ...rest } = meta;
    return rest;
  }

  _legacyInstallToDoc(adapterKey, install) {
    if (!install || typeof install !== 'object') return null;
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      adapterKey,
      installedAt: install.installedAt || now,
      updatedAt: now,
      configJson: install.configJson && typeof install.configJson === 'object' ? install.configJson : {},
      contextJson: install.contextJson && typeof install.contextJson === 'object' ? install.contextJson : {},
      outputProfiles: resolveInstallOutputProfiles(install.outputProfiles),
      emitEnabled: install.emitEnabled === true,
      ingestCanonicalEnabled: install.ingestCanonicalEnabled === true,
      scheduleCron:
        install.scheduleCron != null && install.scheduleCron !== '' ? String(install.scheduleCron) : null,
    };
  }

  /**
   * Persist adapter_packages row + YAML install config (all adapters use the same repository).
   * @param {object} body
   */
  async installLocalPackage(body) {
    const key = body.adapterKey;
    const loaded = this.unifiedLoader.loadByAdapterKey(key);
    if (!loaded?.manifest) {
      throw new AppError(`Adapter package not found: ${key}`, 404, { code: 'NOT_FOUND' });
    }
    const m = loaded.manifest;
    const existing = await this.repo.findByAdapterKey(key);
    const prevMeta = existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};

    const now = new Date().toISOString();
    const existingDoc = this.installConfigRepo.load(key);
    const doc = {
      ...(existingDoc || defaultInstallDocument(key)),
      installedAt: existingDoc?.installedAt || now,
      updatedAt: now,
      configJson:
        body.configJson && typeof body.configJson === 'object'
          ? body.configJson
          : (existingDoc?.configJson ?? {}),
      contextJson:
        body.contextJson && typeof body.contextJson === 'object'
          ? body.contextJson
          : (existingDoc?.contextJson ?? {}),
      outputProfiles: resolveInstallOutputProfiles(body.outputProfiles ?? existingDoc?.outputProfiles),
      emitEnabled:
        typeof body.emitEnabled === 'boolean' ? body.emitEnabled : existingDoc?.emitEnabled === true,
      ingestCanonicalEnabled:
        typeof body.ingestCanonicalEnabled === 'boolean'
          ? body.ingestCanonicalEnabled
          : existingDoc?.ingestCanonicalEnabled === true,
      scheduleCron:
        body.scheduleCron != null
          ? (body.scheduleCron !== '' ? String(body.scheduleCron) : null)
          : (existingDoc?.scheduleCron ?? null),
    };
    this.installConfigRepo.saveFull(key, doc);

    const metaRest = this._stripInstallFromMetadata(prevMeta);
    const metadata = {
      ...metaRest,
      ui: extractManifestUi(m),
    };

    await this.repo.upsertByAdapterKey(key, {
      name: (body.name && String(body.name).trim()) || m.name,
      version: m.version,
      runtime: m.runtime || 'NODE',
      adapterType: m.adapterType || 'PUBLIC_API',
      sourceType: 'LOCAL_PACKAGE',
      sourcePath: loaded.packageDir,
      capabilities: m.capabilities || [],
      configSchema: m.configSchema || {},
      permissions: m.permissions || {},
      enabled: true,
      status: 'ACTIVE',
      metadata,
    });
    const row = await this.repo.findByAdapterKey(key);
    return this.hydrateInstallConfig(row);
  }

  async _findInstalledRowByIdOrKey(idOrKey) {
    if (looksLikeUuidPk(idOrKey)) {
      return (await this.repo.findByPk(idOrKey)) || (await this.repo.findByAdapterKey(idOrKey));
    }
    return this.repo.findByAdapterKey(idOrKey);
  }

  async getInstalledPackageRecord(idOrKey) {
    const raw = await this._findInstalledRowByIdOrKey(idOrKey);
    if (!raw) return null;
    return this.hydrateInstallConfig(raw);
  }

  /**
   * Update install config YAML only; DB metadata no longer stores install blob.
   * @param {string} idOrKey — UUID or adapterKey
   * @param {object} body — validated patch body
   */
  async patchInstalledPackage(idOrKey, body) {
    const existing = await this._findInstalledRowByIdOrKey(idOrKey);
    if (!existing) {
      throw new AppError('Installed adapter not found', 404, { code: 'NOT_FOUND' });
    }
    const key = existing.adapterKey;
    const loaded = this.unifiedLoader.loadByAdapterKey(key);
    if (!loaded?.manifest) {
      throw new AppError(`Adapter package not found on disk: ${key}`, 404, { code: 'NOT_FOUND' });
    }
    const m = loaded.manifest;
    const plain = existing.toJSON ? existing.toJSON() : existing;
    const prevMeta = plain.metadata && typeof plain.metadata === 'object' ? plain.metadata : {};
    const prevInstall = prevMeta.install && typeof prevMeta.install === 'object' ? prevMeta.install : {};

    let base =
      this.installConfigRepo.load(key) ||
      this._legacyInstallToDoc(key, prevInstall) ||
      defaultInstallDocument(key);

    if (Object.prototype.hasOwnProperty.call(body, 'configJson')) {
      base.configJson = body.configJson && typeof body.configJson === 'object' ? body.configJson : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, 'contextJson')) {
      base.contextJson = body.contextJson && typeof body.contextJson === 'object' ? body.contextJson : {};
    }
    if (Object.prototype.hasOwnProperty.call(body, 'outputProfiles')) {
      base.outputProfiles = Array.isArray(body.outputProfiles) ? body.outputProfiles : [];
    }
    if (Object.prototype.hasOwnProperty.call(body, 'emitEnabled')) {
      base.emitEnabled = body.emitEnabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'ingestCanonicalEnabled')) {
      base.ingestCanonicalEnabled = body.ingestCanonicalEnabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'scheduleCron')) {
      base.scheduleCron =
        body.scheduleCron != null && String(body.scheduleCron).trim() !== ''
          ? String(body.scheduleCron).trim()
          : null;
    }
    if (!base.installedAt) base.installedAt = new Date().toISOString();

    this.installConfigRepo.saveFull(key, base);

    const metaRest = this._stripInstallFromMetadata(prevMeta);
    const metadata = {
      ...metaRest,
      ui: extractManifestUi(m),
    };

    let nextEnabled = plain.enabled !== false;
    let nextStatus = String(plain.status || 'ACTIVE').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
      nextEnabled = body.enabled !== false;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      const s = String(body.status || '').trim().toUpperCase();
      if (s) nextStatus = s;
    }

    await this.repo.upsertByAdapterKey(key, {
      name: plain.name || m.name,
      version: m.version,
      runtime: m.runtime || 'NODE',
      adapterType: m.adapterType || 'PUBLIC_API',
      sourceType: plain.sourceType || 'LOCAL_PACKAGE',
      sourcePath: loaded.packageDir,
      capabilities: m.capabilities || [],
      configSchema: m.configSchema || {},
      permissions: m.permissions || {},
      enabled: nextEnabled,
      status: nextStatus,
      metadata,
    });
    const updated = await this.repo.findByAdapterKey(key);
    return this.hydrateInstallConfig(updated);
  }

  /**
   * Remove DB row and delete YAML install file for this adapter.
   * @param {string} idOrKey
   */
  async uninstallInstalledPackage(idOrKey) {
    const existing = await this._findInstalledRowByIdOrKey(idOrKey);
    if (!existing) {
      throw new AppError('Installed adapter not found', 404, { code: 'NOT_FOUND' });
    }
    const key = existing.adapterKey;
    this.installConfigRepo.delete(key);
    await existing.destroy();
    return { adapterKey: key, removed: true };
  }
}

module.exports = { AdapterFrameworkService };
