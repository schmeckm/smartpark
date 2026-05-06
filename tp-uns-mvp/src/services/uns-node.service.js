const { Op } = require('sequelize');
const { Park, UnsNode, LatestState } = require('../models');
const { AppError } = require('../utils/app-error');
const { generateTopicPath, slugifyName } = require('./uns-topic-generator.service');

function toTree(nodes, parentId = null) {
  return nodes
    .filter((n) => n.parentId === parentId)
    .map((n) => ({
      ...n,
      children: toTree(nodes, n.id),
    }));
}

class UnsNodeService {
  async createPark(payload) {
    const row = await Park.create({
      name: payload.name,
      slug: slugifyName(payload.slug || payload.name),
      timezone: payload.timezone || 'Europe/Berlin',
    });
    return row;
  }

  async createNode(parkId, payload) {
    const park = await Park.findByPk(parkId);
    if (!park) throw new AppError('Park not found', 404);

    let topicPath = null;
    if (payload.isLeaf) {
      topicPath = generateTopicPath({
        parkSlug: park.slug,
        version: 'v1',
        domain: payload.domain,
        assetSlug: payload.slug,
        metric: payload.metric,
      });
    }

    return UnsNode.create({
      parkId,
      parentId: payload.parentId || null,
      name: payload.name,
      slug: slugifyName(payload.slug || payload.name),
      nodeType: payload.nodeType,
      domain: payload.domain || null,
      metric: payload.metric || null,
      unit: payload.unit || null,
      topicPath,
      description: payload.description || null,
      isLeaf: Boolean(payload.isLeaf),
      isActive: payload.isActive !== false,
    });
  }

  async getTreeByPark(parkId) {
    const nodes = await UnsNode.findAll({ where: { parkId }, order: [['createdAt', 'ASC']] });
    return toTree(nodes.map((n) => (n.toJSON ? n.toJSON() : n)));
  }

  async updateNode(nodeId, patch) {
    const row = await UnsNode.findByPk(nodeId);
    if (!row) throw new AppError('Node not found', 404);
    await row.update(patch);
    return row;
  }

  async deleteNode(nodeId) {
    const row = await UnsNode.findByPk(nodeId);
    if (!row) throw new AppError('Node not found', 404);
    await row.destroy();
  }

  async listTopicsByPark(parkId) {
    const rows = await UnsNode.findAll({ where: { parkId, isLeaf: true, topicPath: { [Op.ne]: null } } });
    return rows.map((r) => ({ id: r.id, name: r.name, topicPath: r.topicPath, metric: r.metric, unit: r.unit }));
  }

  async getLatestStateByPark(parkId) {
    return LatestState.findAll({ where: { parkId }, order: [['eventTime', 'DESC']] });
  }
}

module.exports = { UnsNodeService };
