const { asyncHandler } = require('../utils/async-handler');
const { sequelize } = require('../models');
const { getAppRelease } = require('../utils/app-release.util');

const health = asyncHandler(async (req, res) => {
  const rel = getAppRelease();
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'smart-park-os',
      timestamp: new Date().toISOString(),
      version: rel.version,
      apiVersion: rel.apiVersion,
      ...(rel.gitCommit ? { gitCommit: rel.gitCommit } : {}),
    },
  });
});

const healthDb = asyncHandler(async (req, res) => {
  const t0 = Date.now();
  await sequelize.authenticate();
  const latencyMs = Date.now() - t0;
  res.json({
    success: true,
    data: {
      status: 'ok',
      database: 'connected',
      latencyMs,
    },
  });
});

/** Readiness for orchestrators: 200 when DB accepts connections, 503 otherwise. */
const healthReady = asyncHandler(async (req, res) => {
  const rel = getAppRelease();
  try {
    const t0 = Date.now();
    await sequelize.authenticate();
    const latencyMs = Date.now() - t0;
    res.status(200).json({
      success: true,
      data: {
        status: 'ready',
        database: 'connected',
        latencyMs,
        version: rel.version,
        apiVersion: rel.apiVersion,
      },
    });
  } catch {
    res.status(503).json({
      success: false,
      data: {
        status: 'not_ready',
        database: 'unavailable',
        version: rel.version,
        apiVersion: rel.apiVersion,
      },
    });
  }
});

module.exports = { health, healthDb, healthReady };
