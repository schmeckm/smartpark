const { Router } = require('express');
const { requirePermission } = require('../../../middleware/rbac.middleware');
const { validate } = require('../../../middleware/validate.middleware');
const { parkIdParam } = require('../../platform/platform.validators');
const {
  postSyncThemeParksPark,
  postSyncThemeParksFromSettings,
  postScanThemeparksDiscoveryFromSettings,
} = require('./themeparks-sync.controller');

const router = Router();

router.post(
  '/themeparks/from-settings',
  requirePermission('integrations', 'manage'),
  postSyncThemeParksFromSettings
);
router.post(
  '/themeparks/discovery/from-settings',
  requirePermission('integrations', 'manage'),
  postScanThemeparksDiscoveryFromSettings
);
router.post(
  '/themeparks/:parkId',
  requirePermission('integrations', 'manage'),
  validate(parkIdParam, 'params'),
  postSyncThemeParksPark
);

module.exports = { themeparksSyncRouter: router };
