'use strict';

/**
 * Joi schema for the structured feature-flag shape produced by
 * `getFlags()` in `feature-flags.js`. The schema validates **types and
 * ranges**, not presence: every leaf has a default that matches the
 * historical `src/config/env.js` fallback so boot does not fail on a
 * deployment that worked before A2.
 *
 * Strict mode (off by default) can be enabled later by passing
 * `{ allowUnknown: false, presence: 'required' }` to `validate()`. For now
 * every key is optional so existing dev/test/prod env files keep working.
 */

const Joi = require('joi');

const csv = Joi.string().allow('').default('');
const positiveInt = Joi.number().integer().min(0);
const positiveMs = Joi.number().integer().min(0);

const flagsSchema = Joi.object({
  runtime: Joi.object({
    nodeEnv: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
    port: Joi.number().integer().min(1).max(65535).default(3000),
    logLevel: Joi.string().default('info'),
  }).required(),

  auth: Joi.object({
    jwtSecret: Joi.string().min(1).required(),
    jwtAccessExpiresIn: Joi.string().default('15m'),
    jwtRefreshDays: Joi.number().integer().min(1).default(7),
  }).required(),

  db: Joi.object({
    host: Joi.string().min(1).required(),
    port: Joi.number().integer().min(1).max(65535).default(5432),
    name: Joi.string().min(1).required(),
    user: Joi.string().min(1).required(),
    password: Joi.string().min(1).required(),
  }).required(),

  cors: Joi.object({
    origin: Joi.string().default('*'),
  }).required(),

  mqtt: Joi.object({
    enabled: Joi.boolean().default(false),
    brokerUrl: Joi.string().uri({ scheme: ['mqtt', 'mqtts', 'ws', 'wss'] }).default('mqtt://127.0.0.1:1883'),
    clientId: Joi.string().default('smart-park-os-api'),
    username: Joi.string().allow('').default(''),
    password: Joi.string().allow('').default(''),
    capabilityGuardMode: Joi.string().valid('off', 'warn_only', 'enforce').default('off'),
    capabilityGuardAllowedRideIds: csv,
    sparkplugLiveSubscribeAdvanced: Joi.boolean().default(false),
    enforceCapabilities: Joi.boolean().default(false),
  }).required(),

  sparkplug: Joi.object({
    groupId: Joi.string().allow('').default(''),
    edgeNode: Joi.string().default('park_gateway'),
  }).required(),

  uns: Joi.object({
    spyEnabled: Joi.boolean().default(false),
    adapterDiscoverySpyEnabled: Joi.boolean().default(false),
  }).required(),

  ai: Joi.object({
    samplingEnabled: Joi.boolean().default(false),
    samplingIntervalSeconds: positiveInt.default(300),
  }).required(),

  mlForecast: Joi.object({
    traceEnabled: Joi.boolean().default(false),
    profileEnabled: Joi.boolean().default(false),
    featureWeightsEnabled: Joi.boolean().default(false),
  }).required(),

  weather: Joi.object({
    openMeteoEnabled: Joi.boolean().default(false),
    openMeteoIntervalSeconds: positiveInt.default(300),
    openMeteoFetchRetries: positiveInt.default(3),
    openMeteoRetryBaseDelayMs: positiveMs.default(500),
    openMeteoForecastUrl: Joi.string().uri().default('https://api.open-meteo.com/v1/forecast'),
    openMeteoRebuildSnapshots: Joi.boolean().default(true),
  }).required(),

  integrations: Joi.object({
    externalParkDataEnabled: Joi.boolean().default(false),
    externalParkDataPollIntervalSeconds: positiveInt.default(300),
    externalParkDataDefaultProvider: Joi.string().default('themeparks_wiki'),
    adapterSchedulerEnabled: Joi.boolean().default(false),
    outputProfiles: csv,
    adapterPipelineLogEnabled: Joi.boolean().default(true),
    adapterPipelineLogPath: Joi.string().default('data/adapter-pipeline.log'),
  }).required(),

  sim: Joi.object({
    oee: Joi.object({
      enabled: Joi.boolean().default(false),
      autoStart: Joi.boolean().default(false),
      parkSlug: Joi.string().default('europa_park'),
      edgeNode: Joi.string().allow('').default(''),
      publishMs: positiveMs.default(3000),
      attractions: csv.default('blue_fire,silver_star'),
      scenario: Joi.string().default('NORMAL_OPERATION'),
      randomSeed: Joi.number().integer().default(42),
    }).required(),
  }).required(),

  registry: Joi.object({
    publishEnabled: Joi.boolean().default(false),
    publishMode: Joi.string().valid('dry_run', 'parallel').default('dry_run'),
    sparkplugFormat: Joi.string().valid('json', 'protobuf_ready').default('json'),
    allowedRideIds: csv,
    signalPublishMaxAgeMs: positiveMs.default(86_400_000),
    signalStabilityDays: Joi.number().integer().min(0).default(0),
  }).required(),

  ingestion: Joi.object({
    maxAgeMs: positiveMs.default(20 * 60 * 1000),
  }).required(),
}).required();

module.exports = { flagsSchema };
