'use strict';

const { ExternalEntityMapping, Park } = require('../../../../models');

/**
 * Lists integration mappings flagged NEEDS_REVIEW (canonical ingestion pipeline).
 * Scoped by park when `parks.external_entity_id` matches `external_entity_mappings.external_park_id`.
 */
const externalMappingsNeedsReviewTool = {
  name: 'read.external_mappings_needs_review',
  description: 'Lists NEEDS_REVIEW external entity mappings for operator review.',
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  async execute(_context, args) {
    const parkId = args.parkId;
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 40));

    const park = await Park.findByPk(parkId, { attributes: ['id', 'externalEntityId'] });

    /** @type {import('sequelize').WhereOptions} */
    const where = { mappingStatus: 'NEEDS_REVIEW' };
    if (park?.externalEntityId) {
      where.externalParkId = String(park.externalEntityId);
    }

    const rows = await ExternalEntityMapping.findAll({
      where,
      order: [['id', 'DESC']],
      limit,
      attributes: [
        'id',
        'provider',
        'externalParkId',
        'externalEntityId',
        'externalEntityName',
        'externalEntityType',
        'internalEntityType',
        'internalEntityId',
        'confidence',
        'mappingStatus',
      ],
    });

    const items = rows.map((r) => {
      const p = r.get({ plain: true });
      return {
        id: p.id,
        provider: p.provider,
        externalParkId: p.externalParkId,
        externalEntityId: p.externalEntityId,
        externalEntityName: p.externalEntityName,
        externalEntityType: p.externalEntityType,
        internalEntityType: p.internalEntityType,
        internalEntityId: p.internalEntityId,
        confidence: p.confidence != null ? Number(p.confidence) : null,
      };
    });

    return {
      parkId,
      scopedByParkExternalId: Boolean(park?.externalEntityId),
      count: items.length,
      items,
    };
  },
};

module.exports = { externalMappingsNeedsReviewTool };
