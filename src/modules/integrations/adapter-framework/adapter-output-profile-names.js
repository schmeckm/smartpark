/**
 * Output profile identifiers accepted by {@link OutputRouterService}.
 * API clients may send SCREAMING_SNAKE; encoders use lowercase snake.
 */

/** Default for new adapter installs (YAML) and UI when no profiles saved yet — Sparkplug MQTT + historian. */
const DEFAULT_INSTALL_OUTPUT_PROFILES = ['SPARKPLUG_JSON', 'CANONICAL_HISTORIAN'];

const OUTPUT_PROFILE_INTERNAL = ['uns_json', 'sparkplug_json', 'canonical_historian'];

const ALIAS_TO_INTERNAL = {
  UNS_JSON: 'uns_json',
  SPARKPLUG_JSON: 'sparkplug_json',
  CANONICAL_HISTORIAN: 'canonical_historian',
  uns_json: 'uns_json',
  sparkplug_json: 'sparkplug_json',
  canonical_historian: 'canonical_historian',
};

/**
 * @param {string[]|undefined|null} profiles
 * @returns {string[]|undefined} normalized list or undefined to use env default
 */
function normalizeOutputProfiles(profiles) {
  if (!profiles || !profiles.length) return undefined;
  const out = [];
  for (const p of profiles) {
    const key = String(p).trim();
    const internal = ALIAS_TO_INTERNAL[key] || ALIAS_TO_INTERNAL[key.toUpperCase()];
    if (internal) out.push(internal);
    else if (OUTPUT_PROFILE_INTERNAL.includes(key)) out.push(key);
  }
  return out.length ? out : undefined;
}

module.exports = {
  OUTPUT_PROFILE_INTERNAL,
  DEFAULT_INSTALL_OUTPUT_PROFILES,
  normalizeOutputProfiles,
};
