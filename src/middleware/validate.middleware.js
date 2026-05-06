const { AppError } = require('../utils/app-error');

function validate(schema, property = 'body') {
  return (req, res, next) => {
    const source = req[property];
    const { error, value } = schema.validate(source, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return next(
        new AppError('Validation failed', 422, {
          code: 'VALIDATION_ERROR',
          details: error.details.map((d) => ({
            message: d.message,
            path: d.path.join('.'),
          })),
        })
      );
    }
    req.validated = value;
    next();
  };
}

function validateMerged(schema) {
  return (req, res, next) => {
    const source = { ...req.params, ...req.query };
    const { error, value } = schema.validate(source, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return next(
        new AppError('Validation failed', 422, {
          code: 'VALIDATION_ERROR',
          details: error.details.map((d) => ({
            message: d.message,
            path: d.path.join('.'),
          })),
        })
      );
    }
    req.validated = value;
    next();
  };
}

/** Params + body (typical for PATCH /resource/:id). */
function validateMergedParamsBody(schema) {
  return (req, res, next) => {
    const source = { ...req.params, ...req.body };
    const { error, value } = schema.validate(source, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return next(
        new AppError('Validation failed', 422, {
          code: 'VALIDATION_ERROR',
          details: error.details.map((d) => ({
            message: d.message,
            path: d.path.join('.'),
          })),
        })
      );
    }
    req.validated = value;
    next();
  };
}

module.exports = { validate, validateMerged, validateMergedParamsBody };
