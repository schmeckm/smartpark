const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/app-error');
const { verifyAccessToken } = require('../utils/jwt.util');
const { User, UserRole } = require('../models');
const { getRequestContext } = require('../context/request-context-store');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401, { code: 'UNAUTHORIZED' }));
  }
  const token = header.slice(7).trim();
  if (!token) {
    return next(new AppError('Authentication required', 401, { code: 'UNAUTHORIZED' }));
  }
  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') {
      return next(new AppError('Invalid token type', 401, { code: 'INVALID_TOKEN' }));
    }
    const user = await User.findByPk(payload.sub, {
      include: [{ model: UserRole, as: 'userRoles', required: false }],
    });
    if (!user || !user.active) {
      return next(new AppError('Unauthorized', 401, { code: 'UNAUTHORIZED' }));
    }
    req.user = user;
    const store = getRequestContext();
    if (store) {
      store.userId = user.id;
      store.user = user;
    }
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      return next(new AppError('Invalid or expired token', 401, { code: 'INVALID_TOKEN' }));
    }
    return next(err);
  }
}

module.exports = { authenticate };
