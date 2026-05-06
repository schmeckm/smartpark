const { AppError } = require('../utils/app-error');
const { OutputRouterService } = require('./output-router.service');
const { AdapterPackageLoaderService } = require('./adapter-package-loader.service');
const { AdapterObservationValidatorService } = require('./adapter-observation-validator.service');
const { AdapterRunLogRepository } = require('../repositories/adapter-run-log.repository');
const { normalizeOutputProfiles } = require('./adapter-output-profile-names');
const { logAdapterPipeline } = require('./adapter-pipeline-log.service');
const { mergeAdapterInstallConfig } = require('../utils/adapter-install-config-merge');

const DEMO_STATIC_ADAPTER_KEY = 'demo_static_adapter';

function collectEncodeErrors(encodedOutputs) {
  const out = [];
  for (const enc of encodedOutputs || []) {
    for (const r of enc.results || []) {
      if (r.error) out.push({ profile: r.profile, error: String(r.error) });
    }
  }
  return out;
}

function collectMqttPublishFailures(emittedOutputs) {
  const out = [];
  for (const block of emittedOutputs || []) {
    const mqtt = block.actions?.mqtt;
    if (!Array.isArray(mqtt)) continue;
    for (const m of mqtt) {
      if (m && m.published === false) {
        out.push({
          profile: m.profile,
          topic: m.topic,
          reason: m.reason != null ? String(m.reason) : null,
        });
      }
    }
  }
  return out;
}

/**
 * Generic adapter runtime: adapters return entities + observations + health only;
 * core owns encode/emit (OutputRouterService) and optional adapter_run_logs (poll with DB).
 *
 * @see docs/adapter-runtime.md
 */
class AdapterRuntimeService {
  constructor() {
    this.loader = new AdapterPackageLoaderService();
    this.validator = new AdapterObservationValidatorService();
    this.outputRouter = new OutputRouterService();
    this.runLogRepository = new AdapterRunLogRepository();
  }

  async _createRunLog(payload) {
    try {
      return await this.runLogRepository.create({ ...payload, createdAt: new Date() });
    } catch (e) {
      return { error: e.message };
    }
  }

  loadAdapterPackage(adapterKey) {
    const loaded = this.loader.loadByAdapterKey(adapterKey);
    if (!loaded) {
      throw new AppError(`Adapter package not found: ${adapterKey}`, 404, { code: 'ADAPTER_NOT_FOUND' });
    }
    return loaded;
  }

  /**
   * Unified entry: poll | discover | health.
   * @param {object} p
   * @param {string} p.adapterKey
   * @param {'poll'|'discover'|'health'} p.mode
   * @param {object} [p.config]
   * @param {object} [p.context]
   * @param {string[]} [p.profiles] — poll only; aliases OK
   * @param {boolean} [p.emit] — poll only: MQTT + canonical when true
   * @param {boolean} [p.autoApply]
   * @param {object} [p.emitOptions] — poll only, overrides emit boolean if passed (emitMqtt, ingestCanonical)
   */
  async runAdapter(p) {
    const {
      adapterKey,
      mode,
      config = {},
      context = {},
      profiles: rawProfiles,
      emit = false,
      autoApply = true,
      emitOptions: extraEmit,
    } = p;

    if (mode === 'health') {
      return this._runAdapterHealth(adapterKey, config, context);
    }
    if (mode === 'discover') {
      return this._runAdapterDiscover(adapterKey, config, context);
    }
    if (mode === 'poll') {
      return this._runAdapterPoll(adapterKey, config, context, rawProfiles, emit, autoApply, extraEmit);
    }
    throw new AppError(`Unsupported mode: ${mode}`, 400, { code: 'INVALID_MODE' });
  }

  async _runAdapterHealth(adapterKey, config, context) {
    const errors = [];
    let manifestSummary = null;
    try {
      const loaded = this.loadAdapterPackage(adapterKey);
      manifestSummary = { name: loaded.manifest.name, version: loaded.manifest.version };
      const mergedConfig = mergeAdapterInstallConfig(config, context);
      const cfg = await loaded.runtime.validateConfig(mergedConfig, context);
      if (cfg && typeof cfg === 'object' && cfg.valid === false) {
        errors.push(cfg.errors?.length ? cfg.errors.join('; ') : 'validateConfig failed');
        logAdapterPipeline({
          adapterKey,
          source: 'adapter_runtime',
          level: 'warn',
          event: 'health_config_invalid',
          message: errors[0],
          detail: { mode: 'health', errors: cfg.errors },
        });
        return {
          success: false,
          adapterKey,
          mode: 'health',
          observations: [],
          discovered: [],
          health: null,
          encoded: [],
          emitted: [],
          errors,
          manifest: manifestSummary,
        };
      }
      const health = await loaded.runtime.health(mergedConfig, context);
      return {
        success: true,
        adapterKey,
        mode: 'health',
        observations: [],
        discovered: [],
        health,
        encoded: [],
        emitted: [],
        errors: [],
        manifest: manifestSummary,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      errors.push(e.message);
      logAdapterPipeline({
        adapterKey,
        source: 'adapter_runtime',
        level: 'error',
        event: 'health_runtime_error',
        message: e.message,
        detail: { mode: 'health' },
      });
      return {
        success: false,
        adapterKey,
        mode: 'health',
        observations: [],
        discovered: [],
        health: null,
        encoded: [],
        emitted: [],
        errors,
        manifest: manifestSummary,
      };
    }
  }

  async _runAdapterDiscover(adapterKey, config, context) {
    const errors = [];
    try {
      const loaded = this.loadAdapterPackage(adapterKey);
      const { runtime, manifest } = loaded;
      const mergedConfig = mergeAdapterInstallConfig(config, context);
      const cfg = await runtime.validateConfig(mergedConfig, context);
      if (cfg && typeof cfg === 'object' && cfg.valid === false) {
        errors.push(cfg.errors?.length ? cfg.errors.join('; ') : 'validateConfig failed');
        logAdapterPipeline({
          adapterKey,
          source: 'adapter_runtime',
          level: 'warn',
          event: 'discover_config_invalid',
          message: errors[0],
          detail: { mode: 'discover', errors: cfg.errors },
        });
        return {
          success: false,
          adapterKey,
          mode: 'discover',
          observations: [],
          discovered: [],
          health: null,
          encoded: [],
          emitted: [],
          errors,
          manifest: { name: manifest.name, version: manifest.version },
        };
      }
      let discovered = await runtime.discover(mergedConfig, context);
      if (!Array.isArray(discovered)) {
        errors.push('discover: must return an array');
        discovered = [];
        logAdapterPipeline({
          adapterKey,
          source: 'adapter_runtime',
          level: 'warn',
          event: 'discover_invalid_return',
          message: 'discover() did not return an array',
          detail: { mode: 'discover' },
        });
      }
      return {
        success: errors.length === 0,
        adapterKey,
        mode: 'discover',
        observations: [],
        discovered,
        health: null,
        encoded: [],
        emitted: [],
        errors,
        manifest: { name: manifest.name, version: manifest.version },
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      errors.push(e.message);
      logAdapterPipeline({
        adapterKey,
        source: 'adapter_runtime',
        level: 'error',
        event: 'discover_runtime_error',
        message: e.message,
        detail: { mode: 'discover' },
      });
      return {
        success: false,
        adapterKey,
        mode: 'discover',
        observations: [],
        discovered: [],
        health: null,
        encoded: [],
        emitted: [],
        errors,
        manifest: null,
      };
    }
  }

  async _runAdapterPoll(adapterKey, config, context, rawProfiles, emit, autoApply, extraEmit) {
    const normalizedProfiles = normalizeOutputProfiles(rawProfiles);
    let profiles;
    if (rawProfiles === undefined || rawProfiles === null) {
      profiles = undefined;
    } else if (normalizedProfiles === undefined) {
      profiles = [];
    } else {
      profiles = normalizedProfiles;
    }

    const emitMqtt = extraEmit?.emitMqtt === true || (extraEmit == null && emit === true);
    const ingestCanonical = extraEmit?.ingestCanonical === true || (extraEmit == null && emit === true);

    const legacy = await this.run({
      adapterKey,
      config,
      context,
      emitOptions: {
        profiles,
        emitMqtt,
        ingestCanonical,
        autoApply:
          extraEmit && Object.prototype.hasOwnProperty.call(extraEmit, 'autoApply')
            ? extraEmit.autoApply !== false
            : autoApply !== false,
      },
    });

    return this._pollLegacyToUnified(legacy, 'poll');
  }

  _pollLegacyToUnified(legacy, mode) {
    const errors = [...(legacy.errors || [])];
    for (const v of legacy.validationErrors || []) {
      const msg = (v.errors || []).map((e) => e.message || e).join(', ');
      errors.push(`observation[${v.index}]: ${msg}`);
    }
    const success = !legacy.errors?.length;

    return {
      success,
      adapterKey: legacy.adapterKey,
      mode,
      observations: legacy.observations || [],
      validationErrors: legacy.validationErrors || [],
      discovered: [],
      health: null,
      encoded: legacy.encodedOutputs || [],
      emitted: legacy.emittedOutputs || [],
      errors,
      manifest: legacy.manifest,
      runLog: legacy.runLog,
      runLogError: legacy.runLogError,
      debug: legacy.debug,
    };
  }

  /**
   * POST /integrations/adapters/run-local — poll pipeline (legacy + unified fields).
   * Use `emit: true` for MQTT + canonical together, or pass `emitMqtt` / `ingestCanonical` to control each.
   */
  async runLocal(body) {
    const granular =
      Object.prototype.hasOwnProperty.call(body, 'emitMqtt') ||
      Object.prototype.hasOwnProperty.call(body, 'ingestCanonical');
    const extraEmit = granular
      ? {
          emitMqtt: body.emitMqtt === true,
          ingestCanonical: body.ingestCanonical === true,
        }
      : undefined;

    const u = await this.runAdapter({
      adapterKey: body.adapterKey,
      mode: 'poll',
      config: body.config || {},
      context: body.context || {},
      profiles: body.profiles,
      emit: body.emit === true,
      autoApply: body.autoApply !== false,
      emitOptions: extraEmit,
    });
    return {
      adapterKey: u.adapterKey,
      manifest: u.manifest,
      observations: u.observations,
      validationErrors: u.validationErrors,
      encodedOutputs: u.encoded,
      emittedOutputs: u.emitted,
      errors: u.errors,
      runLog: u.runLog,
      runLogError: u.runLogError,
      success: u.success,
      mode: u.mode,
      encoded: u.encoded,
      emitted: u.emitted,
      debug: u.debug,
    };
  }

  /**
   * POST /integrations/adapters/discover-local
   */
  async discoverLocal(body) {
    const u = await this.runAdapter({
      adapterKey: body.adapterKey,
      mode: 'discover',
      config: body.config || {},
      context: body.context || {},
    });
    return {
      adapterKey: u.adapterKey,
      manifest: u.manifest,
      discovered: u.discovered,
      errors: u.errors,
      success: u.success,
      mode: u.mode,
    };
  }

  /**
   * POST /integrations/adapters/health-local
   */
  async healthLocal(body) {
    return this.runAdapter({
      adapterKey: body.adapterKey,
      mode: 'health',
      config: body.config || {},
      context: body.context || {},
    });
  }

  /**
   * Poll pipeline with adapter_run_log (used by runAdapter poll + runDemoAdapter).
   */
  async run({ adapterKey, config = {}, context = {}, emitOptions = {} }) {
    const errors = [];
    const loaded = this.loadAdapterPackage(adapterKey);
    const { runtime, manifest } = loaded;
    const runStartedIso = new Date().toISOString();
    const runT0 = Date.now();
    const runMeta = () => ({
      startedAt: runStartedIso,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - runT0,
    });

    const normalizedProfiles = normalizeOutputProfiles(emitOptions.profiles);
    let profiles;
    if (emitOptions.profiles === undefined || emitOptions.profiles === null) {
      profiles = undefined;
    } else if (normalizedProfiles === undefined) {
      profiles = [];
    } else {
      profiles = normalizedProfiles;
    }
    const { emitMqtt, ingestCanonical, autoApply } = {
      profiles,
      emitMqtt: emitOptions.emitMqtt === true,
      ingestCanonical: emitOptions.ingestCanonical === true,
      autoApply: emitOptions.autoApply !== false,
    };

    const mergedConfig = mergeAdapterInstallConfig(config, context);
    let cfg = await runtime.validateConfig(mergedConfig, context);
    if (cfg && typeof cfg === 'object' && cfg.valid === false) {
      const msg = cfg.errors?.length ? cfg.errors.join('; ') : 'validateConfig failed';
      errors.push(`config: ${msg}`);
      logAdapterPipeline({
        adapterKey: manifest.adapterKey,
        source: 'adapter_runtime',
        level: 'warn',
        event: 'poll_config_invalid',
        message: msg,
        detail: { errors: cfg.errors },
      });
      const row = await this._createRunLog({
        adapterKey: manifest.adapterKey,
        status: 'FAILED',
        observationCount: 0,
        validCount: 0,
        invalidCount: 0,
        summary: { operation: 'POLL', configInvalid: true, ...runMeta() },
        errorMessage: msg,
      });
      return {
        adapterKey: manifest.adapterKey,
        manifest: { name: manifest.name, version: manifest.version },
        observations: [],
        validationErrors: [],
        encodedOutputs: [],
        emittedOutputs: [],
        errors,
        runLog: row?.error ? null : row?.toJSON?.() || row,
        runLogError: row?.error || null,
        debug: {
          run: runMeta(),
          pollSkipped: true,
          pollSkippedReason: 'config_invalid',
          pollSkippedMessage: msg,
        },
      };
    }

    let rawList = [];
    let pollDebug = null;
    let pollShapeOk = false;
    try {
      const pollResult = await runtime.poll(mergedConfig, context);
      if (Array.isArray(pollResult)) {
        rawList = pollResult;
        pollShapeOk = true;
      } else if (
        pollResult &&
        typeof pollResult === 'object' &&
        Array.isArray(pollResult.observations)
      ) {
        rawList = pollResult.observations;
        pollDebug = pollResult.debug && typeof pollResult.debug === 'object' ? pollResult.debug : null;
        pollShapeOk = true;
      } else {
        errors.push('poll: must return an array of observations or { observations, debug }');
      }
    } catch (e) {
      errors.push(`poll: ${e.message}`);
      logAdapterPipeline({
        adapterKey: manifest.adapterKey,
        source: 'adapter_runtime',
        level: 'error',
        event: 'poll_failed',
        message: e.message,
        detail: { phase: 'poll' },
      });
      const row = await this._createRunLog({
        adapterKey: manifest.adapterKey,
        status: 'FAILED',
        observationCount: 0,
        validCount: 0,
        invalidCount: 0,
        summary: { operation: 'POLL', pollError: true, ...runMeta() },
        errorMessage: e.message,
      });
      return {
        adapterKey: manifest.adapterKey,
        manifest: { name: manifest.name, version: manifest.version },
        observations: [],
        validationErrors: [],
        encodedOutputs: [],
        emittedOutputs: [],
        errors,
        runLog: row?.error ? null : row?.toJSON?.() || row,
        runLogError: row?.error || null,
        debug: {
          run: runMeta(),
          pollSkipped: true,
          pollSkippedReason: 'poll_exception',
          pollSkippedMessage: e.message,
        },
      };
    }

    if (!pollShapeOk) {
      logAdapterPipeline({
        adapterKey: manifest.adapterKey,
        source: 'adapter_runtime',
        level: 'error',
        event: 'poll_invalid_return',
        message: 'poll() did not return a valid observations payload',
        detail: {},
      });
      const row = await this._createRunLog({
        adapterKey: manifest.adapterKey,
        status: 'FAILED',
        observationCount: 0,
        validCount: 0,
        invalidCount: 0,
        summary: { operation: 'POLL', invalidPollShape: true, ...runMeta() },
        errorMessage: errors.join(' | ') || 'poll invalid return',
      });
      return {
        adapterKey: manifest.adapterKey,
        manifest: { name: manifest.name, version: manifest.version },
        observations: [],
        validationErrors: [],
        encodedOutputs: [],
        emittedOutputs: [],
        errors,
        runLog: row?.error ? null : row?.toJSON?.() || row,
        runLogError: row?.error || null,
        debug: {
          ...(pollDebug || {}),
          run: runMeta(),
          pollSkipped: true,
          pollSkippedReason: 'poll_invalid_return',
          pollSkippedMessage: errors.join(' | ') || 'poll invalid return',
        },
      };
    }

    const { valid, invalid: validationErrors } = this.validator.validateMany(rawList);

    const encodedOutputs = [];
    const emittedOutputs = [];

    for (const obs of valid) {
      const encoded = this.outputRouter.encodeAll(obs, context, profiles);
      encodedOutputs.push(encoded);

      if (emitMqtt || ingestCanonical) {
        const emitted = await this.outputRouter.emit(obs, context, {
          profiles,
          emitMqtt,
          ingestCanonical,
          autoApply,
        });
        emittedOutputs.push(emitted);
      } else {
        emittedOutputs.push({
          results: encoded.results,
          profiles: encoded.profiles,
          actions: { mqtt: [], canonicalIngest: null, skipped: true, reason: 'emit_flags_disabled' },
        });
      }
    }

    let status = 'SUCCESS';
    if (errors.length) {
      status = 'FAILED';
    } else if (rawList.length > 0 && valid.length === 0) {
      status = 'FAILED';
    } else if (validationErrors.length) {
      status = 'PARTIAL';
    }

    const runLog = await this._createRunLog({
      adapterKey: manifest.adapterKey,
      status,
      observationCount: rawList.length,
      validCount: valid.length,
      invalidCount: validationErrors.length,
      summary: {
        operation: 'POLL',
        profiles: profiles || null,
        emitMqtt,
        ingestCanonical,
        validationErrors: validationErrors.map((v) => ({ index: v.index, errors: v.errors })),
        ...runMeta(),
      },
      errorMessage: errors.length ? errors.join(' | ') : null,
    });

    const encodeIssues = collectEncodeErrors(encodedOutputs);
    const mqttFailures = collectMqttPublishFailures(emittedOutputs);
    if (
      status === 'FAILED' ||
      status === 'PARTIAL' ||
      encodeIssues.length > 0 ||
      mqttFailures.length > 0
    ) {
      logAdapterPipeline({
        adapterKey: manifest.adapterKey,
        source: 'adapter_runtime',
        level: status === 'FAILED' ? 'error' : 'warn',
        event: 'poll_run_outcome',
        message:
          status === 'FAILED'
            ? 'Adapter poll finished with FAILED status'
            : 'Adapter poll finished with warnings (partial validation, encode, or MQTT)',
        detail: {
          status,
          observationCount: rawList.length,
          validCount: valid.length,
          invalidCount: validationErrors.length,
          validationSample: validationErrors.slice(0, 8).map((v) => ({ index: v.index, errors: v.errors })),
          encodeErrors: encodeIssues.slice(0, 12),
          mqttFailures: mqttFailures.slice(0, 12),
          emitMqtt,
          ingestCanonical,
        },
      });
    }

    const debug = pollDebug ? { ...pollDebug, run: runMeta() } : { run: runMeta() };

    return {
      adapterKey: manifest.adapterKey,
      manifest: { name: manifest.name, version: manifest.version },
      observations: valid,
      validationErrors,
      encodedOutputs,
      emittedOutputs,
      errors,
      runLog: runLog?.error ? null : runLog?.toJSON?.() || runLog,
      runLogError: runLog?.error || null,
      debug,
    };
  }

  runDemoAdapter(body) {
    const { config, context, profiles, emitMqtt, ingestCanonical, autoApply } = body;
    const normalizedProfiles = normalizeOutputProfiles(profiles);
    return this.run({
      adapterKey: DEMO_STATIC_ADAPTER_KEY,
      config: config || {},
      context: {
        parkSlug: 'europa_park',
        ...context,
      },
      emitOptions: {
        profiles: normalizedProfiles,
        emitMqtt: emitMqtt === true,
        ingestCanonical: ingestCanonical === true,
        autoApply: autoApply !== false,
      },
    });
  }
}

module.exports = { AdapterRuntimeService, DEMO_STATIC_ADAPTER_KEY };
