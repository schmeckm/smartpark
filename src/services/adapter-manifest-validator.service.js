const { QUALITY_TIERS } = require('../utils/adapter-manifest-ui');

/**
 * Home Assistant–style manifest validation for local adapter packages.
 */
class AdapterManifestValidatorService {
  /**
   * @param {object} manifest
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateManifest(manifest) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['manifest must be an object'] };
    }
    if (!manifest.adapterKey || typeof manifest.adapterKey !== 'string') {
      errors.push('adapterKey is required (string)');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('version is required (string)');
    }
    if (manifest.runtime !== 'NODE') {
      errors.push('runtime must be NODE');
    }
    const entrypoint = manifest.entrypoint || 'index.js';
    if (typeof entrypoint !== 'string' || !entrypoint.trim()) {
      errors.push('entrypoint must be a non-empty string');
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('name is required (string)');
    }
    if (!manifest.adapterType || typeof manifest.adapterType !== 'string') {
      errors.push('adapterType is required (string)');
    }
    if (!Array.isArray(manifest.capabilities)) {
      errors.push('capabilities must be an array');
    }
    if (manifest.logo != null && typeof manifest.logo !== 'string') errors.push('logo must be a string');
    if (manifest.icon != null && typeof manifest.icon !== 'string') errors.push('icon must be a string');
    if (manifest.category != null && typeof manifest.category !== 'string') errors.push('category must be a string');
    if (manifest.website != null && typeof manifest.website !== 'string') errors.push('website must be a string');
    if (manifest.documentationUrl != null && typeof manifest.documentationUrl !== 'string') {
      errors.push('documentationUrl must be a string');
    }
    if (manifest.author != null && typeof manifest.author !== 'string') errors.push('author must be a string');
    if (manifest.description != null && typeof manifest.description !== 'string') errors.push('description must be a string');
    if (manifest.logoPath != null && typeof manifest.logoPath !== 'string') errors.push('logoPath must be a string');
    if (manifest.readmePath != null && typeof manifest.readmePath !== 'string') errors.push('readmePath must be a string');
    if (manifest.bannerPath != null && typeof manifest.bannerPath !== 'string') errors.push('bannerPath must be a string');
    if (manifest.tags != null && !Array.isArray(manifest.tags)) errors.push('tags must be an array');
    if (manifest.qualityTier != null && !QUALITY_TIERS.has(manifest.qualityTier)) {
      errors.push('qualityTier must be one of CORE, VERIFIED, COMMUNITY, CUSTOM');
    }
    return { valid: errors.length === 0, errors };
  }
}

module.exports = { AdapterManifestValidatorService };
