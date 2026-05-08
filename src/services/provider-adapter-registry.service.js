const { ProviderAdapterRegistry } = require('../integrations/adapters/provider-adapter-registry');
const { ProviderAdapterConfigRepository } = require('../repositories/provider-adapter-config.repository');
const { AdapterFrameworkService } = require('../modules/integrations/adapter-framework/adapter-framework.service');

class ProviderAdapterRegistryService {
  constructor() {
    this.registry = new ProviderAdapterRegistry();
    this.configRepository = new ProviderAdapterConfigRepository();
    this.frameworkService = new AdapterFrameworkService();
  }

  async ensureSeedConfigs() {
    await this.frameworkService.reloadLocalPackages();
    for (const info of this.registry.listProviderInfos()) {
      await this.configRepository.upsertByProvider(info.provider, {
        name: info.name,
        baseUrl: info.baseUrl,
        enabled: true,
        capabilities: info.capabilities,
      });
    }
  }

  listProviderInfos() {
    return this.registry.listProviderInfos().map((info) => ({
      ...info,
      runtimePackageAvailable: this.frameworkService.hasPackageRuntime(info.provider),
    }));
  }

  getAdapter(provider) {
    return this.registry.get(provider);
  }

  listConfigs() {
    return this.configRepository.findAll();
  }

  getConfig(provider) {
    return this.configRepository.findByProvider(provider);
  }

  patchConfig(provider, patch) {
    return this.configRepository.upsertByProvider(provider, patch);
  }

  listInstalledAdapterPackages() {
    return this.frameworkService.listInstalled();
  }

  reloadLocalAdapterPackages() {
    return this.frameworkService.reloadLocalPackages();
  }

  healthAdapterPackage(adapterKey, config = {}, context = {}) {
    return this.frameworkService.health(adapterKey, config, context);
  }

  installLocalAdapterPackage(body) {
    return this.frameworkService.installLocalPackage(body);
  }

  getInstalledAdapterRecord(idOrKey) {
    return this.frameworkService.getInstalledPackageRecord(idOrKey);
  }

  patchInstalledAdapterPackage(idOrKey, body) {
    return this.frameworkService.patchInstalledPackage(idOrKey, body);
  }

  uninstallInstalledAdapterPackage(idOrKey) {
    return this.frameworkService.uninstallInstalledPackage(idOrKey);
  }
}

module.exports = { ProviderAdapterRegistryService };
