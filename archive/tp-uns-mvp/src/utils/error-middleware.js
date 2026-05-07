const { AppError } = require('./app-error');

function notFound(_req, _res, next) {
  next(new AppError('Route not found', 404));
}

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    details: err.details || null,
  });
}

module.exports = { notFound, errorHandler };
