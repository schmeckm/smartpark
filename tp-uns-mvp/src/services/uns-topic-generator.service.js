const { AppError } = require('../utils/app-error');

function slugifyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function generateTopicPath({ parkSlug, version = 'v1', domain, assetSlug, metric }) {
  const p = slugifyName(parkSlug);
  const d = slugifyName(domain);
  const a = slugifyName(assetSlug);
  const m = slugifyName(metric);
  if (!p || !d || !a || !m) throw new AppError('Invalid topic parts', 400);
  return `tpuns/${p}/${version}/${d}/${a}/${m}`;
}

function validateTopicPath(topicPath) {
  const regex = /^tpuns\/[a-z0-9_]+\/v\d+\/[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9_]+$/;
  return regex.test(String(topicPath || ''));
}

module.exports = { slugifyName, generateTopicPath, validateTopicPath };
