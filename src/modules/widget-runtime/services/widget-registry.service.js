'use strict';

const { DashboardWidgetRegistry } = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const { DEFAULT_WIDGETS, ALLOWED_COMPONENT_NAMES } = require('../registry/default-widgets');

let syncPromise = null;

async function syncRegistryRows() {
  for (const seed of DEFAULT_WIDGETS) {
    const existing = await DashboardWidgetRegistry.findOne({ where: { widgetKey: seed.widgetKey } });
    const base = {
      widgetKey: seed.widgetKey,
      displayName: seed.displayName,
      category: seed.category ?? null,
      description: seed.description ?? null,
      componentName: seed.componentName,
      configSchema: seed.configSchema ?? null,
    };
    if (existing) {
      await existing.update(base);
    } else {
      await DashboardWidgetRegistry.create({ ...base, enabled: true });
    }
  }
}

async function ensureSynced() {
  if (!syncPromise) {
    syncPromise = syncRegistryRows().catch((e) => {
      syncPromise = null;
      throw e;
    });
  }
  return syncPromise;
}

async function listEnabled() {
  await ensureSynced();
  const rows = await DashboardWidgetRegistry.findAll({
    where: { enabled: true },
    order: [
      ['category', 'ASC'],
      ['displayName', 'ASC'],
    ],
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function listAll() {
  await ensureSynced();
  const rows = await DashboardWidgetRegistry.findAll({
    order: [
      ['category', 'ASC'],
      ['displayName', 'ASC'],
    ],
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function getByKey(widgetKey) {
  await ensureSynced();
  const row = await DashboardWidgetRegistry.findOne({ where: { widgetKey: String(widgetKey || '').trim() } });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

async function assertWidgetEnabled(widgetKey) {
  const row = await getByKey(widgetKey);
  if (!row) {
    throw new AppError('Unknown widget_key', 422, { code: 'UNKNOWN_WIDGET' });
  }
  if (!row.enabled) {
    throw new AppError('Widget type is disabled', 422, { code: 'WIDGET_DISABLED' });
  }
  if (!ALLOWED_COMPONENT_NAMES.has(row.componentName)) {
    throw new AppError('Widget component is not approved', 422, { code: 'INVALID_WIDGET_COMPONENT' });
  }
  return row;
}

/**
 * @param {unknown} configSchema
 * @param {unknown} widgetConfig
 */
function validateConfigAgainstSchema(configSchema, widgetConfig) {
  if (widgetConfig == null || typeof widgetConfig !== 'object' || Array.isArray(widgetConfig)) {
    throw new AppError('widget_config must be an object', 422, { code: 'INVALID_WIDGET_CONFIG' });
  }
  if (!configSchema || typeof configSchema !== 'object') return;
  const schema = configSchema;
  if (schema.type === 'object' && schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(widgetConfig)) {
      if (!allowed.has(key)) {
        throw new AppError(`widget_config property not allowed: ${key}`, 422, { code: 'INVALID_WIDGET_CONFIG' });
      }
    }
  }
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (widgetConfig[key] === undefined || widgetConfig[key] === null || widgetConfig[key] === '') {
        throw new AppError(`widget_config missing required: ${key}`, 422, { code: 'INVALID_WIDGET_CONFIG' });
      }
    }
  }
}

module.exports = {
  DEFAULT_WIDGETS,
  ALLOWED_COMPONENT_NAMES,
  ensureSynced,
  listEnabled,
  listAll,
  getByKey,
  assertWidgetEnabled,
  validateConfigAgainstSchema,
};
