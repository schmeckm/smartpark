const { UserPark } = require('../models');
const { resolveUserRoleCodes, ROLE_CODES } = require('../constants/role-codes');

function isSystemAdmin(user) {
  return resolveUserRoleCodes(user).includes(ROLE_CODES.SYSTEM_ADMIN);
}

/**
 * @param {import('../models').User} user
 * @param {string} parkId
 */
async function userCanAccessPark(user, parkId) {
  if (!user?.id || !parkId) return false;
  if (isSystemAdmin(user)) return true;
  const row = await UserPark.findOne({
    where: { userId: user.id, parkId: String(parkId) },
    attributes: ['id'],
  });
  return Boolean(row);
}

/**
 * @param {import('../models').User} user
 * @returns {Promise<string[]>}
 */
async function listAccessibleParkIds(user) {
  if (!user?.id) return [];
  if (isSystemAdmin(user)) {
    const { Park } = require('../models');
    const rows = await Park.findAll({ attributes: ['id'] });
    return rows.map((p) => p.id);
  }
  const rows = await UserPark.findAll({
    where: { userId: user.id },
    attributes: ['parkId'],
  });
  return rows.map((r) => r.parkId);
}

module.exports = { userCanAccessPark, listAccessibleParkIds, isSystemAdmin };
