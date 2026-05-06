const jwt = require('jsonwebtoken');
const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const createError = require('http-errors');
const { AppError } = require('../utils/app-error');
const { logger } = require('../utils/logger');

function sendError(res, status, body) {
  res.status(status).json({ success: false, ...body });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = req.requestId;

  if (err instanceof AppError) {
    logger.warn(
      {
        err: err.message,
        stack: err.stack,
        requestId,
        statusCode: err.statusCode,
        code: err.code,
        details: err.details,
      },
      'handled application error'
    );
    sendError(res, err.statusCode, {
      message: err.message,
      code: err.code,
      requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  if (err instanceof ValidationError) {
    logger.warn({ err: err.message, stack: err.stack, requestId }, 'sequelize validation error');
    sendError(res, 400, {
      message: 'Validation failed',
      code: 'DATABASE_VALIDATION_ERROR',
      requestId,
      details: err.errors.map((e) => ({ message: e.message, path: e.path })),
    });
    return;
  }

  if (err instanceof UniqueConstraintError) {
    logger.warn({ err: err.message, requestId }, 'unique constraint');
    sendError(res, 409, {
      message: 'Conflict: duplicate record',
      code: 'CONFLICT',
      requestId,
    });
    return;
  }

  if (err instanceof ForeignKeyConstraintError) {
    logger.warn({ err: err.message, requestId }, 'foreign key constraint');
    sendError(res, 400, {
      message: 'Invalid reference',
      code: 'INVALID_REFERENCE',
      requestId,
    });
    return;
  }

  if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
    logger.warn({ err: err.message, requestId }, 'jwt error');
    sendError(res, 401, {
      message: 'Invalid or expired token',
      code: 'INVALID_TOKEN',
      requestId,
    });
    return;
  }

  if (createError.isHttpError(err)) {
    logger.warn({ err: err.message, requestId, statusCode: err.status }, 'http error');
    sendError(res, err.status, {
      message: err.message,
      code: err.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR',
      requestId,
    });
    return;
  }

  logger.error({ err, stack: err?.stack, requestId }, 'unhandled error');
  sendError(res, 500, {
    message: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  });
}

module.exports = { errorHandler };
