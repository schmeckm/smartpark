const { Op } = require('sequelize');
const { UnsNode, sequelize } = require('../../models');
const { AppError } = require('../../utils/app-error');
const { generateTopicPath, slugifyName } = require('./uns-topic-generator.service');
const { buildSparkplugTopic, SPARKPLUG_DEVICE_MESSAGE_TYPES } = require('./sparkplug-topic-builder.service');
const env = require('../../config/env');
const { parseTopic } = require('./uns-validator.service');
const {
  assertChildKindAllowed,
  inferDefaultEntityKind,
  normalizeSparkplugEnabled,
  resolveEffectiveKind,
  assertStructureUnlocked,
  assertLockedPatchAllowed,
} = require('./uns-hierarchy-rules');

const UNS_DESC_AUTO_ENTITY = 'AUTO_ENTITY_SYNC';
const UNS_DESC_MANUAL_CONFIG = 'MANUAL_UNS_SYNC';

function nodeTypeForEntityKind(entityKind, isLeaf) {
  if (isLeaf) return 'METRIC';
  if (entityKind === 'ZONE') return 'DOMAIN';
  return 'AREA';
}

const HIERARCHY_KIND = 'smartpark.uns.hierarchy';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

/**
 * Leaf topicPath must match tpuns/{park}/v1/{domain}/{asset}/{metric} with the same slugify rules as generateTopicPath.
 * @param {string} topicPath
 * @param {string} parkId
 * @param {{ domain?: string | null; metric?: string | null; slug?: string; name: string; assetSlug?: string | null; isLeaf: boolean }} fields
 */
function assertTopicMatchesLeafFields(topicPath, parkId, fields) {
  if (!fields.isLeaf || !topicPath) return;
  const parsed = parseTopic(topicPath);
  if (slugifyName(parsed.parkSlug) !== slugifyName(parkId)) {
    throw new AppError('topicPath park segment must match park', 422, { code: 'VALIDATION_ERROR' });
  }
  if (!fields.domain || !fields.metric) {
    throw new AppError('domain and metric are required when topicPath is set on a leaf node', 422, {
      code: 'UNS_TOPIC_MISMATCH',
    });
  }
  if (slugifyName(fields.domain) !== parsed.domain) {
    throw new AppError(
      `topicPath domain segment "${parsed.domain}" does not match domain field (slugified "${slugifyName(fields.domain)}")`,
      422,
      { code: 'UNS_TOPIC_MISMATCH' }
    );
  }
  if (slugifyName(fields.metric) !== parsed.metric) {
    throw new AppError(
      `topicPath metric segment "${parsed.metric}" does not match metric field (slugified "${slugifyName(fields.metric)}")`,
      422,
      { code: 'UNS_TOPIC_MISMATCH' }
    );
  }
  const nodeSlug = fields.slug ? slugifyName(fields.slug) : slugifyName(fields.name);
  const assetSource =
    fields.assetSlug != null && String(fields.assetSlug).trim() !== ''
      ? slugifyName(String(fields.assetSlug).trim())
      : nodeSlug;
  if (assetSource !== parsed.assetSlug) {
    throw new AppError(
      `topicPath asset segment "${parsed.assetSlug}" does not match slug/name or assetSlug (expected "${assetSource}")`,
      422,
      { code: 'UNS_TOPIC_MISMATCH' }
    );
  }
}

function serializeHierarchyNode(n) {
  let assetSlug = null;
  if (n.isLeaf && n.topicPath) {
    try {
      assetSlug = parseTopic(n.topicPath).assetSlug;
    } catch {
      assetSlug = null;
    }
  }
  return {
    id: n.id,
    name: n.name,
    slug: n.slug,
    nodeType: n.nodeType,
    domain: n.domain,
    metric: n.metric,
    topicPath: n.topicPath,
    assetSlug,
    description: n.description,
    isLeaf: n.isLeaf,
    isActive: n.isActive,
    entityKind: n.entityKind,
    sparkplugEnabled: Boolean(n.sparkplugEnabled),
    isStructureLocked: Boolean(n.isStructureLocked),
    sortOrder: n.sortOrder ?? 0,
    children: (n.children || []).map(serializeHierarchyNode),
  };
}

function normalizeImportNode(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const children = Array.isArray(raw.children) ? raw.children : [];
  return {
    id: raw.id != null && String(raw.id).trim() !== '' ? String(raw.id).trim() : null,
    name: String(raw.name || '').trim(),
    slug: raw.slug != null ? String(raw.slug).trim() : '',
    nodeType: raw.nodeType != null ? String(raw.nodeType).trim() : '',
    domain: raw.domain != null && String(raw.domain).trim() !== '' ? String(raw.domain).trim() : null,
    metric: raw.metric != null && String(raw.metric).trim() !== '' ? String(raw.metric).trim() : null,
    topicPath: raw.topicPath != null && String(raw.topicPath).trim() !== '' ? String(raw.topicPath).trim() : null,
    assetSlug:
      raw.assetSlug != null && String(raw.assetSlug).trim() !== '' ? String(raw.assetSlug).trim() : null,
    description: raw.description != null ? String(raw.description) : null,
    isLeaf: Boolean(raw.isLeaf),
    isActive: raw.isActive !== false,
    entityKind: raw.entityKind != null && String(raw.entityKind).trim() !== '' ? String(raw.entityKind).trim() : null,
    sparkplugEnabled: raw.sparkplugEnabled === true,
    isStructureLocked: Boolean(raw.isStructureLocked),
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    children,
  };
}

function countHierarchyNodesRaw(nodes) {
  let c = 0;
  function walk(arr) {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      c += 1;
      if (raw && typeof raw === 'object' && Array.isArray(raw.children) && raw.children.length) walk(raw.children);
    }
  }
  walk(nodes);
  return c;
}

function validateImportNodeSemantics(n, path, parkId) {
  if (!n.name) throw new AppError(`Invalid hierarchy import: missing name at ${path}`, 422, { code: 'VALIDATION_ERROR' });
  const ek =
    n.entityKind && String(n.entityKind).trim() !== ''
      ? String(n.entityKind).trim()
      : n.isLeaf
        ? 'METRIC'
        : 'ZONE';
  if (ek === 'METRIC' && !n.isLeaf) {
    throw new AppError(`Invalid hierarchy import: METRIC must be leaf at ${path}`, 422, { code: 'VALIDATION_ERROR' });
  }
  if (n.isLeaf && ek !== 'METRIC') {
    throw new AppError(`Invalid hierarchy import: leaf nodes must be METRIC at ${path}`, 422, { code: 'VALIDATION_ERROR' });
  }
  if (!n.isLeaf && ek === 'METRIC') {
    throw new AppError(`Invalid hierarchy import: METRIC cannot be non-leaf at ${path}`, 422, { code: 'VALIDATION_ERROR' });
  }
  if (n.isLeaf && n.topicPath) {
    assertTopicMatchesLeafFields(n.topicPath, parkId, {
      isLeaf: true,
      domain: n.domain,
      metric: n.metric,
      slug: n.slug,
      name: n.name,
      assetSlug: n.assetSlug,
    });
  }
}

/** @param {import('sequelize').Transaction} [transaction] */
function buildUnlockedImportPatch(n, parentId, parkId) {
  const entityKind =
    n.entityKind && String(n.entityKind).trim() !== '' ? String(n.entityKind).trim() : n.isLeaf ? 'METRIC' : 'ZONE';
  const slug = n.slug ? slugifyName(n.slug) : slugifyName(n.name);
  const patch = {
    parentId,
    name: n.name,
    slug,
    nodeType: n.nodeType || nodeTypeForEntityKind(entityKind, n.isLeaf),
    domain: n.domain,
    metric: n.metric,
    description: n.description,
    isLeaf: n.isLeaf,
    isActive: n.isActive,
    entityKind,
    sparkplugEnabled: n.sparkplugEnabled,
    isStructureLocked: n.isStructureLocked,
    sortOrder: n.sortOrder,
  };
  if (n.isLeaf && n.topicPath) {
    assertTopicMatchesLeafFields(n.topicPath, parkId, {
      isLeaf: true,
      domain: n.domain,
      metric: n.metric,
      slug: n.slug,
      name: n.name,
      assetSlug: n.assetSlug,
    });
    patch.topicPath = n.topicPath;
  }
  return patch;
}

function buildLockedImportPatch(n) {
  return {
    name: n.name,
    description: n.description,
    isActive: n.isActive,
  };
}

/**
 * Same Sparkplug DDATA path rules as {@link UnsService#listTopicsByPark} so Explorer matches Integrations preview / UNS Topics.
 * @param {Array<Record<string, unknown>>} roots
 * @param {string} parkId
 */
function enrichTreeWithSparkplugTopics(roots, parkId) {
  const mt = 'DDATA';
  const groupId = env.sparkplugGroupId || slugifyName(parkId);
  const edgeNodeId = env.sparkplugEdgeNode || 'park_gateway';

  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (n.children && n.children.length) walk(n.children);
      if (n.isLeaf && n.topicPath) {
        let assetSlug = null;
        try {
          assetSlug = parseTopic(n.topicPath).assetSlug;
        } catch {
          assetSlug = slugifyName(n.name);
        }
        let sparkplugTopic = null;
        try {
          if (SPARKPLUG_DEVICE_MESSAGE_TYPES.has(mt)) {
            sparkplugTopic = buildSparkplugTopic({
              groupId,
              messageType: mt,
              edgeNodeId,
              deviceId: assetSlug,
            });
          }
        } catch {
          sparkplugTopic = null;
        }
        n.sparkplugTopic = sparkplugTopic;
        n.sparkplugMessageType = mt;
        n.sparkplug = { groupId, edgeNodeId };
      } else {
        n.sparkplugTopic = null;
      }
    }
  };
  walk(roots);
}

class UnsService {
  async getTreeByPark(parkId) {
    const rows = await UnsNode.findAll({
      where: { parkId },
      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    const plain = rows.map((r) => (r.toJSON ? r.toJSON() : r));
    const map = new Map(plain.map((n) => [n.id, { ...n, children: [] }]));
    const roots = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    enrichTreeWithSparkplugTopics(roots, parkId);
    return roots;
  }

  async createNode(parkId, payload, options = {}) {
    const { transaction } = options;
    const isLeaf = Boolean(payload.isLeaf);
    const parentId = payload.parentId || null;
    let parent = null;
    if (parentId) {
      parent = await UnsNode.findOne({ where: { id: parentId, parkId }, transaction });
      if (!parent) throw new AppError('Parent UNS node not found', 404, { code: 'NOT_FOUND' });
    }

    const slug = slugifyName(payload.slug || payload.name);
    const entityKind =
      payload.entityKind && String(payload.entityKind).trim() !== ''
        ? String(payload.entityKind).trim()
        : inferDefaultEntityKind(parent, { ...payload, isLeaf });

    assertChildKindAllowed(parent, entityKind);

    let topicPath = null;
    if (isLeaf) {
      const explicit =
        payload.topicPath != null && String(payload.topicPath).trim() !== ''
          ? String(payload.topicPath).trim()
          : '';
      if (explicit) {
        assertTopicMatchesLeafFields(explicit, parkId, {
          isLeaf: true,
          domain: payload.domain,
          metric: payload.metric,
          slug: payload.slug != null ? String(payload.slug) : '',
          name: payload.name,
          assetSlug: payload.assetSlug != null ? String(payload.assetSlug) : null,
        });
        topicPath = explicit;
      } else {
        topicPath = generateTopicPath({
          parkSlug: payload.parkSlug || payload.parkId || parkId,
          version: 'v1',
          domain: payload.domain,
          assetSlug: payload.assetSlug || slug,
          metric: payload.metric,
        });
      }
    }

    const sparkplugEnabled = normalizeSparkplugEnabled(
      entityKind,
      payload.sparkplugEnabled !== undefined ? payload.sparkplugEnabled : undefined
    );

    return UnsNode.create(
      {
        parkId,
        parentId,
        name: payload.name,
        slug,
        nodeType: payload.nodeType || nodeTypeForEntityKind(entityKind, isLeaf),
        domain: payload.domain || null,
        metric: payload.metric || null,
        topicPath,
        description: payload.description || null,
        isLeaf,
        isActive: payload.isActive !== false,
        entityKind,
        sparkplugEnabled,
        isStructureLocked: Boolean(payload.isStructureLocked),
        sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
      },
      { transaction }
    );
  }

  async updateNode(id, patch, options = {}) {
    const { transaction } = options;
    const row = await UnsNode.findByPk(id, { transaction });
    if (!row) throw new AppError('UNS node not found', 404, { code: 'NOT_FOUND' });

    assertLockedPatchAllowed(row, patch);

    const plain = row.get({ plain: true });
    const merged = { ...plain, ...patch };

    if (patch.parentId !== undefined || patch.entityKind !== undefined) {
      assertStructureUnlocked(row, 'reparent or change entityKind');
      const newParentId = patch.parentId !== undefined ? patch.parentId : plain.parentId;
      const parent = newParentId
        ? await UnsNode.findOne({ where: { id: newParentId, parkId: plain.parkId }, transaction })
        : null;
      if (newParentId && !parent) throw new AppError('Parent UNS node not found', 404, { code: 'NOT_FOUND' });
      const childKind =
        patch.entityKind !== undefined && patch.entityKind !== null && String(patch.entityKind).trim() !== ''
          ? String(patch.entityKind).trim()
          : resolveEffectiveKind(merged);
      assertChildKindAllowed(parent, childKind);
    }

    if (patch.topicPath !== undefined) {
      const tp =
        patch.topicPath != null && String(patch.topicPath).trim() !== '' ? String(patch.topicPath).trim() : null;
      if (tp && (merged.isLeaf || resolveEffectiveKind(merged) === 'METRIC')) {
        assertTopicMatchesLeafFields(tp, plain.parkId, {
          isLeaf: true,
          domain: merged.domain,
          metric: merged.metric,
          slug: merged.slug,
          name: merged.name,
          assetSlug: null,
        });
      }
    }

    const effectiveKind = resolveEffectiveKind(merged);
    const nextSparkplug = normalizeSparkplugEnabled(
      effectiveKind,
      patch.sparkplugEnabled !== undefined ? patch.sparkplugEnabled : plain.sparkplugEnabled
    );

    const updates = { ...patch, sparkplugEnabled: nextSparkplug };
    for (const k of Object.keys(updates)) {
      if (updates[k] === undefined) delete updates[k];
    }
    await row.update(updates, { transaction });
    return row.reload({ transaction });
  }

  async deleteNode(id) {
    const row = await UnsNode.findByPk(id);
    if (!row) throw new AppError('UNS node not found', 404, { code: 'NOT_FOUND' });
    if (row.isStructureLocked) {
      throw new AppError('Cannot delete structure-locked UNS node', 423, { code: 'UNS_STRUCTURE_LOCKED' });
    }
    await row.destroy();
  }

  async listTopicsByPark(parkId, options = {}) {
    const mt = String(options.sparkplugMessageType || 'DDATA').toUpperCase();
    const groupId = env.sparkplugGroupId || slugifyName(parkId);
    const edgeNodeId = env.sparkplugEdgeNode || 'park_gateway';

    const rows = await UnsNode.findAll({
      where: { parkId, isLeaf: true, isActive: true },
      order: [
        ['sortOrder', 'ASC'],
        ['topicPath', 'ASC'],
      ],
    });
    return rows.map((r) => {
      let assetSlug = null;
      if (r.topicPath) {
        try {
          assetSlug = parseTopic(r.topicPath).assetSlug;
        } catch {
          assetSlug = slugifyName(r.name);
        }
      } else {
        assetSlug = slugifyName(r.name);
      }

      let sparkplugTopic = null;
      try {
        if (SPARKPLUG_DEVICE_MESSAGE_TYPES.has(mt)) {
          sparkplugTopic = buildSparkplugTopic({
            groupId,
            messageType: mt,
            edgeNodeId,
            deviceId: assetSlug,
          });
        } else {
          sparkplugTopic = buildSparkplugTopic({ groupId, messageType: mt, edgeNodeId });
        }
      } catch {
        sparkplugTopic = null;
      }

      return {
        id: r.id,
        name: r.name,
        topicPath: r.topicPath,
        canonicalUnsTopic: r.topicPath,
        domain: r.domain,
        metric: r.metric,
        nodeType: r.nodeType,
        entityKind: r.entityKind,
        sparkplugEnabled: r.sparkplugEnabled,
        sparkplugTopic,
        sparkplugMessageType: mt,
      };
    });
  }

  async exportHierarchySchema(parkId) {
    const roots = await this.getTreeByPark(parkId);
    return {
      schemaVersion: 1,
      kind: HIERARCHY_KIND,
      parkId,
      exportedAt: new Date().toISOString(),
      roots: roots.map(serializeHierarchyNode),
    };
  }

  /**
   * @param {'merge'|'replace'} mode merge updates by id and creates missing nodes; replace deletes all park nodes first (destructive).
   * @param {{ dryRun?: boolean }} [options] dryRun: simulate import and return `preview` without writing (except empty merge still throws before here).
   */
  async importHierarchySchema(parkId, doc, mode = 'merge', options = {}) {
    const { dryRun = false } = options;
    if (!doc || typeof doc !== 'object') {
      throw new AppError('Invalid hierarchy document', 422, { code: 'VALIDATION_ERROR' });
    }
    if (doc.kind !== HIERARCHY_KIND || doc.schemaVersion !== 1) {
      throw new AppError('Unsupported hierarchy schema (expected schemaVersion 1)', 422, { code: 'VALIDATION_ERROR' });
    }
    if (doc.parkId && String(doc.parkId) !== String(parkId)) {
      throw new AppError('Document parkId does not match URL park', 422, { code: 'VALIDATION_ERROR' });
    }
    const roots = Array.isArray(doc.roots) ? doc.roots : [];
    if (!roots.length && mode !== 'replace') {
      throw new AppError('roots array is required for merge import', 422, { code: 'VALIDATION_ERROR' });
    }
    if (!roots.length && mode === 'replace') {
      if (dryRun) {
        const nodeCount = await UnsNode.count({ where: { parkId } });
        return {
          dryRun: true,
          mode,
          created: 0,
          updated: 0,
          skippedLocked: 0,
          preview: [{ action: 'replace_would_delete_all', nodeCount }],
        };
      }
      const t = await sequelize.transaction();
      try {
        await UnsNode.destroy({ where: { parkId }, transaction: t });
        await t.commit();
        return { mode, created: 0, updated: 0, skippedLocked: 0 };
      } catch (e) {
        await t.rollback();
        throw e;
      }
    }
    const total = countHierarchyNodesRaw(roots);
    if (total > 5000) {
      throw new AppError('Hierarchy import exceeds 5000 nodes', 422, { code: 'VALIDATION_ERROR' });
    }

    const validateTree = (nodes, pathBase) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const n = normalizeImportNode(nodes[i]);
        if (!n) {
          throw new AppError(`Invalid node at ${pathBase}[${i}]`, 422, { code: 'VALIDATION_ERROR' });
        }
        validateImportNodeSemantics(n, `${pathBase}[${i}]`, parkId);
        if (n.children.length) validateTree(n.children, `${pathBase}[${i}].children`);
      }
    };
    validateTree(roots, 'roots');

    const summary = { mode, created: 0, updated: 0, skippedLocked: 0 };
    const preview = [];
    if (dryRun && mode === 'replace') {
      preview.push({ action: 'replace_would_delete_all', nodeCount: await UnsNode.count({ where: { parkId } }) });
    }

    let tempSeq = 0;
    const nextTempId = () => {
      tempSeq += 1;
      return `__dry_${tempSeq}`;
    };

    const seenIds = new Set();

    const walk = async (parentId, arr, pathBase, transaction) => {
      for (let i = 0; i < arr.length; i += 1) {
        const n = normalizeImportNode(arr[i]);
        const path = `${pathBase}[${i}]`;
        let rowId;

        const createPayload = {
          name: n.name,
          slug: n.slug || undefined,
          nodeType: n.nodeType || undefined,
          parentId,
          domain: n.domain,
          metric: n.metric,
          assetSlug: n.assetSlug || undefined,
          topicPath: n.topicPath || undefined,
          description: n.description,
          isLeaf: n.isLeaf,
          isActive: n.isActive,
          entityKind: n.entityKind || undefined,
          sparkplugEnabled: n.sparkplugEnabled,
          isStructureLocked: n.isStructureLocked,
          sortOrder: n.sortOrder,
          parkSlug: parkId,
        };

        const entityKindForPreview =
          n.entityKind && String(n.entityKind).trim() !== ''
            ? String(n.entityKind).trim()
            : n.isLeaf
              ? 'METRIC'
              : 'ZONE';

        if (dryRun) {
          if (mode === 'replace' || !n.id || !isUuid(n.id)) {
            summary.created += 1;
            preview.push({
              path,
              action: 'create',
              parentId: parentId || null,
              name: n.name,
              isLeaf: n.isLeaf,
              entityKind: entityKindForPreview,
              topicPath: n.topicPath || null,
            });
            rowId = nextTempId();
          } else {
            if (seenIds.has(n.id)) {
              throw new AppError(`Duplicate id in import document: ${n.id}`, 422, { code: 'VALIDATION_ERROR' });
            }
            seenIds.add(n.id);
            const existing = await UnsNode.findOne({ where: { id: n.id, parkId }, transaction: null });
            if (!existing) {
              summary.created += 1;
              preview.push({
                path,
                action: 'create',
                parentId: parentId || null,
                name: n.name,
                isLeaf: n.isLeaf,
                entityKind: entityKindForPreview,
                topicPath: n.topicPath || null,
                note: 'id not in database; would create new row',
              });
              rowId = nextTempId();
            } else if (existing.isStructureLocked) {
              summary.skippedLocked += 1;
              preview.push({
                path,
                action: 'skip_locked',
                id: n.id,
                name: n.name,
              });
              rowId = existing.id;
            } else {
              summary.updated += 1;
              preview.push({
                path,
                action: 'update',
                id: n.id,
                name: n.name,
                parentId: parentId || null,
                entityKind: entityKindForPreview,
                topicPath: n.topicPath || null,
              });
              rowId = existing.id;
            }
          }
        } else if (mode === 'replace' || !n.id || !isUuid(n.id)) {
          const created = await this.createNode(parkId, createPayload, { transaction });
          summary.created += 1;
          rowId = created.id;
        } else {
          if (seenIds.has(n.id)) {
            throw new AppError(`Duplicate id in import document: ${n.id}`, 422, { code: 'VALIDATION_ERROR' });
          }
          seenIds.add(n.id);
          const existing = await UnsNode.findOne({ where: { id: n.id, parkId }, transaction });
          if (!existing) {
            const created = await this.createNode(parkId, createPayload, { transaction });
            summary.created += 1;
            rowId = created.id;
          } else {
            const patch = existing.isStructureLocked
              ? buildLockedImportPatch(n)
              : buildUnlockedImportPatch(n, parentId, parkId);
            try {
              await this.updateNode(existing.id, patch, { transaction });
              summary.updated += 1;
            } catch (e) {
              if (e instanceof AppError && e.statusCode === 423) {
                summary.skippedLocked += 1;
              } else {
                const msg = e instanceof Error ? e.message : String(e);
                const sc = e instanceof AppError ? e.statusCode : 500;
                const cod = e instanceof AppError ? e.code : 'IMPORT_ERROR';
                throw new AppError(`${path}: ${msg}`, sc, { code: cod });
              }
            }
            rowId = existing.id;
          }
        }

        if (n.children.length) await walk(rowId, n.children, `${path}.children`, transaction);
      }
    };

    if (dryRun) {
      await walk(null, roots, 'roots', null);
      return { dryRun: true, ...summary, preview };
    }

    const t = await sequelize.transaction();
    try {
      if (mode === 'replace') {
        await UnsNode.destroy({ where: { parkId }, transaction: t });
      }
      seenIds.clear();
      await walk(null, roots, 'roots', t);
      await t.commit();
      return summary;
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  _domainRootLabel(domain) {
    const d = String(domain || 'general');
    if (d === 'rides') return 'Rides';
    if (d === 'operations') return 'Operations';
    if (d === 'destinations') return 'Destinations';
    if (d === 'parks') return 'Parks';
    if (d === 'restaurants') return 'Restaurants';
    if (d === 'shows') return 'Shows';
    if (d === 'shops') return 'Shops';
    if (d === 'hotels') return 'Hotels';
    if (d === 'entities') return 'Entities';
    if (d === 'transport') return 'Transport';
    if (d === 'services') return 'Services';
    if (d === 'playgrounds') return 'Playgrounds';
    return d.charAt(0).toUpperCase() + d.slice(1);
  }

  /**
   * Upserts leaf UNS nodes from integration suggestion rows and prunes previous auto-synced leaves.
   * Leaves user-created nodes (no managed description) untouched.
   *
   * @param {string} parkId UNS park key (slug), same as tpuns segment
   * @param {Array<{ topicPath: string, domain: string, assetSlug: string, metric: string, entityName: string, entityType?: string, source?: string }>} leaves
   */
  async materializeLeavesFromIntegration(parkId, leaves) {
    const list = Array.isArray(leaves) ? leaves.filter((x) => x && x.topicPath && x.domain) : [];
    const pathSet = new Set(list.map((l) => String(l.topicPath)));
    const domains = [...new Set(list.map((l) => slugifyName(l.domain)))];

    const t = await sequelize.transaction();
    if (!list.length) {
      const del = await UnsNode.destroy({
        where: {
          parkId,
          isLeaf: true,
          description: { [Op.in]: [UNS_DESC_AUTO_ENTITY, UNS_DESC_MANUAL_CONFIG] },
        },
        transaction: t,
      });
      await t.commit();
      return { domainsCreated: 0, leavesCreated: 0, leavesUpdated: 0, pruned: del || 0, totalLeaves: 0 };
    }

    let domainsCreated = 0;
    let leavesCreated = 0;
    let leavesUpdated = 0;
    let pruned = 0;
    try {
      const domainIdByKey = new Map();
      for (const domain of domains) {
        let dom = await UnsNode.findOne({
          where: { parkId, parentId: null, domain, isLeaf: false },
          transaction: t,
        });
        if (!dom) {
          dom = await UnsNode.create(
            {
              parkId,
              parentId: null,
              name: this._domainRootLabel(domain),
              slug: domain,
              nodeType: 'DOMAIN',
              domain,
              metric: null,
              topicPath: null,
              description: 'AUTO_DOMAIN_ROOT',
              isLeaf: false,
              isActive: true,
              entityKind: 'ZONE',
              sparkplugEnabled: false,
              isStructureLocked: false,
              sortOrder: 0,
            },
            { transaction: t }
          );
          domainsCreated += 1;
        }
        domainIdByKey.set(domain, dom.id);
      }

      for (const leaf of list) {
        const domain = slugifyName(leaf.domain);
        const parentId = domainIdByKey.get(domain);
        if (!parentId) continue;
        const slug = slugifyName(`${leaf.assetSlug}_${leaf.metric}`).slice(0, 200);
        const baseName = String(leaf.entityName || leaf.assetSlug || 'Metric').slice(0, 160);
        const name = `${baseName} · ${leaf.metric}`.slice(0, 200);
        const desc = leaf.source === 'MANUAL' ? UNS_DESC_MANUAL_CONFIG : UNS_DESC_AUTO_ENTITY;
        const existing = await UnsNode.findOne({ where: { parkId, topicPath: leaf.topicPath }, transaction: t });
        if (existing) {
          await existing.update(
            {
              parentId,
              name,
              slug,
              domain,
              metric: leaf.metric,
              nodeType: 'METRIC',
              isLeaf: true,
              isActive: true,
              description: desc,
              entityKind: 'METRIC',
              sparkplugEnabled: true,
            },
            { transaction: t }
          );
          leavesUpdated += 1;
        } else {
          await UnsNode.create(
            {
              parkId,
              parentId,
              name,
              slug,
              nodeType: 'METRIC',
              domain,
              metric: leaf.metric,
              topicPath: leaf.topicPath,
              description: desc,
              isLeaf: true,
              isActive: true,
              entityKind: 'METRIC',
              sparkplugEnabled: true,
              isStructureLocked: false,
              sortOrder: 0,
            },
            { transaction: t }
          );
          leavesCreated += 1;
        }
      }

      if (pathSet.size) {
        const del = await UnsNode.destroy({
          where: {
            parkId,
            isLeaf: true,
            description: { [Op.in]: [UNS_DESC_AUTO_ENTITY, UNS_DESC_MANUAL_CONFIG] },
            topicPath: { [Op.notIn]: [...pathSet] },
          },
          transaction: t,
        });
        pruned = del || 0;
      }

      await t.commit();
      return {
        domainsCreated,
        leavesCreated,
        leavesUpdated,
        pruned,
        totalLeaves: list.length,
      };
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }
}

module.exports = { UnsService };
