/**
 * Smoke: ML influence tables + effective config resolution (Postgres + migrate + seed).
 * Run: npm run smoke:ml-influence
 */
/* eslint-disable no-console */
require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize, MlGlobalFactor, MlProfile, ParkAsset } = require(path.join(__dirname, '..', 'src', 'models'));
const { resolveEffectiveMlConfig } = require(path.join(__dirname, '..', 'src', 'services', 'ml-effective-config.service'));
const { mergeMlEnterpriseLayer } = require(path.join(__dirname, '..', 'src', 'services', 'ml-forecast-layer.service'));

async function main() {
  await sequelize.authenticate();
  const g = await MlGlobalFactor.count();
  const p = await MlProfile.count();
  if (!g || !p) {
    console.warn('SKIP: run db:migrate and db:seed (includes ml seed) first');
    process.exit(0);
  }
  const asset = await ParkAsset.findOne({ order: [['assetId', 'ASC']] });
  if (!asset) {
    console.warn('SKIP: no park_assets');
    process.exit(0);
  }
  const eff = await resolveEffectiveMlConfig(asset.assetId);
  if (!eff.profileCode && !eff.profile?.profileCode) {
    throw new Error('Expected default profile resolution');
  }
  console.log('OK effective ML:', { assetId: asset.assetId, profileCode: eff.profileCode, source: eff.source });

  const merged = await mergeMlEnterpriseLayer(
    { forecast15Minutes: 20, forecast60Minutes: 30, currentAvgWaitMinutes: 18, confidence: 0.5 },
    {
      internalParkId: asset.parkId,
      internalAssetId: asset.assetId,
      parkSnap: { is_public_holiday: true, month: 7, is_weekend: true },
      rideSnap: { rain_sensitive: true, staffing_gap_normal: 2 },
    }
  );
  if (!merged.topInfluencingFactors?.length) {
    throw new Error('Expected merged influencing factors');
  }
  if (!('mlFactorCurrents' in merged) || typeof merged.mlFactorCurrents !== 'object' || merged.mlFactorCurrents === null) {
    throw new Error('Expected merged summary to include mlFactorCurrents object');
  }
  for (const [code, row] of Object.entries(merged.mlFactorCurrents)) {
    if (row && typeof row === 'object' && 'meta' in row) {
      throw new Error(`mlFactorCurrents.${code} must not expose internal meta`);
    }
  }
  console.log('OK merge sample factors:', merged.topInfluencingFactors.slice(0, 5));

  await sequelize.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
