const { Park, ParkAsset, AssetType } = require('../../models');
const { buildCanonicalUnsTopic, slugifyName } = require('./uns-topic-generator.service');
const { resolveThemeParksPublicationDomain } = require('./theme-parks-entity-domain.service');
const { getDefaultMetricsForAssetTypeCode } = require('./uns-default-metrics');

/**
 * Resolve platform `parks.id` from integration selection (external park id on ThemeParks, etc.).
 * @param {{ provider?: string; externalParkId?: string | null }} selected
 */
async function resolvePlatformParkUuidForIntegrationPark(selected) {
  const ext = selected?.externalParkId != null ? String(selected.externalParkId).trim() : '';
  if (!ext) return null;
  const row = await Park.findOne({
    where: { externalEntityId: ext },
  });
  return row?.id || null;
}

/**
 * Build flat UNS leaf rows from Master Data (`park_assets` + `asset_types`) for topic preview / materialize.
 * Rows align with `IntegrationOrchestratorService.buildDynamicUnsTopicNodesFromIntegrations` shape.
 *
 * @param {{ provider: string; externalParkId: string; parkSlug: string }} ctx
 * @returns {Promise<Array<{ provider: string, externalParkId: string, externalEntityId: string, entityName: string, entityType: string|null, domain: string, assetSlug: string, metric: string, topicPath: string, source: string }>>}
 */
async function generateUnsTopicRowsFromMasterData(ctx) {
  const provider = String(ctx.provider || '').trim() || 'master_data';
  const externalParkId = ctx.externalParkId != null ? String(ctx.externalParkId) : '';
  const parkSlug = slugifyName(ctx.parkSlug || externalParkId || 'park');

  const parkUuid = await resolvePlatformParkUuidForIntegrationPark({
    provider,
    externalParkId,
  });
  if (!parkUuid) return [];

  const assets = await ParkAsset.findAll({
    where: { parkId: parkUuid, activeFlag: true },
  });
  if (!assets.length) return [];

  const typeIds = [...new Set(assets.map((a) => a.assetTypeId).filter(Boolean))];
  const types = typeIds.length ? await AssetType.findAll({ where: { id: typeIds } }) : [];
  const typeIdToCode = new Map(types.map((t) => [t.id, String(t.code || '').trim().toLowerCase()]));

  const out = [];
  for (const asset of assets) {
    const typeCode = typeIdToCode.get(asset.assetTypeId) || 'entities';
    const domain = resolveThemeParksPublicationDomain(null, typeCode.toUpperCase());
    const assetSlug = slugifyName(asset.slug || asset.name || String(asset.assetId));
    const extId = asset.externalEntityId != null ? String(asset.externalEntityId).trim() : String(asset.assetId);
    const metrics = getDefaultMetricsForAssetTypeCode(typeCode);
    for (const metric of metrics) {
      out.push({
        provider,
        externalParkId,
        externalEntityId: extId,
        entityName: asset.name,
        entityType: typeCode ? typeCode.toUpperCase() : null,
        domain,
        assetSlug,
        metric,
        topicPath: buildCanonicalUnsTopic({
          parkSlug,
          entityType: domain,
          entitySlug: assetSlug,
          metric,
        }),
        source: 'MASTER_DATA',
      });
    }
  }
  return out;
}

/**
 * @param {string} platformParkUuid — `parks.id`
 */
async function generateUnsFromMasterData(platformParkUuid) {
  const id = String(platformParkUuid || '').trim();
  if (!id) return [];
  const park = await Park.findByPk(id);
  if (!park) return [];
  const parkSlug = slugifyName(park.slug || park.name || id);
  const externalParkId = park.externalEntityId != null ? String(park.externalEntityId) : id;
  return generateUnsTopicRowsFromMasterData({
    provider: 'master_data',
    externalParkId,
    parkSlug,
  });
}

module.exports = {
  generateUnsTopicRowsFromMasterData,
  generateUnsFromMasterData,
  resolvePlatformParkUuidForIntegrationPark,
};
