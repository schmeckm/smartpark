const { Op } = require('sequelize');
const { User, UserRole } = require('../models');

const userRoleInclude = {
  model: UserRole,
  as: 'userRoles',
  required: false,
};

class UserRepository {
  findByEmailForAuth(email) {
    const normalized = email.toLowerCase().trim();
    return User.unscoped().findOne({
      where: { email: normalized },
      include: [userRoleInclude],
    });
  }

  findByEmail(email) {
    return User.findOne({
      where: { email: email.toLowerCase().trim() },
      include: [userRoleInclude],
    });
  }

  findById(id) {
    return User.findByPk(id, { include: [userRoleInclude] });
  }

  findByIdForAuth(id) {
    return User.unscoped().findByPk(id, { include: [userRoleInclude] });
  }

  listAll() {
    return User.findAll({
      include: [userRoleInclude],
      order: [
        ['lastName', 'ASC'],
        ['firstName', 'ASC'],
        ['email', 'ASC'],
      ],
    });
  }

  async emailExists(email, { excludeUserId = null } = {}) {
    const normalized = email.toLowerCase().trim();
    const where = { email: normalized };
    if (excludeUserId) where.id = { [Op.ne]: excludeUserId };
    const row = await User.findOne({ where, attributes: ['id'] });
    return Boolean(row);
  }

  async createUser(data, { transaction } = {}) {
    return User.unscoped().create(data, { transaction });
  }

  async updateUser(id, data, { transaction } = {}) {
    const user = await User.unscoped().findByPk(id, { transaction });
    if (!user) return null;
    await user.update(data, { transaction });
    return this.findById(id);
  }

  async deleteUser(id, { transaction } = {}) {
    const user = await User.unscoped().findByPk(id, { transaction });
    if (!user) return false;
    await user.destroy({ transaction });
    return true;
  }

  async replaceRoleCodes(userId, roleCodes, { transaction } = {}) {
    const codes = [...new Set(roleCodes.map((c) => String(c).trim()).filter(Boolean))];
    await UserRole.destroy({ where: { userId }, transaction });
    if (!codes.length) return;
    await UserRole.bulkCreate(
      codes.map((roleCode) => ({ userId, roleCode })),
      { transaction }
    );
  }

  async updateLastLogin(id) {
    const user = await User.findByPk(id);
    if (!user) return null;
    await user.update({ lastLoginAt: new Date() });
    return this.findById(id);
  }

  /**
   * @param {string} userId
   * @param {{
   *   languageCode?: string;
   *   displayName?: string | null;
   *   timezone?: string | null;
   *   dateFormat?: string;
   *   timeFormat?: string;
   *   locale?: string | null;
   *   uiPreferences?: Record<string, unknown>;
   * }} patch
   */
  async updateSettings(userId, patch) {
    const user = await User.findByPk(userId);
    if (!user) return null;
    const data = {};
    if (patch.languageCode != null) {
      data.languageCode = String(patch.languageCode).trim().slice(0, 10) || 'en';
    }
    if (patch.displayName !== undefined) {
      data.displayName =
        patch.displayName === null || patch.displayName === ''
          ? null
          : String(patch.displayName).trim().slice(0, 255);
    }
    if (patch.timezone !== undefined) {
      data.timezone =
        patch.timezone === null || patch.timezone === '' ? null : String(patch.timezone).trim().slice(0, 64);
    }
    if (patch.dateFormat != null) {
      data.dateFormat = String(patch.dateFormat).trim().slice(0, 20);
    }
    if (patch.timeFormat != null) {
      data.timeFormat = String(patch.timeFormat).trim().slice(0, 8);
    }
    if (patch.locale !== undefined) {
      data.locale = patch.locale === null || patch.locale === '' ? null : String(patch.locale).trim().slice(0, 32);
    }
    if (patch.uiPreferences !== undefined) {
      const curRaw = user.getDataValue('uiPreferences');
      const cur =
        curRaw && typeof curRaw === 'object' && !Array.isArray(curRaw) ? { ...curRaw } : {};
      const inc =
        patch.uiPreferences && typeof patch.uiPreferences === 'object' && !Array.isArray(patch.uiPreferences)
          ? patch.uiPreferences
          : {};
      const merged = { ...cur, ...inc };
      if (
        inc.parkMapFreqThresholds &&
        typeof inc.parkMapFreqThresholds === 'object' &&
        !Array.isArray(inc.parkMapFreqThresholds)
      ) {
        merged.parkMapFreqThresholds = {
          ...(cur.parkMapFreqThresholds &&
          typeof cur.parkMapFreqThresholds === 'object' &&
          !Array.isArray(cur.parkMapFreqThresholds)
            ? cur.parkMapFreqThresholds
            : {}),
          ...inc.parkMapFreqThresholds,
        };
      }
      data.uiPreferences = merged;
    }
    if (Object.keys(data).length) await user.update(data);
    return this.findById(userId);
  }
}

module.exports = { UserRepository };
