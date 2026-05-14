'use strict';

const { Op } = require('sequelize');
const { AppError } = require('../utils/app-error');
const {
  sequelize,
  SignalCatalog,
  RideSignalCapability,
  RegistrySignalDeprecation,
  REGISTRY_SOURCE_MIRRORED,
} = require('../models');

/** Operator-maintained rows — never deleted by UNS registry mirror (`MIRRORED_FROM_LEGACY` only). */
const REGISTRY_SOURCE_OPERATOR_CATALOG = 'OPERATOR_CONFIGURED';

const SIGNAL_CODE_RE = /^[a-z][a-z0-9_]{0,127}$/;

function normalizeSignalCode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) throw new AppError('signalCode is required', 422, { code: 'VALIDATION_ERROR' });
  if (!SIGNAL_CODE_RE.test(s)) {
    throw new AppError(
      'signalCode must be lowercase snake_case: start with a letter, then letters, digits, underscores (max 128 chars)',
      422,
      { code: 'INVALID_SIGNAL_CODE' }
    );
  }
  return s;
}

function toRowDto(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  const src = String(p.registrySource || '');
  return {
    id: p.id,
    signalCode: p.signalCode,
    label: p.label,
    description: p.description,
    unit: p.unit,
    category: p.category,
    registrySource: src,
    readOnly: src === REGISTRY_SOURCE_MIRRORED,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function listSignalCatalog() {
  const rows = await SignalCatalog.findAll({
    order: [
      ['registrySource', 'ASC'],
      ['signalCode', 'ASC'],
    ],
    limit: 600,
  });
  return { signals: rows.map(toRowDto) };
}

async function assertNoDuplicateCode(normalizedCode, excludeId) {
  const where = {
    [Op.and]: [
      sequelize.where(sequelize.fn('LOWER', sequelize.col('signal_code')), normalizedCode),
    ],
  };
  if (excludeId) {
    where[Op.and].push({ id: { [Op.ne]: excludeId } });
  }
  const existing = await SignalCatalog.findOne({ where });
  if (existing) {
    throw new AppError(
      `A signal with code "${normalizedCode}" already exists (catalog id ${existing.id})`,
      409,
      { code: 'SIGNAL_CODE_DUPLICATE' }
    );
  }
}

async function createOperatorSignal(body) {
  const signalCode = normalizeSignalCode(body.signalCode);
  await assertNoDuplicateCode(signalCode, null);

  const label = body.label != null && String(body.label).trim() !== '' ? String(body.label).trim() : null;
  const description =
    body.description != null && String(body.description).trim() !== '' ? String(body.description).trim() : null;
  const unit = body.unit != null && String(body.unit).trim() !== '' ? String(body.unit).trim().slice(0, 64) : null;
  const category =
    body.category != null && String(body.category).trim() !== '' ? String(body.category).trim().slice(0, 64) : null;

  const row = await SignalCatalog.create({
    registrySource: REGISTRY_SOURCE_OPERATOR_CATALOG,
    signalCode,
    label: label || signalCode,
    description: description || `Operator-defined signal (${signalCode})`,
    unit,
    category: category || 'operator_defined',
    payloadJson: { createdBy: 'signal-catalog-admin.service' },
  });
  return toRowDto(row);
}

async function updateOperatorSignal(catalogId, body) {
  const id = String(catalogId || '').trim();
  const row = await SignalCatalog.findByPk(id);
  if (!row) {
    throw new AppError('Signal catalog entry not found', 404, { code: 'NOT_FOUND' });
  }
  if (String(row.get('registrySource')) === REGISTRY_SOURCE_MIRRORED) {
    throw new AppError('Mirrored catalog signals cannot be edited here (managed by UNS registry sync)', 422, {
      code: 'CATALOG_READ_ONLY',
    });
  }
  if (String(row.get('registrySource')) !== REGISTRY_SOURCE_OPERATOR_CATALOG) {
    throw new AppError('Only operator-configured catalog entries can be edited with this API', 422, {
      code: 'CATALOG_NOT_OPERATOR',
    });
  }

  const patch = {};
  if (body.signalCode !== undefined) {
    patch.signalCode = normalizeSignalCode(body.signalCode);
    await assertNoDuplicateCode(patch.signalCode, id);
  }
  if (body.label !== undefined) {
    const v = String(body.label || '').trim();
    patch.label = v || row.get('signalCode');
  }
  if (body.description !== undefined) {
    const v = String(body.description || '').trim();
    patch.description = v || row.get('description');
  }
  if (body.unit !== undefined) {
    const v = String(body.unit || '').trim();
    patch.unit = v === '' ? null : v.slice(0, 64);
  }
  if (body.category !== undefined) {
    const v = String(body.category || '').trim();
    patch.category = v === '' ? null : v.slice(0, 64);
  }

  if (!Object.keys(patch).length) {
    throw new AppError('No valid fields to update', 422, { code: 'EMPTY_PATCH' });
  }

  await row.update(patch);
  await row.reload();
  return toRowDto(row);
}

async function deleteOperatorSignal(catalogId) {
  const id = String(catalogId || '').trim();
  const row = await SignalCatalog.findByPk(id);
  if (!row) {
    throw new AppError('Signal catalog entry not found', 404, { code: 'NOT_FOUND' });
  }
  if (String(row.get('registrySource')) === REGISTRY_SOURCE_MIRRORED) {
    throw new AppError('Mirrored catalog signals cannot be deleted', 422, { code: 'CATALOG_READ_ONLY' });
  }
  if (String(row.get('registrySource')) !== REGISTRY_SOURCE_OPERATOR_CATALOG) {
    throw new AppError('Only operator-configured catalog entries can be deleted with this API', 422, {
      code: 'CATALOG_NOT_OPERATOR',
    });
  }

  const capCount = await RideSignalCapability.count({ where: { signalCatalogId: id } });
  if (capCount > 0) {
    throw new AppError(
      `Cannot delete: ${capCount} ride capability row(s) still reference this signal. Remove or reassign them first.`,
      422,
      { code: 'CATALOG_IN_USE' }
    );
  }

  const depCount = await RegistrySignalDeprecation.count({
    where: { signalCatalogId: id },
  });
  if (depCount > 0) {
    throw new AppError(
      `Cannot delete: ${depCount} registry deprecation row(s) reference this signal.`,
      422,
      { code: 'CATALOG_REFERENCED' }
    );
  }

  await row.destroy();
  return { ok: true, id };
}

module.exports = {
  REGISTRY_SOURCE_OPERATOR_CATALOG,
  listSignalCatalog,
  createOperatorSignal,
  updateOperatorSignal,
  deleteOperatorSignal,
};
