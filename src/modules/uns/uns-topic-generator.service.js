const { slugifyName } = require('../../utils/slugify.util');

function generateTopicPath({ parkSlug, version = 'v1', domain, assetSlug, metric }) {
  return `tpuns/${slugifyName(parkSlug)}/${version}/${slugifyName(domain)}/${slugifyName(assetSlug)}/${slugifyName(metric)}`;
}

/**
 * Canonical UNS / TP-UNS topic (fachlich): tpuns/{park}/v1/{entity_type}/{entity_slug}/{metric}
 * @param {{ parkSlug: string; version?: string; entityType: string; entitySlug: string; metric: string }} p
 */
function buildCanonicalUnsTopic({ parkSlug, version = 'v1', entityType, entitySlug, metric }) {
  return generateTopicPath({ parkSlug, version, domain: entityType, assetSlug: entitySlug, metric });
}

module.exports = { generateTopicPath, buildCanonicalUnsTopic, slugifyName };
