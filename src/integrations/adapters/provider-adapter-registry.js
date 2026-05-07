// Phase C1: provider-adapter HTTP client classes were co-located inside their
// adapter-package directories so each package is self-contained. The legacy
// registry below still imports them by class for backward compatibility with
// IntegrationOrchestratorService (Phase C2 will rebuild the registry directly
// from package manifests, removing these hard-coded imports).
const { ThemeParksWikiAdapter } = require('../adapter-packages/themeparks_wiki/client');
const { WartezeitenAppAdapter } = require('../adapter-packages/wartezeiten_app/client');
const { AppError } = require('../../utils/app-error');

class ProviderAdapterRegistry {
  constructor() {
    this.adapters = new Map();
    const themeparks = new ThemeParksWikiAdapter();
    const wartezeiten = new WartezeitenAppAdapter();
    this.adapters.set(themeparks.getProviderInfo().provider, themeparks);
    this.adapters.set(wartezeiten.getProviderInfo().provider, wartezeiten);
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

module.exports = { ProviderAdapterRegistry };
