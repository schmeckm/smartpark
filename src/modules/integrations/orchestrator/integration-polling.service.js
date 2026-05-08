'use strict';

/**
 * IntegrationPollingService
 *
 * Background loop that periodically triggers live integration sync
 * when both:
 *   - app-level setting (`integration.pollingEnabled`) is on, AND
 *   - platform-level setting (`EXTERNAL_PARK_DATA_ENABLED`) is true.
 *
 * Interval is read on every tick from app_settings
 * (`integration.pollingIntervalSeconds`); the platform setting
 * `EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS` seeds the default. The
 * loop survives provider failures (logs and continues).
 *
 * Phase C3.8 — extracted from IntegrationOrchestratorService.
 *
 * Pure-DI: no module-level singletons, no side effects on construction.
 */
class IntegrationPollingService {
  /**
   * @param {object} deps
   * @param {object} deps.settingRepository - AppSettingRepository-like; needs getValue(key, fallback)
   * @param {Function} deps.syncLive - async function invoked on every active tick
   * @param {Function} deps.platformSettingsFactory - zero-arg factory returning a PlatformSettingsService instance
   * @param {object} deps.settingKeys - object with at least pollingEnabled + pollingIntervalSeconds string values
   * @param {object} [deps.logger] - pino-style logger (debug + warn). Optional; falls back to no-op.
   * @param {Function} [deps.sleepFn] - test seam; defaults to setTimeout-based sleep
   * @param {number} [deps.intervalMinSeconds=30]
   * @param {number} [deps.intervalMaxSeconds=86400]
   * @param {number} [deps.intervalDefaultSeconds=300]
   * @param {number} [deps.failureBackoffMs=60000] - wait used when settings read throws
   */
  constructor({
    settingRepository,
    syncLive,
    platformSettingsFactory,
    settingKeys,
    logger,
    sleepFn,
    intervalMinSeconds = 30,
    intervalMaxSeconds = 86400,
    intervalDefaultSeconds = 300,
    failureBackoffMs = 60_000,
  } = {}) {
    if (!settingRepository || typeof settingRepository.getValue !== 'function') {
      throw new TypeError('IntegrationPollingService: settingRepository.getValue is required');
    }
    if (typeof syncLive !== 'function') {
      throw new TypeError('IntegrationPollingService: syncLive must be a function');
    }
    if (typeof platformSettingsFactory !== 'function') {
      throw new TypeError('IntegrationPollingService: platformSettingsFactory must be a function');
    }
    if (!settingKeys || typeof settingKeys !== 'object') {
      throw new TypeError('IntegrationPollingService: settingKeys is required');
    }
    if (!settingKeys.pollingEnabled || !settingKeys.pollingIntervalSeconds) {
      throw new TypeError(
        'IntegrationPollingService: settingKeys must include pollingEnabled and pollingIntervalSeconds'
      );
    }

    this._settingRepository = settingRepository;
    this._syncLive = syncLive;
    this._platformSettingsFactory = platformSettingsFactory;
    this._settingKeys = settingKeys;
    this._logger = logger ?? { debug: () => {}, warn: () => {} };
    this._sleep = typeof sleepFn === 'function'
      ? sleepFn
      : (ms) => new Promise((r) => setTimeout(r, ms));
    this._intervalMin = intervalMinSeconds;
    this._intervalMax = intervalMaxSeconds;
    this._intervalDefault = intervalDefaultSeconds;
    this._failureBackoffMs = failureBackoffMs;
  }

  /**
   * Start the background polling loop.
   * Returns a cancel function that flips an internal flag; the loop
   * exits after the next sleep tick (or immediately, if the cancel
   * function is called before the first tick).
   *
   * Calling start() multiple times spawns independent loops — each
   * with its own cancel function.
   *
   * @returns {() => void}
   */
  start() {
    const state = { cancelled: false };

    void this._runLoop(state);

    return () => {
      state.cancelled = true;
    };
  }

  async _runLoop(state) {
    while (!state.cancelled) {
      let waitMs = this._failureBackoffMs;
      try {
        const ps = this._platformSettingsFactory();
        const pollingEnabled = await this._settingRepository.getValue(
          this._settingKeys.pollingEnabled,
          { enabled: false }
        );
        const intervalSetting = await this._settingRepository.getValue(
          this._settingKeys.pollingIntervalSeconds,
          {
            seconds: await ps.getNumber(
              'EXTERNAL_PARK_DATA_POLL_INTERVAL_SECONDS',
              this._intervalDefault
            ),
          }
        );
        const seconds = Math.max(
          this._intervalMin,
          Math.min(this._intervalMax, Number(intervalSetting?.seconds) || this._intervalDefault)
        );
        waitMs = seconds * 1000;

        const masterEnabled = await ps.getBoolean('EXTERNAL_PARK_DATA_ENABLED', true);
        if (pollingEnabled?.enabled && masterEnabled) {
          await this._syncLive();
        } else if (pollingEnabled?.enabled && !masterEnabled) {
          this._logger.debug(
            { key: this._settingKeys.pollingEnabled },
            'external park polling enabled in app_settings but EXTERNAL_PARK_DATA_ENABLED is false — skipping live sync'
          );
        }
      } catch (e) {
        this._logger.warn({ err: e?.message }, 'external integration polling failed');
      }

      if (state.cancelled) break;
      await this._sleep(waitMs);
    }
  }
}

module.exports = { IntegrationPollingService };
