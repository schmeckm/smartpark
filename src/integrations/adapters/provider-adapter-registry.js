const { ThemeParksWikiAdapter } = require('./themeparks-wiki.adapter');
const { WartezeitenAppAdapter } = require('./wartezeiten-app.adapter');
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
