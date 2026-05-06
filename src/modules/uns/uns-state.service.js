const { UnsLatestState } = require('../../models');

class UnsStateService {
  async upsertState({ parkId, topicPath, payloadJson, eventTime, quality, source }) {
    const existing = await UnsLatestState.findOne({ where: { topicPath } });
    if (existing) {
      await existing.update({ parkId, payloadJson, eventTime, quality, source });
      return existing;
    }
    return UnsLatestState.create({ parkId, topicPath, payloadJson, eventTime, quality, source });
  }

  async getLatestStateByPark(parkId) {
    return UnsLatestState.findAll({ where: { parkId }, order: [['eventTime', 'DESC']] });
  }
}

module.exports = { UnsStateService };
