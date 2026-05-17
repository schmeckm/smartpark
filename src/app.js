const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const { logger } = require('./utils/logger');
const { requestContext } = require('./middleware/request-context.middleware');
const { notFoundHandler } = require('./middleware/not-found.middleware');
const { errorHandler } = require('./middleware/error.middleware');
const { authenticate } = require('./middleware/auth.middleware');
const { attachParkContext, requireParkContext } = require('./middleware/park-context.middleware');
const { requirePermission } = require('./middleware/rbac.middleware');
const { deprecation } = require('./middleware/deprecation.middleware');
const aiController = require('./controllers/ai.controller');
const mlAiController = require('./controllers/ml-ai.controller');
const integrationsController = require('./controllers/integrations.controller');
const { validate } = require('./middleware/validate.middleware');
const {
  installLocalAdapterBodySchema,
  installedAdapterIdParamsSchema,
  adapterKeyParamsSchema,
  adapterPackageAssetQuerySchema,
  adapterPipelineLogQuerySchema,
} = require('./validators/integrations.schemas');
const { parkSnapshotsBulkDeleteBody, parkSnapshotsPurgeBody } = require('./validators/ml-ai.validators');
const { v1Router } = require('./routes/v1');
const { masterDataRouter } = require('./modules/master-data/master-data.routes');
const { unsRouter } = require('./modules/uns/uns.routes');
const { staffRouter } = require('./routes/v1/staff.routes');
const { visitPlanRouter } = require('./routes/v1/visit-plan.routes');
const { visitActualRouter } = require('./routes/v1/visit-actual.routes');
const { adaptersRouter } = require('./routes/v1/adapters.routes');
const { getAppRelease } = require('./utils/app-release.util');

const app = express();

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(requestContext);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.requestId,
    customProps: (req, res) => ({
      requestId: req.requestId,
      userId: req.user?.id ?? null,
      responseTime: res.responseTime,
    }),
    serializers: {
      req(req) {
        return { method: req.method, url: req.url, id: req.id };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  })
);

app.get('/health', (req, res) => {
  const rel = getAppRelease();
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'smart-park-os',
      version: rel.version,
      apiVersion: rel.apiVersion,
      ...(rel.gitCommit ? { gitCommit: rel.gitCommit } : {}),
    },
  });
});

app.get('/', (req, res) => {
  const rel = getAppRelease();
  res.json({
    success: true,
    data: {
      service: 'smart-park-os',
      version: rel.version,
      message: 'This is the API. Use the admin UI (Vite dev on port 5173) or the routes below.',
      links: {
        health: '/health',
        healthV1: '/api/v1/health',
        healthReadyV1: '/api/v1/health/ready',
        openApi: '/api/v1/docs',
        login: 'POST /api/v1/auth/login',
      },
    },
  });
});

// Registered on the root app (before /api/v1 mount) so POST always matches in Docker/proxy setups.
app.post(
  '/api/v1/ai/forecasts/refresh',
  authenticate,
  attachParkContext,
  requirePermission('ai', 'refresh'),
  requireParkContext,
  aiController.refreshForecasts
);
/** Feature-store snapshot deletes — root mount so POST always matches (same rationale as forecasts/refresh). */
app.post(
  '/api/v1/ai/feature-store/park-snapshots/bulk-delete',
  authenticate,
  attachParkContext,
  requirePermission('ai', 'refresh'),
  requireParkContext,
  validate(parkSnapshotsBulkDeleteBody),
  mlAiController.bulkDeleteParkFeatureSnapshots
);
app.post(
  '/api/v1/ai/feature-store/park-snapshots/purge',
  authenticate,
  attachParkContext,
  requirePermission('ai', 'refresh'),
  requireParkContext,
  validate(parkSnapshotsPurgeBody),
  mlAiController.purgeParkFeatureSnapshots
);
app.post(
  '/api/v1/integrations/installed-adapters/install-local',
  authenticate,
  requirePermission('integrations', 'manage'),
  validate(installLocalAdapterBodySchema),
  integrationsController.installLocalAdapter
);
/**
 * Phase B2 alias — same handler as `/api/v1/integrations/installed-adapters/install-local`.
 * Marked deprecated in OpenAPI and at runtime via Deprecation/Link/Sunset headers
 * (RFC 8594 / RFC 8288). Kept live so the admin-dashboard's current
 * `/integrations/adapters/install-local` calls continue to work; physical
 * removal is a future major-version action after the dashboard migrates to
 * the canonical path.
 */
app.post(
  '/api/v1/integrations/adapters/install-local',
  deprecation({
    canonical: '/api/v1/integrations/installed-adapters/install-local',
    reason: 'Phase B2 — alias of installed-adapters/install-local; new clients should use the canonical path.',
  }),
  authenticate,
  requirePermission('integrations', 'manage'),
  validate(installLocalAdapterBodySchema),
  integrationsController.installLocalAdapter
);
/** Same rationale as install-local POST — some proxies/stacks only surface select routes on the root app. */
app.delete(
  '/api/v1/integrations/installed-adapters/:id',
  authenticate,
  requirePermission('integrations', 'manage'),
  validate(installedAdapterIdParamsSchema, 'params'),
  integrationsController.deleteInstalledAdapter
);
/** No JWT: browsers do not send Authorization on img src. Same handler as in v1 (path whitelist in controller). */
app.get(
  '/api/v1/integrations/adapters/packages/:adapterKey/asset',
  validate(adapterKeyParamsSchema, 'params'),
  validate(adapterPackageAssetQuerySchema, 'query'),
  integrationsController.getAdapterPackageAsset
);
/** Same rationale as install-local — ensure GET is always registered (admin UI pipeline log). */
app.get(
  '/api/v1/integrations/adapters/pipeline-log',
  authenticate,
  requirePermission('integrations', 'read'),
  validate(adapterPipelineLogQuerySchema, 'query'),
  integrationsController.getAdapterPipelineLog
);

/**
 * Master-data CRUD under /api/v1/master-data — mounted on the root app (same pattern as pipeline-log)
 * so proxies / older stacks always surface these routes without relying only on the nested v1 router.
 */
app.use('/api/v1/master-data', authenticate, masterDataRouter);

/**
 * UNS (tree, topics, Sparkplug preview, MQTT live) — root mount like master-data so GET routes match
 * through Docker/Vite proxy stacks that only surface select `/api/v1/...` paths reliably.
 */
app.use('/api/v1/uns', authenticate, attachParkContext, unsRouter);

/** Staff roster (CRUD + JSON/Excel export/import) — mounted like master-data so proxies/stacks always match `/api/v1/staff/*`. */
app.use('/api/v1/staff', authenticate, staffRouter);

/**
 * Visit planning versions (year grid, saved per park) — root mount like staff so POST/PATCH always match
 * through Docker/Vite proxy stacks (same issue as pipeline-log / master-data).
 */
app.use('/api/v1/visit-plans', authenticate, attachParkContext, visitPlanRouter);

/** Stored visit actuals (Ist) per park and calendar year — feeds rule-based forecast. */
app.use('/api/v1/visit-actuals', authenticate, attachParkContext, visitActualRouter);

/** Adapter operations center (health, dashboard, run-now, pause, …). */
app.use('/api/v1/adapters', authenticate, adaptersRouter);

app.use('/api/v1', v1Router);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app };
