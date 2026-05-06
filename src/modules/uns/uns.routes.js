const { Router } = require('express');
const Joi = require('joi');
const { validate } = require('../../middleware/validate.middleware');
const { requirePermission } = require('../../middleware/rbac.middleware');
const controller = require('./uns.controller');

const router = Router();

const parkParams = Joi.object({ parkId: Joi.string().required() });
const nodeParams = Joi.object({ id: Joi.string().uuid().required() });

const entityKindSchema = Joi.string()
  .valid('ORGANIZATION', 'PARK', 'ZONE', 'ASSET', 'METRIC')
  .allow(null, '');

const unsNodeCreateBody = Joi.object({
  parentId: Joi.string().uuid().allow(null, ''),
  name: Joi.string().required(),
  slug: Joi.string().allow('', null),
  nodeType: Joi.string().allow('', null),
  domain: Joi.string().allow('', null),
  metric: Joi.string().allow('', null),
  topicPath: Joi.string().max(500).allow('', null),
  description: Joi.string().allow('', null),
  isLeaf: Joi.boolean().default(false),
  isActive: Joi.boolean().default(true),
  parkSlug: Joi.string().allow('', null),
  assetSlug: Joi.string().allow('', null),
  entityKind: entityKindSchema,
  sparkplugEnabled: Joi.boolean().allow(null),
  isStructureLocked: Joi.boolean().allow(null),
  sortOrder: Joi.number().integer().min(0).max(999999).allow(null),
}).unknown(false);

const unsNodePatchBody = Joi.object({
  parentId: Joi.string().uuid().allow(null, ''),
  name: Joi.string().allow('', null),
  slug: Joi.string().allow('', null),
  nodeType: Joi.string().allow('', null),
  domain: Joi.string().allow('', null),
  metric: Joi.string().allow('', null),
  topicPath: Joi.string().max(500).allow('', null),
  description: Joi.string().allow('', null),
  isLeaf: Joi.boolean(),
  isActive: Joi.boolean(),
  parkSlug: Joi.string().allow('', null),
  assetSlug: Joi.string().allow('', null),
  entityKind: entityKindSchema,
  sparkplugEnabled: Joi.boolean().allow(null),
  isStructureLocked: Joi.boolean().allow(null),
  sortOrder: Joi.number().integer().min(0).max(999999).allow(null),
})
  .unknown(false)
  .min(1);
const publishBody = Joi.object({
  topic: Joi.string().required(),
  payload: Joi.object().required(),
});

const unsHierarchyImportBody = Joi.object({
  schemaVersion: Joi.number().valid(1).required(),
  kind: Joi.string().valid('smartpark.uns.hierarchy').required(),
  parkId: Joi.string().allow('', null),
  exportedAt: Joi.string().allow('', null),
  roots: Joi.array().default([]).items(Joi.object().unknown(true)),
}).unknown(true);

router.get('/parks/:parkId/tree', requirePermission('integrations', 'read'), validate(parkParams, 'params'), controller.getTree);
router.post(
  '/parks/:parkId/nodes',
  requirePermission('integrations', 'manage'),
  validate(parkParams, 'params'),
  validate(unsNodeCreateBody),
  controller.createNode
);
router.put(
  '/nodes/:id',
  requirePermission('integrations', 'manage'),
  validate(nodeParams, 'params'),
  validate(unsNodePatchBody),
  controller.updateNode
);
router.delete('/nodes/:id', requirePermission('integrations', 'manage'), validate(nodeParams, 'params'), controller.deleteNode);
router.get(
  '/parks/:parkId/latest-state',
  requirePermission('integrations', 'read'),
  validate(parkParams, 'params'),
  controller.getLatestState
);
router.get('/parks/:parkId/topics', requirePermission('integrations', 'read'), validate(parkParams, 'params'), controller.getTopics);
router.get(
  '/parks/:parkId/hierarchy-schema',
  requirePermission('integrations', 'read'),
  validate(parkParams, 'params'),
  controller.getHierarchySchema
);
router.post(
  '/parks/:parkId/hierarchy-schema/preview',
  requirePermission('integrations', 'read'),
  validate(parkParams, 'params'),
  validate(unsHierarchyImportBody),
  controller.postHierarchySchemaPreview
);
router.put(
  '/parks/:parkId/hierarchy-schema',
  requirePermission('integrations', 'manage'),
  validate(parkParams, 'params'),
  validate(unsHierarchyImportBody),
  controller.putHierarchySchema
);
router.post('/test/publish', requirePermission('integrations', 'manage'), validate(publishBody), controller.testPublish);

router.get(
  '/parks/:parkId/mqtt-live/events',
  requirePermission('integrations', 'read'),
  validate(parkParams, 'params'),
  controller.getMqttLiveEvents
);
router.get(
  '/parks/:parkId/mqtt-live/status',
  requirePermission('integrations', 'read'),
  validate(parkParams, 'params'),
  controller.getMqttLiveStatus
);
router.post(
  '/parks/:parkId/mqtt-live/test-event',
  requirePermission('integrations', 'manage'),
  validate(parkParams, 'params'),
  controller.postMqttLiveTestEvent
);

module.exports = { unsRouter: router };
