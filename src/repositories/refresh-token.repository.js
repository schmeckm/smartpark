const { RefreshToken } = require('../models');
const { Op } = require('sequelize');

class RefreshTokenRepository {
  create(data) {
    return RefreshToken.create(data);
  }

  findValidByHash(tokenHash) {
    return RefreshToken.findOne({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });
  }

  async revokeByHash(tokenHash) {
    const row = await RefreshToken.findOne({ where: { tokenHash } });
    if (!row) return false;
    await row.update({ revokedAt: new Date() });
    return true;
  }

  async revokeAllForUser(userId) {
    await RefreshToken.update(
      { revokedAt: new Date() },
      { where: { userId, revokedAt: null } }
    );
  }
}

module.exports = { RefreshTokenRepository };
