'use strict';

const { DashboardDataSourceRegistry } = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const { DEFAULT_DATA_SOURCES } = require('../registry/default-data-sources');

let syncPromise = null;

async function syncRegistryRows() {
  for (const seed of DEFAULT_DATA_SOURCES) {
    const existing = await DashboardDataSourceRegistry.findOne({
      where: { dataSourceKey: seed.dataSourceKey },
    });
    const base = {
      dataSourceKey: seed.dataSourceKey,
      displayName: seed.displayName,
      category: seed.category ?? null,
      description: seed.description ?? null,
      sourceType: seed.sourceType,
      endpoint: seed.endpoint ?? null,
      refreshSeconds: seed.refreshSeconds ?? 60,
    };
    if (existing) {
      await existing.update(base);
    } else {
      await DashboardDataSourceRegistry.create({ ...base, enabled: true });
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
  const rows = await DashboardDataSourceRegistry.findAll({
    where: { enabled: true },
    order: [
      ['category', 'ASC'],
      ['displayName', 'ASC'],
    ],
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function getByKey(dataSourceKey) {
  await ensureSynced();
  const row = await DashboardDataSourceRegistry.findOne({
    where: { dataSourceKey: String(dataSourceKey || '').trim() },
  });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

async function assertDataSourceEnabled(dataSourceKey) {
  if (dataSourceKey == null || dataSourceKey === '') return null;
  const row = await getByKey(dataSourceKey);
  if (!row) {
    throw new AppError('Unknown data_source_key', 422, { code: 'UNKNOWN_DATA_SOURCE' });
  }
  if (!row.enabled) {
    throw new AppError('Data source is disabled', 422, { code: 'DATA_SOURCE_DISABLED' });
  }
  if (row.sourceType !== 'internal_api') {
    throw new AppError('Unsupported data source type', 422, { code: 'INVALID_DATA_SOURCE' });
  }
  return row;
}

module.exports = {
  DEFAULT_DATA_SOURCES,
  ensureSynced,
  listEnabled,
  getByKey,
  assertDataSourceEnabled,
};
