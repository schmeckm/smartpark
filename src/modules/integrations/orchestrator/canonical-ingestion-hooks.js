'use strict';

/**
 * Phase C3.7 — post-ingest hook registry.
 *
 * Provider-specific work that must run AFTER the canonical pipeline
 * has ingested a batch of messages (currently: theme-parks platform
 * master-data sync + live observations sync) used to live as
 * `if (provider equals 'themeparks_wiki')` branches in the orchestrator.
 *
 * That hard-coded check made the orchestrator violate Open/Closed:
 * adding a second integration (e.g. wartezeiten) would either grow a
 * second `if` branch or quietly silently skip the post-ingest work.
 *
 * The registry below replaces the branches with a single call:
 *   `await canonicalIngestionHooks.runAfterEntities(provider, ctx)`
 *   `await canonicalIngestionHooks.runAfterLive(provider, ctx)`
 *
 * Provider modules opt in by calling `registerAfterEntities` /
 * `registerAfterLive` at module-import time (top-level side effect).
 * The single bootstrap entry point
 * `canonical-ingestion-hooks.bootstrap.js` requires every provider
 * module known to register hooks — so a new provider just adds a line
 * to that bootstrap file.
 *
 * The registry is intentionally a tiny class (`CanonicalIngestionHookRegistry`)
 * exposed via a singleton so multiple imports during a process all
 * see the same map.
 *
 * Failure isolation: each `run*` method runs at most one hook (the one
 * matching the provider), and any error is surfaced to the caller —
 * the existing pipeline code wraps these calls in try/catch so the
 * canonical ingestion is never blocked by a hook failure. Tests pin
 * this behavior.
 */

class CanonicalIngestionHookRegistry {
  constructor() {
    this._afterEntities = new Map();
    this._afterLive = new Map();
  }

  /**
   * @param {string} provider          provider key, e.g. 'themeparks_wiki'
   * @param {(ctx: object) => any} fn  invoked after `syncEntities` ingest
   */
  registerAfterEntities(provider, fn) {
    if (!provider || typeof fn !== 'function') {
      throw new TypeError('registerAfterEntities requires (provider, fn)');
    }
    this._afterEntities.set(String(provider).toLowerCase(), fn);
  }

  /**
   * @param {string} provider
   * @param {(ctx: object) => any} fn  invoked after `syncLive` ingest
   */
  registerAfterLive(provider, fn) {
    if (!provider || typeof fn !== 'function') {
      throw new TypeError('registerAfterLive requires (provider, fn)');
    }
    this._afterLive.set(String(provider).toLowerCase(), fn);
  }

  hasAfterEntities(provider) {
    return this._afterEntities.has(String(provider || '').toLowerCase());
  }

  hasAfterLive(provider) {
    return this._afterLive.has(String(provider || '').toLowerCase());
  }

  /**
   * Run the after-entities hook registered for `provider`, if any.
   * Returns whatever the hook returns, or `null` if none is registered.
   */
  async runAfterEntities(provider, ctx) {
    const fn = this._afterEntities.get(String(provider || '').toLowerCase());
    if (!fn) return null;
    return fn(ctx);
  }

  /**
   * Run the after-live hook registered for `provider`, if any.
   * Returns whatever the hook returns, or `null` if none is registered.
   */
  async runAfterLive(provider, ctx) {
    const fn = this._afterLive.get(String(provider || '').toLowerCase());
    if (!fn) return null;
    return fn(ctx);
  }

  /** Test-only — clears every registration. */
  __resetForTests() {
    this._afterEntities.clear();
    this._afterLive.clear();
  }

  /** Test-only — peek at the registered provider keys. */
  __listForTests() {
    return {
      afterEntities: [...this._afterEntities.keys()].sort(),
      afterLive: [...this._afterLive.keys()].sort(),
    };
  }
}

const canonicalIngestionHooks = new CanonicalIngestionHookRegistry();

module.exports = {
  CanonicalIngestionHookRegistry,
  canonicalIngestionHooks,
};
