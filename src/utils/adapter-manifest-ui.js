'use strict';

const QUALITY_TIERS = new Set(['CORE', 'VERIFIED', 'COMMUNITY', 'CUSTOM']);

/**
 * Optional Home Assistant–style manifest UI fields (all optional).
 * @param {object|null|undefined} manifest
 * @returns {Record<string, unknown>}
 */
function extractManifestUi(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return {
      logo: null,
      icon: null,
      category: null,
      website: null,
      documentationUrl: null,
      author: null,
      qualityTier: null,
      description: null,
      tags: [],
      logoPath: null,
      readmePath: null,
      bannerPath: null,
    };
  }
  const m = manifest;
  const tags = Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string') : [];
  const qt = typeof m.qualityTier === 'string' && QUALITY_TIERS.has(m.qualityTier) ? m.qualityTier : null;
  const logoPath =
    typeof m.logoPath === 'string' && m.logoPath.trim()
      ? m.logoPath.trim().replace(/^\/+/, '').replace(/\\/g, '/')
      : null;
  const readmePath =
    typeof m.readmePath === 'string' && m.readmePath.trim()
      ? m.readmePath.trim().replace(/^\/+/, '').replace(/\\/g, '/')
      : null;
  const bannerPath =
    typeof m.bannerPath === 'string' && m.bannerPath.trim()
      ? m.bannerPath.trim().replace(/^\/+/, '').replace(/\\/g, '/')
      : null;
  return {
    logo: typeof m.logo === 'string' ? m.logo : null,
    icon: typeof m.icon === 'string' ? m.icon : null,
    category: typeof m.category === 'string' ? m.category : null,
    website: typeof m.website === 'string' ? m.website : null,
    documentationUrl: typeof m.documentationUrl === 'string' ? m.documentationUrl : null,
    author: typeof m.author === 'string' ? m.author : null,
    qualityTier: qt,
    description: typeof m.description === 'string' ? m.description : null,
    tags,
    logoPath,
    readmePath,
    bannerPath,
  };
}

/**
 * Browser-safe path for a package asset (same host as the admin UI / API consumer).
 * Always relative so Docker internal hostnames (e.g. api:3000) never appear in JSON.
 * @param {string} adapterKey
 * @param {string} relativePath normalized relative path inside package
 */
function buildPackageAssetUrl(adapterKey, relativePath) {
  if (!adapterKey || !relativePath) return null;
  return `/api/v1/integrations/adapters/packages/${encodeURIComponent(adapterKey)}/asset?path=${encodeURIComponent(relativePath)}`;
}

/**
 * Logo URL: absolute `ui.logo` passthrough, or same-origin asset path for `logoPath`.
 * @param {string} adapterKey
 * @param {object} ui from extractManifestUi
 */
function buildLogoAssetUrl(adapterKey, ui) {
  if (!ui || typeof ui !== 'object') return null;
  if (ui.logo && typeof ui.logo === 'string' && /^https?:\/\//i.test(ui.logo)) return ui.logo;
  if (!ui.logoPath) return null;
  return buildPackageAssetUrl(adapterKey, ui.logoPath);
}

/**
 * Merge manifest + DB metadata.ui (metadata.ui wins on overlap).
 */
function mergeUiForRow(_adapterKey, manifestFromScan, metadata) {
  const fromManifest = extractManifestUi(manifestFromScan || {});
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const metaUi = meta.ui && typeof meta.ui === 'object' ? meta.ui : {};
  return { ...fromManifest, ...metaUi };
}

/** Lazy singleton — load manifest.json from disk when scan list misses the package (e.g. path/cwd quirks). */
let _adapterPackageLoader;
function loadManifestFromDisk(adapterKey) {
  const k = String(adapterKey || '').trim();
  if (!k) return null;
  try {
    if (!_adapterPackageLoader) {
      const { AdapterPackageLoaderService } = require('../services/adapter-package-loader.service');
      _adapterPackageLoader = new AdapterPackageLoaderService();
    }
    const loaded = _adapterPackageLoader.loadByAdapterKey(k);
    const m = loaded?.manifest;
    return m && typeof m === 'object' ? m : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ rows: any[], localScan: any[], inventoryByKey?: Map<string, any> }} p
 */
function enrichPackagesResponsePayload({ rows, localScan, inventoryByKey }) {
  const scanByKey = new Map();
  for (const item of localScan || []) {
    const m = item.manifest || {};
    const k = String(m.adapterKey || item.adapterKey || '').trim();
    if (k) scanByKey.set(k, item);
  }

  function readmeBannerUrls(adapterKey, scan, ui) {
    let readmeRel = scan?.readmePath || null;
    let bannerRel = scan?.bannerPath || null;
    if (!readmeRel && ui?.readmePath) readmeRel = ui.readmePath;
    if (!bannerRel && ui?.bannerPath) bannerRel = ui.bannerPath;
    const readmeAssetUrl = readmeRel ? buildPackageAssetUrl(adapterKey, readmeRel) : null;
    const bannerAssetUrl = bannerRel ? buildPackageAssetUrl(adapterKey, bannerRel) : null;
    return { readmeAssetUrl, bannerAssetUrl };
  }

  const data = (rows || []).map((row) => {
    const j = row.toJSON ? row.toJSON() : row;
    const scan = scanByKey.get(j.adapterKey);
    let resolvedManifest = scan?.manifest && typeof scan.manifest === 'object' ? scan.manifest : null;
    if (!resolvedManifest) resolvedManifest = loadManifestFromDisk(j.adapterKey);
    const manifestForUi = resolvedManifest || {};
    const ui = mergeUiForRow(j.adapterKey, manifestForUi, j.metadata);
    const logoAssetUrl = buildLogoAssetUrl(j.adapterKey, ui);
    const { readmeAssetUrl, bannerAssetUrl } = readmeBannerUrls(j.adapterKey, scan, ui);
    const inv = inventoryByKey?.get?.(j.adapterKey) || null;
    return {
      ...j,
      manifest: resolvedManifest,
      ui,
      logoAssetUrl,
      readmeAssetUrl,
      bannerAssetUrl,
      deviceCount: inv?.deviceCount ?? null,
      entityCount: inv?.entityCount ?? null,
      serviceCount: inv?.serviceCount ?? null,
    };
  });
  const localIntegrationPackages = (localScan || []).map((item) => {
    const m = item.manifest || {};
    const key = String(m.adapterKey || item.adapterKey || '').trim();
    const ui = mergeUiForRow(key, m, item.metadata || {});
    const logoAssetUrl = buildLogoAssetUrl(key, ui);
    const { readmeAssetUrl, bannerAssetUrl } = readmeBannerUrls(key, item, ui);
    const inv = inventoryByKey?.get?.(key) || null;
    return {
      ...item,
      ui,
      logoAssetUrl,
      readmeAssetUrl,
      bannerAssetUrl,
      deviceCount: inv?.deviceCount ?? null,
      entityCount: inv?.entityCount ?? null,
      serviceCount: inv?.serviceCount ?? null,
    };
  });
  return { data, meta: { localIntegrationPackages } };
}

module.exports = {
  extractManifestUi,
  buildPackageAssetUrl,
  buildLogoAssetUrl,
  mergeUiForRow,
  enrichPackagesResponsePayload,
  QUALITY_TIERS,
};
