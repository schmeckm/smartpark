const { Router } = require('express');
const { requirePermission } = require('../../middleware/rbac.middleware');
const weatherController = require('../../controllers/weather.controller');

const router = Router();

router.get('/current', requirePermission('weather', 'read'), weatherController.current);
router.post('/observations', requirePermission('weather', 'create'), ...weatherController.createValidators);

module.exports = { weatherRouter: router };
