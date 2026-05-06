const { ExternalEntityMappingRepository } = require('../repositories/external-entity-mapping.repository');
const { MappingRuleRepository } = require('../repositories/mapping-rule.repository');
const { RideRepository } = require('../repositories/ride.repository');

function normalizeText(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

class ExternalEntityMappingService {
  constructor() {
    this.mappingRepository = new ExternalEntityMappingRepository();
    this.ruleRepository = new MappingRuleRepository();
    this.rideRepository = new RideRepository();
  }

  listMappings(filters) {
    return this.mappingRepository.findAll(filters);
  }

  getMapping(id) {
    return this.mappingRepository.findById(id);
  }

  async patchMapping(id, patch) {
    const row = await this.mappingRepository.findById(id);
    if (!row) return null;
    await row.update(patch);
    return row;
  }

  async ensureMappingRecord(msg) {
    return this.mappingRepository.upsertByExternalKey(
      {
        provider: msg.provider,
        externalParkId: msg.externalParkId || null,
        externalEntityId: msg.externalEntityId || '',
      },
      {
        externalDestinationId: msg.externalDestinationId || null,
        externalEntityName: msg.payload.externalEntityName || msg.payload.name || 'Unknown',
        externalEntityType: msg.entityType || msg.payload.entityType || 'OTHER',
        mappingStatus: 'UNMAPPED',
        metadata: {},
      }
    );
  }

  async resolveMapping(msg) {
    const ensured = await this.ensureMappingRecord(msg);
    if (ensured.mappingStatus === 'MAPPED' && ensured.internalEntityType && ensured.internalEntityId) {
      return ensured;
    }
    const rules = await this.ruleRepository.findEnabledByProvider(msg.provider);
    if (!rules.length) return ensured;

    const rides = await this.rideRepository.findAll();
    const msgName = normalizeText(msg.payload.externalEntityName || msg.payload.name);

    for (const rule of rules) {
      if (rule.externalEntityType && rule.externalEntityType !== (msg.entityType || msg.payload.entityType)) continue;
      if (rule.internalEntityType && rule.internalEntityType !== 'RIDE') continue;
      if (rule.matchStrategy === 'EXACT_NAME') {
        const matched = rides.find((r) => normalizeText(r.name) === msgName);
        if (matched) {
          await ensured.update({
            internalEntityType: 'RIDE',
            internalEntityId: matched.id,
            mappingStatus: 'MAPPED',
            confidence: 0.95,
            metadata: { matchedBy: 'EXACT_NAME' },
          });
          return ensured;
        }
      }
    }
    return ensured;
  }
}

module.exports = { ExternalEntityMappingService };
