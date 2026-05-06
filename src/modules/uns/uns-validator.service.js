const { AppError } = require('../../utils/app-error');

const TOPIC_REGEX = /^tpuns\/[a-z0-9_]+\/v1\/[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9_]+$/;

function validateTopicPath(topicPath) {
  if (!TOPIC_REGEX.test(String(topicPath || ''))) {
    throw new AppError('Invalid UNS topic path', 422, { code: 'VALIDATION_ERROR' });
  }
  return true;
}

function parseTopic(topicPath) {
  validateTopicPath(topicPath);
  const [root, parkSlug, version, domain, assetSlug, metric] = String(topicPath).split('/');
  return { root, parkSlug, version, domain, assetSlug, metric };
}

module.exports = { validateTopicPath, parseTopic };
