const rateLimit = require('express-rate-limit');

/** Brute-force protection for credential endpoints (per IP). */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Try again later.',
    code: 'RATE_LIMIT',
  },
});

module.exports = { authRateLimiter };
