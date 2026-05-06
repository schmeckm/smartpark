const bcrypt = require('bcrypt');
const env = require('../config/env');
const { AppError } = require('../utils/app-error');
const { UserRepository } = require('../repositories/user.repository');
const { RefreshTokenRepository } = require('../repositories/refresh-token.repository');
const { signAccessToken } = require('../utils/jwt.util');
const { resolveUserRoleCodes } = require('../constants/role-codes');
const { generateRefreshToken, hashRefreshToken } = require('../utils/token.util');
const { AuditLogService } = require('./audit-log.service');
const AUDIT = require('../constants/audit-actions');

const auditLogService = new AuditLogService();

class AuthService {
  constructor() {
    this.userRepository = new UserRepository();
    this.refreshTokenRepository = new RefreshTokenRepository();
  }

  toPublicUser(user) {
    const u = user.get ? user.get({ plain: true }) : { ...user };
    delete u.passwordHash;
    delete u.userRoles;
    const roles = resolveUserRoleCodes(user);
    u.roles = roles;
    delete u.role;
    u.languageCode = u.languageCode || 'en';
    u.displayName = u.displayName != null && String(u.displayName).trim() !== '' ? String(u.displayName).trim() : null;
    u.timezone = u.timezone != null && String(u.timezone).trim() !== '' ? String(u.timezone).trim() : null;
    u.dateFormat = u.dateFormat || 'YYYY-MM-DD';
    u.timeFormat = u.timeFormat === '12h' ? '12h' : '24h';
    u.locale =
      u.locale != null && String(u.locale).trim() !== '' ? String(u.locale).trim() : null;
    return u;
  }

  async login(email, password, { ipAddress = null, userIdForAudit = null } = {}) {
    const user = await this.userRepository.findByEmailForAuth(email);
    if (!user) {
      await auditLogService.log({
        action: AUDIT.AUTH_LOGIN,
        entityType: 'user',
        entityId: null,
        oldValue: null,
        newValue: { email, outcome: 'failure', reason: 'unknown_user' },
        userId: null,
      });
      throw new AppError('Invalid email or password', 401, { code: 'INVALID_CREDENTIALS' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await auditLogService.log({
        action: AUDIT.AUTH_LOGIN,
        entityType: 'user',
        entityId: user.id,
        oldValue: null,
        newValue: { email: user.email, outcome: 'failure', reason: 'bad_password' },
        userId: null,
      });
      throw new AppError('Invalid email or password', 401, { code: 'INVALID_CREDENTIALS' });
    }
    if (!user.active) {
      throw new AppError('Account disabled', 403, { code: 'ACCOUNT_DISABLED' });
    }

    await this.userRepository.updateLastLogin(user.id);

    const refreshPlain = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshPlain);
    const expiresAt = new Date(Date.now() + env.jwtRefreshDays * 86400000);

    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    const roleCodes = resolveUserRoleCodes(user);
    const accessToken = signAccessToken(user, roleCodes);

    await auditLogService.log({
      action: AUDIT.AUTH_LOGIN,
      entityType: 'user',
      entityId: user.id,
      oldValue: null,
      newValue: { email: user.email, outcome: 'success' },
      userId: user.id,
    });

    return {
      accessToken,
      refreshToken: refreshPlain,
      expiresIn: env.jwtAccessExpiresIn,
      user: this.toPublicUser(user),
    };
  }

  async refresh(refreshPlain) {
    if (!refreshPlain) {
      throw new AppError('Refresh token required', 400, { code: 'REFRESH_TOKEN_REQUIRED' });
    }
    const tokenHash = hashRefreshToken(refreshPlain);
    const row = await this.refreshTokenRepository.findValidByHash(tokenHash);
    if (!row) {
      throw new AppError('Invalid or expired refresh token', 401, { code: 'INVALID_REFRESH_TOKEN' });
    }
    const user = await this.userRepository.findById(row.userId);
    if (!user || !user.active) {
      throw new AppError('Invalid refresh token', 401, { code: 'INVALID_REFRESH_TOKEN' });
    }

    await this.refreshTokenRepository.revokeByHash(tokenHash);

    const newPlain = generateRefreshToken();
    const newHash = hashRefreshToken(newPlain);
    const expiresAt = new Date(Date.now() + env.jwtRefreshDays * 86400000);
    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: newHash,
      expiresAt,
    });

    const accessToken = signAccessToken(user, resolveUserRoleCodes(user));

    await auditLogService.log({
      action: AUDIT.AUTH_REFRESH,
      entityType: 'user',
      entityId: user.id,
      oldValue: null,
      newValue: { rotated: true },
      userId: user.id,
    });

    return {
      accessToken,
      refreshToken: newPlain,
      expiresIn: env.jwtAccessExpiresIn,
      user: this.toPublicUser(user),
    };
  }

  async logout(refreshPlain, userId) {
    if (refreshPlain) {
      const tokenHash = hashRefreshToken(refreshPlain);
      await this.refreshTokenRepository.revokeByHash(tokenHash);
    } else if (userId) {
      await this.refreshTokenRepository.revokeAllForUser(userId);
    }
    await auditLogService.log({
      action: AUDIT.AUTH_LOGOUT,
      entityType: 'user',
      entityId: userId,
      oldValue: null,
      newValue: { allSessions: !refreshPlain },
      userId,
    });
    return { success: true };
  }
}

module.exports = { AuthService };
