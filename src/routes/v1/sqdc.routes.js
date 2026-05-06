const { Router } = require('express');
const { requirePermission, requireAnyPermission } = require('../../middleware/rbac.middleware');
const { requireParkContext } = require('../../middleware/park-context.middleware');
const { validate, validateMerged } = require('../../middleware/validate.middleware');
const { boardQuery, historyQuery, moodBody, safetyBody, snapshotBody } = require('../../validators/sqdc.schemas');
const {
  parkBoardMerged,
  assetBoardMerged,
  sqdcEventBody,
  moodFeedbackBody,
  dailySnapshotBody,
} = require('../../validators/sqdc-board.schemas');
const sqdcController = require('../../controllers/sqdc.controller');

const router = Router();
router.use(requireParkContext);

/** Hierarchical SQDC (park + asset); `parkId` must match `X-Park-Id`. */
router.get(
  '/parks/:parkId/board',
  requirePermission('rides', 'read'),
  validateMerged(parkBoardMerged),
  sqdcController.getParkBoardHierarchical
);
router.get(
  '/parks/:parkId/assets/:assetId/board',
  requirePermission('rides', 'read'),
  validateMerged(assetBoardMerged),
  sqdcController.getAssetBoardHierarchical
);

router.get('/board', requirePermission('rides', 'read'), validate(boardQuery, 'query'), sqdcController.getBoard);
router.get('/history', requirePermission('rides', 'read'), validate(historyQuery, 'query'), sqdcController.getHistory);

router.post(
  '/mood',
  requireAnyPermission(['rides', 'update'], ['incidents', 'create']),
  validate(moodBody),
  sqdcController.postMood
);
router.post(
  '/safety-events',
  requireAnyPermission(['rides', 'update'], ['incidents', 'create']),
  validate(safetyBody),
  sqdcController.postSafety
);
router.post(
  '/snapshots',
  requireAnyPermission(['rides', 'update'], ['incidents', 'create']),
  validate(snapshotBody),
  sqdcController.postSnapshot
);

router.post(
  '/events',
  requireAnyPermission(['rides', 'update'], ['incidents', 'create']),
  validate(sqdcEventBody),
  sqdcController.postSqdcEvent
);
router.post(
  '/mood-feedback',
  requireAnyPermission(['rides', 'update'], ['incidents', 'create']),
  validate(moodFeedbackBody),
  sqdcController.postMoodFeedback
);
router.post(
  '/daily-snapshots',
  requireAnyPermission(['rides', 'update'], ['incidents', 'create']),
  validate(dailySnapshotBody),
  sqdcController.postDailySnapshot
);

module.exports = { sqdcRouter: router };
