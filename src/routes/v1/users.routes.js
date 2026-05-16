const { Router } = require('express');
const { validate, validateMergedParamsBody } = require('../../middleware/validate.middleware');
const { requireRole } = require('../../middleware/rbac.middleware');
const { ROLE_CODES } = require('../../constants/role-codes');
const {
  patchMyUserSettingsSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
  deleteAdminUserParamsSchema,
} = require('../../validators/users.schemas');
const usersController = require('../../controllers/users.controller');

const router = Router();

router.get('/me/settings', usersController.getMySettings);
router.patch('/me/settings', validate(patchMyUserSettingsSchema), usersController.patchMySettings);

const adminRouter = Router();
adminRouter.use(requireRole(ROLE_CODES.SYSTEM_ADMIN));
adminRouter.get('/', usersController.listUsers);
adminRouter.post('/', validate(createAdminUserSchema), usersController.createUser);
adminRouter.put(
  '/:id',
  validateMergedParamsBody(updateAdminUserSchema),
  usersController.updateUser
);
adminRouter.delete(
  '/:id',
  validateMergedParamsBody(deleteAdminUserParamsSchema),
  usersController.deleteUser
);

router.use('/', adminRouter);

module.exports = { usersRouter: router };
