const { Router } = require('express');
const { requireAnyPermission, requirePermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate } = require('../../middleware/validate.middleware');
const addonBoardController = require('../../controllers/addon-board.controller');
const { zoneIdParams, rideIdParams, boardIdParams, layoutQuery } = require('../../validators/addon-board.schemas');
const { rideIdWidgetIdParams } = require('../../validators/addon-board-custom-widget-lifecycle.validator');

const router = Router();
router.use(requireParkContext);

router.get(
  '/summary',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  addonBoardController.getSummary
);
router.get(
  '/rides',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  addonBoardController.getRides
);
router.get(
  '/critical-rides',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  addonBoardController.getCriticalRides
);
router.get(
  '/zones',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  addonBoardController.listZones
);
router.get(
  '/heatmap',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  addonBoardController.getHeatmap
);
router.get(
  '/templates',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  addonBoardController.listTemplates
);
router.get(
  '/templates/:boardId',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(boardIdParams, 'params'),
  addonBoardController.getTemplate
);
router.get(
  '/layout',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(layoutQuery, 'query'),
  addonBoardController.getLayout
);
router.get(
  '/zones/:zoneId/summary',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(zoneIdParams, 'params'),
  addonBoardController.getZoneSummary
);
router.get(
  '/rides/:rideId/detail',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(rideIdParams, 'params'),
  addonBoardController.getRideDetail
);
router.get(
  '/rides/:rideId/widget-source-draft',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(rideIdParams, 'params'),
  addonBoardController.getWidgetSourceDraftHandler
);
router.put(
  '/rides/:rideId/widget-source-draft',
  requirePermission('rides', 'update'),
  validate(rideIdParams, 'params'),
  addonBoardController.putWidgetSourceDraft
);
router.get(
  '/rides/:rideId/custom-widgets',
  requireAnyPermission(['ops', 'read'], ['rides', 'read']),
  validate(rideIdParams, 'params'),
  addonBoardController.getCustomWidgetsHandler
);
router.patch(
  '/rides/:rideId/custom-widgets/:widgetId',
  requirePermission('rides', 'update'),
  validate(rideIdWidgetIdParams, 'params'),
  addonBoardController.patchCustomWidgetHandler
);
router.delete(
  '/rides/:rideId/custom-widgets/:widgetId',
  requirePermission('rides', 'update'),
  validate(rideIdWidgetIdParams, 'params'),
  addonBoardController.deleteCustomWidgetHandler
);
router.post(
  '/rides/:rideId/widgets/from-source-draft',
  requirePermission('rides', 'update'),
  validate(rideIdParams, 'params'),
  addonBoardController.postPromoteWidgetFromDraft
);

module.exports = { addonBoardRouter: router };
