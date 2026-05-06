const { Router } = require('express');
const { requireRole } = require('../../middleware/rbac.middleware');
const { ROLE_CODES } = require('../../constants/role-codes');
const { validateMergedParamsBody } = require('../../middleware/validate.middleware');
const { patchPlatformSettingMergedSchema } = require('../../validators/platform-settings.schemas');
const platformSettingsController = require('../../controllers/platform-settings.controller');

const platformSettingsRouter = Router();

platformSettingsRouter.use(requireRole(ROLE_CODES.SYSTEM_ADMIN));

platformSettingsRouter.get('/', platformSettingsController.listPlatformSettings);

platformSettingsRouter.patch(
  '/:settingKey',
  validateMergedParamsBody(patchPlatformSettingMergedSchema),
  platformSettingsController.patchPlatformSetting
);

module.exports = { platformSettingsRouter };
