'use strict';

/**
 * Phase C3.3 — extracted from `IntegrationOrchestratorService`.
 *
 * Owns the integration-related entries in `app_settings`:
 *   - `seedDefaults()`  — runtime-side-effect-heavy bootstrap (was the
 *                         orchestrator's `bootstrap()` method).
 *   - `get()`           — settings document used by GET /integrations/settings.
 *   - `patch(input)`    — partial update, was `patchSettings(input)`.
 *
 * Cross-cutting bits the service does NOT own:
 *   - `resolveUnsParkKey()` / `selectedParkOrThrow()` — they remain on
 *     the orchestrator until C3.7 because the sync pipeline (still in
 *     the orchestrator) consumes them as well. The settings service
 *     receives a `unsParkKeyResolver` callback so `get()` can include
 *     the key in its response without taking a hard dependency on the
 *     provider browser.
 *   - The `unsSparkplugSchemaOverride` document itself — owned by
 *     `SparkplugTopicSchemaService` (C3.4); only the *summary block*
 *     in the settings response is computed here, by reading the same
 *     setting key.
 *
 * The 10-key `INTEGRATION_SETTING_KEYS` map is exported so other
 * extracted modules can import a single source of truth instead of
 * inlining the strings.
 */

const { getPlatformSettingsService } = require('../../../services/platform-settings.service');
const { AppSettingRepository } = require('../../../repositories/app-setting.repository');
const { DEFAULT_AI_FACTOR_CONFIGS } = require('../../../constants/ai-factor-config');
const { loadEntityDomainRegistry } = require('../../uns/theme-parks-entity-domain.service');

/**
 * Persistence keys. RENAMING ANY OF THESE IS A DATA MIGRATION, NOT A
 * REFACTOR. The contract test in
 * `src/services/integration-orchestrator.service.contract.test.js`
 * pins the values; touching them without a migration breaks every
 * deployment.
 */
const INTEGRATION_SETTING_KEYS = Object.freeze({
  selectedProvider: 'externalParkData.selectedProvider',
  selectedDestination: 'externalParkData.selectedDestination',
  selectedPark: 'externalParkData.selectedPark',
  dataSourceMode: 'externalParkData.dataSourceMode',
  autoApplyEnabled: 'externalParkData.autoApplyEnabled',
  pollingEnabled: 'externalParkData.pollingEnabled',
  pollingIntervalSeconds: 'externalParkData.pollingIntervalSeconds',
  aiForecastFactors: 'ai.forecast.factorConfigs',
  unsManualNodes: 'uns.manualNodes',
  unsSparkplugSchemaOverride: 'uns.sparkplugTopicSchema',
});

const DEFAULT_PROVIDER = 'themeparks_wiki';
const DEFAULT_DATA_SOURCE_MODE = 'MQTT_UNS';
const DEFAULT_FACTOR_BY_CODE = new Map(DEFAULT_AI_FACTOR_CONFIGS.map((row) => [row.code, row]));

function normalizeAiForecastFactors(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return DEFAULT_AI_FACTOR_CONFIGS.map((row) => ({ ...row }));
  }
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const code = typeof row.code === 'string' ? row.code : '';
    const template = DEFAULT_FACTOR_BY_CODE.get(code);
    if (!template) return row;
    // For known factor codes, source/provider are canonical metadata and should not drift.
    return {
      ...row,
      source: template.source,
      provider: Object.hasOwn(template, 'provider') ? template.provider : null,
    };
  });
}

class IntegrationSettingsService {
  /**
   * @param {{
   *   settingRepository?: { findByKey: Function, getValue: Function, upsertValue: Function, deleteByKey: Function },
   *   registryService?: { ensureSeedConfigs: Function },
   *   unsParkKeyResolver?: () => Promise<string>,
   *   platformSettingsFactory?: () => any,
   *   entityDomainRegistryLoader?: (repo: object) => Promise<unknown>,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.settingRepository = deps.settingRepository || new AppSettingRepository();
    this.registryService = deps.registryService || null;
    this.unsParkKeyResolver = deps.unsParkKeyResolver || (async () => 'europa_park');
    this.platformSettingsFactory = deps.platformSettingsFactory || getPlatformSettingsService;
    this.entityDomainRegistryLoader = deps.entityDomainRegistryLoader || loadEntityDomainRegistry;
  }

  /**
   * One-shot bootstrap called at process start. Creates default rows
   * in `app_settings` if they don't exist yet, ensures every provider
   * adapter has an enabled config row, and warms the theme-parks
   * entity-domain registry from persisted state. Idempotent.
   */
  async seedDefaults() {
    const ps = this.platformSettingsFactory();
    if (this.registryService && typeof this.registryService.ensureSeedConfigs === 'function') {
      await this.registryService.ensureSeedConfigs();
    }
    await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.selectedProvider, {
      provider: await ps.getString('EXTERNAL_PARK_DATA_DEFAULT_PROVIDER', DEFAULT_PROVIDER),
    });
    if (!(await this.settingRepository.findByKey(INTEGRATION_SETTING_KEYS.dataSourceMode))) {
      await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.dataSourceMode, {
        mode: DEFAULT_DATA_SOURCE_MODE,
      });
    }
    await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.autoApplyEnabled, { enabled: true });
    // Do not overwrite polling flags on every restart — users enable them in Integration settings.
    if (!(await this.settingRepository.findByKey(INTEGRATION_SETTING_KEYS.pollingEnabled))) {
      await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.pollingEnabled, {
        enabled: await ps.getBoolean('EXTERNAL_PARK_DATA_ENABLED', true),
      });
    }
    if (!(await this.settingRepository.findByKey(INTEGRATION_SETTING_KEYS.pollingIntervalSeconds))) {
      await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.pollingIntervalSeconds, {
        seconds: await ps.getNumber('EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS', 120),
      });
    }
    const existingFactors = await this.settingRepository.getValue(
      INTEGRATION_SETTING_KEYS.aiForecastFactors,
      null
    );
    if (!Array.isArray(existingFactors) || !existingFactors.length) {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.aiForecastFactors,
        DEFAULT_AI_FACTOR_CONFIGS
      );
    } else {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.aiForecastFactors,
        normalizeAiForecastFactors(existingFactors)
      );
    }
    await this.entityDomainRegistryLoader(this.settingRepository);
  }

  /**
   * Build the settings document returned by GET /integrations/settings.
   */
  async get() {
    const unsParkKey = await this.unsParkKeyResolver();
    const ps = this.platformSettingsFactory();
    const selectedPark = await this.settingRepository.getValue(INTEGRATION_SETTING_KEYS.selectedPark, null);
    const overrideSnap = await this.settingRepository.getValue(
      INTEGRATION_SETTING_KEYS.unsSparkplugSchemaOverride,
      null
    );
    const overrideActive = Boolean(
      overrideSnap?.entries?.length &&
        selectedPark?.provider &&
        selectedPark?.externalParkId &&
        overrideSnap.provider === selectedPark.provider &&
        overrideSnap.externalParkId === selectedPark.externalParkId
    );
    return {
      selectedProvider: await this.settingRepository.getValue(INTEGRATION_SETTING_KEYS.selectedProvider, {
        provider: DEFAULT_PROVIDER,
      }),
      selectedDestination: await this.settingRepository.getValue(
        INTEGRATION_SETTING_KEYS.selectedDestination,
        null
      ),
      selectedPark,
      dataSourceMode: await this.settingRepository.getValue(INTEGRATION_SETTING_KEYS.dataSourceMode, {
        mode: DEFAULT_DATA_SOURCE_MODE,
      }),
      unsParkKey,
      unsTopicSchemaOverrideSummary: {
        active: overrideActive,
        entryCount: overrideActive ? overrideSnap.entries.length : 0,
        updatedAt: overrideSnap?.updatedAt || null,
      },
      autoApplyEnabled: await this.settingRepository.getValue(INTEGRATION_SETTING_KEYS.autoApplyEnabled, {
        enabled: true,
      }),
      pollingEnabled: await this.settingRepository.getValue(INTEGRATION_SETTING_KEYS.pollingEnabled, {
        enabled: false,
      }),
      pollingIntervalSeconds: await this.settingRepository.getValue(
        INTEGRATION_SETTING_KEYS.pollingIntervalSeconds,
        {
          seconds: await ps.getNumber('EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS', 120),
        }
      ),
      aiForecastFactors: normalizeAiForecastFactors(
        await this.settingRepository.getValue(
          INTEGRATION_SETTING_KEYS.aiForecastFactors,
          DEFAULT_AI_FACTOR_CONFIGS
        )
      ),
    };
  }

  /**
   * Apply a partial settings patch and return the freshly recomputed
   * settings document. `null` for `selectedDestination` / `selectedPark`
   * deletes the row instead of writing a `null` value.
   */
  async patch(input) {
    if (Object.hasOwn(input, 'selectedProvider')) {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.selectedProvider,
        input.selectedProvider
      );
    }
    if (Object.hasOwn(input, 'selectedDestination')) {
      if (input.selectedDestination == null) {
        await this.settingRepository.deleteByKey(INTEGRATION_SETTING_KEYS.selectedDestination);
      } else {
        await this.settingRepository.upsertValue(
          INTEGRATION_SETTING_KEYS.selectedDestination,
          input.selectedDestination
        );
      }
    }
    if (Object.hasOwn(input, 'selectedPark')) {
      if (input.selectedPark == null) {
        await this.settingRepository.deleteByKey(INTEGRATION_SETTING_KEYS.selectedPark);
      } else {
        await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.selectedPark, input.selectedPark);
      }
    }
    if (Object.hasOwn(input, 'dataSourceMode')) {
      await this.settingRepository.upsertValue(INTEGRATION_SETTING_KEYS.dataSourceMode, input.dataSourceMode);
    }
    if (Object.hasOwn(input, 'autoApplyEnabled')) {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.autoApplyEnabled,
        input.autoApplyEnabled
      );
    }
    if (Object.hasOwn(input, 'pollingEnabled')) {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.pollingEnabled,
        input.pollingEnabled
      );
    }
    if (Object.hasOwn(input, 'pollingIntervalSeconds')) {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.pollingIntervalSeconds,
        input.pollingIntervalSeconds
      );
    }
    if (Object.hasOwn(input, 'aiForecastFactors')) {
      await this.settingRepository.upsertValue(
        INTEGRATION_SETTING_KEYS.aiForecastFactors,
        normalizeAiForecastFactors(input.aiForecastFactors)
      );
    }
    return this.get();
  }
}

module.exports = {
  IntegrationSettingsService,
  INTEGRATION_SETTING_KEYS,
};
