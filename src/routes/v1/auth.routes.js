const { Router } = require('express');
const authController = require('../../controllers/auth.controller');
const { validate } = require('../../middleware/validate.middleware');
const { loginSchema, refreshSchema, logoutSchema } = require('../../validators/auth.schemas');
const { authenticate } = require('../../middleware/auth.middleware');

const router = Router();

router.post('/login', validate(loginSchema), authController.login);
router.post('/refresh', validate(refreshSchema), authController.refresh);
router.post('/logout', authenticate, validate(logoutSchema), authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = { authRouter: router };
