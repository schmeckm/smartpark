const { Router } = require('express');
const recommendationController = require('../../controllers/recommendation.controller');
const { requirePermission } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validate.middleware');
const { updateRecommendationStatusSchema } = require('../../validators/recommendation.schemas');

const router = Router();

router.get('/', requirePermission('recommendations', 'read'), recommendationController.listRecommendations);
router.patch(
  '/:id/status',
  requirePermission('recommendations', 'update'),
  validate(updateRecommendationStatusSchema),
  recommendationController.updateRecommendationStatus
);

module.exports = { recommendationRouter: router };
