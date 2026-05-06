const { AppError } = require('../../utils/app-error');

/** Canonical kinds for Phase-1 hierarchy (null = legacy row, permissive). */
const ENTITY_KINDS = Object.freeze(['ORGANIZATION', 'PARK', 'ZONE', 'ASSET', 'METRIC']);

/** Allowed child `entityKind` values per effective parent kind (virtual root = `_ROOT`). */
const ALLOWED_CHILDREN = Object.freeze({
  _ROOT: ['ORGANIZATION', 'PARK', 'ZONE'],
  ORGANIZATION: ['PARK'],
  PARK: ['ZONE'],
  ZONE: ['ZONE', 'ASSET', 'METRIC'],
  ASSET: ['METRIC'],
  METRIC: [],
});

function resolveEffectiveKind(row) {
  if (!row) return '_ROOT';
  const ek = row.entityKind != null && row.entityKind !== '' ? String(row.entityKind) : null;
  if (ek && ENTITY_KINDS.includes(ek)) return ek;
  if (row.isLeaf || row.is_leaf) return 'METRIC';
  const nt = String(row.nodeType || row.node_type || '').toUpperCase();
  if (nt === 'METRIC') return 'METRIC';
  if (nt === 'DOMAIN' || nt === 'AREA') return 'ZONE';
  return 'ZONE';
}

function getAllowedChildKinds(parentRow) {
  const pk = parentRow ? resolveEffectiveKind(parentRow) : '_ROOT';
  return [...(ALLOWED_CHILDREN[pk] || [])];
}

function assertChildKindAllowed(parentRow, childKind) {
  if (!ENTITY_KINDS.includes(childKind)) {
    throw new AppError(`Invalid entityKind: ${childKind}`, 422, { code: 'VALIDATION_ERROR' });
  }
  const allowed = getAllowedChildKinds(parentRow);
  if (!allowed.includes(childKind)) {
    const pk = parentRow ? resolveEffectiveKind(parentRow) : 'root';
    throw new AppError(
      `entityKind "${childKind}" is not allowed under parent kind "${pk}". Allowed: ${allowed.join(', ')}`,
      422,
      { code: 'UNS_HIERARCHY_VIOLATION' }
    );
  }
}

/**
 * Default kind when client omits `entityKind` (backward compatible).
 */
function inferDefaultEntityKind(parentRow, payload) {
  const isLeaf = Boolean(payload.isLeaf);
  if (!parentRow) {
    if (isLeaf) {
      throw new AppError('Metric nodes cannot be created without a parent', 422, { code: 'VALIDATION_ERROR' });
    }
    return 'ZONE';
  }
  const pk = resolveEffectiveKind(parentRow);
  if (isLeaf) {
    if (pk === 'METRIC') {
      throw new AppError('Cannot attach children to a METRIC node', 422, { code: 'UNS_HIERARCHY_VIOLATION' });
    }
    return 'METRIC';
  }
  if (pk === 'ORGANIZATION') return 'PARK';
  if (pk === 'PARK') return 'ZONE';
  if (pk === 'ZONE') {
    if (payload.entityKind === 'ASSET') return 'ASSET';
    return 'ZONE';
  }
  if (pk === 'ASSET') {
    throw new AppError('Only METRIC (leaf) nodes may be created under ASSET', 422, { code: 'UNS_HIERARCHY_VIOLATION' });
  }
  return 'ZONE';
}

function normalizeSparkplugEnabled(entityKind, requested) {
  if (entityKind !== 'METRIC') return false;
  if (requested === false) return false;
  return true;
}

function assertStructureUnlocked(row, operation) {
  if (row.isStructureLocked || row.is_structure_locked) {
    throw new AppError(`UNS node is structure-locked (${operation})`, 423, { code: 'UNS_STRUCTURE_LOCKED' });
  }
}

const LOCKED_IMMUTABLE = new Set([
  'parentId',
  'parent_id',
  'slug',
  'nodeType',
  'node_type',
  'domain',
  'metric',
  'topicPath',
  'topic_path',
  'isLeaf',
  'is_leaf',
  'entityKind',
  'entity_kind',
  'sparkplugEnabled',
  'sparkplug_enabled',
  'parkId',
  'park_id',
  'sortOrder',
  'sort_order',
]);

function assertLockedPatchAllowed(row, patch) {
  if (!(row.isStructureLocked || row.is_structure_locked)) return;
  const keys = Object.keys(patch || {}).filter((k) => patch[k] !== undefined);
  const bad = keys.filter((k) => LOCKED_IMMUTABLE.has(k));
  if (bad.length) {
    throw new AppError(`Structure-locked node: cannot change ${bad.join(', ')}`, 423, { code: 'UNS_STRUCTURE_LOCKED' });
  }
}

module.exports = {
  ENTITY_KINDS,
  ALLOWED_CHILDREN,
  resolveEffectiveKind,
  getAllowedChildKinds,
  assertChildKindAllowed,
  inferDefaultEntityKind,
  normalizeSparkplugEnabled,
  assertStructureUnlocked,
  assertLockedPatchAllowed,
};
