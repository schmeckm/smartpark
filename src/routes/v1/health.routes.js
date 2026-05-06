const { Router } = require('express');
const healthController = require('../../controllers/health.controller');

const router = Router();

router.get('/', healthController.health);
router.get('/db', healthController.healthDb);
router.get('/ready', healthController.healthReady);

module.exports = { healthRouter: router };
