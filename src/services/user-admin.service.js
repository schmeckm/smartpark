const bcrypt = require('bcrypt');
const { sequelize } = require('../db/sequelize');
const { AppError } = require('../utils/app-error');
const { UserRepository } = require('../repositories/user.repository');
const { RefreshTokenRepository } = require('../repositories/refresh-token.repository');
const { AuthService } = require('./auth.service');
const { AuditLogService } = require('./audit-log.service');
const { legacyEnumFromRoleCode, resolveUserRoleCodes } = require('../constants/role-codes');
const AUDIT = require('../constants/audit-actions');

const BCRYPT_ROUNDS = 12;

class UserAdminService {
  constructor() {
    this.userRepository = new UserRepository();
    this.refreshTokenRepository = new RefreshTokenRepository();
    this.authService = new AuthService();
    this.auditLogService = new AuditLogService();
  }

  async listUsers() {
    const users = await this.userRepository.listAll();
    return users.map((u) => this.authService.toPublicUser(u));
  }

  async createUser(payload, actorUserId) {
    const email = payload.email.toLowerCase().trim();
    if (await this.userRepository.emailExists(email)) {
      throw new AppError('Email already in use', 409, { code: 'EMAIL_EXISTS' });
    }

    const roleCode = String(payload.roleCode).trim();
    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    const active = payload.active !== undefined ? Boolean(payload.active) : true;

    const user = await sequelize.transaction(async (transaction) => {
      const created = await this.userRepository.createUser(
        {
          firstName: payload.firstName.trim(),
          lastName: payload.lastName.trim(),
          email,
          passwordHash,
          role: legacyEnumFromRoleCode(roleCode),
          active,
        },
        { transaction }
      );
      await this.userRepository.replaceRoleCodes(created.id, [roleCode], { transaction });
      return this.userRepository.findById(created.id);
    });

    const publicUser = this.authService.toPublicUser(user);
    await this.auditLogService.log({
      action: AUDIT.USER_CREATE,
      entityType: 'user',
      entityId: publicUser.id,
      oldValue: null,
      newValue: { email: publicUser.email, roles: publicUser.roles, active: publicUser.active },
      userId: actorUserId,
    });

    return publicUser;
  }

  async updateUser(userId, payload, actorUserId) {
    const existing = await this.userRepository.findById(userId);
    if (!existing) {
      throw new AppError('User not found', 404, { code: 'NOT_FOUND' });
    }

    const patch = {};
    if (payload.firstName != null) patch.firstName = payload.firstName.trim();
    if (payload.lastName != null) patch.lastName = payload.lastName.trim();
    if (payload.active !== undefined) patch.active = Boolean(payload.active);
    if (payload.email != null) {
      const email = payload.email.toLowerCase().trim();
      if (await this.userRepository.emailExists(email, { excludeUserId: userId })) {
        throw new AppError('Email already in use', 409, { code: 'EMAIL_EXISTS' });
      }
      patch.email = email;
    }
    if (payload.password) {
      patch.passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    }
    if (payload.roleCode != null) {
      patch.role = legacyEnumFromRoleCode(payload.roleCode);
    }

    const oldPublic = this.authService.toPublicUser(existing);

    const user = await sequelize.transaction(async (transaction) => {
      if (Object.keys(patch).length) {
        await this.userRepository.updateUser(userId, patch, { transaction });
      }
      if (payload.roleCode != null) {
        await this.userRepository.replaceRoleCodes(userId, [String(payload.roleCode).trim()], {
          transaction,
        });
      }
      return this.userRepository.findById(userId);
    });

    if (payload.password || payload.active === false) {
      await this.refreshTokenRepository.revokeAllForUser(userId);
    }

    const publicUser = this.authService.toPublicUser(user);
    await this.auditLogService.log({
      action: AUDIT.USER_UPDATE,
      entityType: 'user',
      entityId: userId,
      oldValue: {
        email: oldPublic.email,
        roles: oldPublic.roles,
        active: oldPublic.active,
        firstName: oldPublic.firstName,
        lastName: oldPublic.lastName,
      },
      newValue: {
        email: publicUser.email,
        roles: publicUser.roles,
        active: publicUser.active,
        firstName: publicUser.firstName,
        lastName: publicUser.lastName,
        passwordChanged: Boolean(payload.password),
      },
      userId: actorUserId,
    });

    return publicUser;
  }

  async deleteUser(userId, actorUserId) {
    if (userId === actorUserId) {
      throw new AppError('Cannot delete your own account', 403, { code: 'SELF_DELETE_FORBIDDEN' });
    }

    const existing = await this.userRepository.findById(userId);
    if (!existing) {
      throw new AppError('User not found', 404, { code: 'NOT_FOUND' });
    }

    const roles = resolveUserRoleCodes(existing);
    if (roles.includes('SYSTEM_ADMIN')) {
      const all = await this.userRepository.listAll();
      const adminCount = all.filter((u) => resolveUserRoleCodes(u).includes('SYSTEM_ADMIN')).length;
      if (adminCount <= 1) {
        throw new AppError('Cannot delete the last system administrator', 403, {
          code: 'LAST_ADMIN_FORBIDDEN',
        });
      }
    }

    const oldPublic = this.authService.toPublicUser(existing);

    await sequelize.transaction(async (transaction) => {
      await this.refreshTokenRepository.revokeAllForUser(userId);
      await this.userRepository.deleteUser(userId, { transaction });
    });

    await this.auditLogService.log({
      action: AUDIT.USER_DELETE,
      entityType: 'user',
      entityId: userId,
      oldValue: { email: oldPublic.email, roles: oldPublic.roles },
      newValue: null,
      userId: actorUserId,
    });
  }
}

module.exports = { UserAdminService };
