'use strict';

const env = require('../config/env');

const ML_PROFILE_DISABLED = {
  success: false,
  code: 'ML_PROFILE_DISABLED',
  message: 'ML profile storage is disabled (set ML_PROFILE_ENABLED=true on the API).',
};

/**
 * When `ML_PROFILE_ENABLED` is false, all profile CRUD routes respond with **404**
 * and a stable JSON body so clients can distinguish from “not found”.
 */
function requireMlProfileEnabled(_req, res, next) {
  if (env.mlProfileEnabled) {
    next();
    return;
  }
  res.status(404).json(ML_PROFILE_DISABLED);
}

module.exports = {
  requireMlProfileEnabled,
  ML_PROFILE_DISABLED,
};
