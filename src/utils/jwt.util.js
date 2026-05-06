const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signAccessToken(user, roles) {
  const roleList = Array.isArray(roles) ? roles : [];
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      roles: roleList,
      type: 'access',
    },
    env.jwtSecret,
    { expiresIn: env.jwtAccessExpiresIn, issuer: 'smart-park-os' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtSecret, { issuer: 'smart-park-os' });
}

module.exports = { signAccessToken, verifyAccessToken };
