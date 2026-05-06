function inferCode(statusCode) {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 422) return 'VALIDATION_ERROR';
  return 'INTERNAL_ERROR';
}

class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [statusCode]
   * @param {{ details?: unknown; code?: string } | unknown} [options] If plain object without `code`/`details` keys, treated as `details` (legacy).
   */
  constructor(message, statusCode = 500, options) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;

    let details;
    let code = inferCode(statusCode);

    if (options != null && typeof options === 'object' && !Array.isArray(options)) {
      const hasStructured =
        Object.prototype.hasOwnProperty.call(options, 'code') ||
        Object.prototype.hasOwnProperty.call(options, 'details');
      if (hasStructured) {
        details = options.details;
        if (options.code) code = options.code;
      } else {
        details = options;
      }
    } else if (options !== undefined) {
      details = options;
    }

    this.details = details;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { AppError, inferCode };
