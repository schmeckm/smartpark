const { Router } = require('express');
const { validate } = require('../../middleware/validate.middleware');
const { patchMyUserSettingsSchema } = require('../../validators/users.schemas');
const usersController = require('../../controllers/users.controller');

const router = Router();

router.get('/me/settings', usersController.getMySettings);
router.patch('/me/settings', validate(patchMyUserSettingsSchema), usersController.patchMySettings);

module.exports = { usersRouter: router };
