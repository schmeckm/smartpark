'use strict';

/**
 * Phase C3.7 — single bootstrap entry point for canonical-ingestion
 * post-ingest hooks.
 *
 * Each provider module that wants to plug into the post-ingest pipeline
 * is required here exactly once. The required module performs its
 * `canonicalIngestionHooks.registerAfterEntities(...)` /
 * `registerAfterLive(...)` calls at module-import time as a top-level
 * side effect, so importing this file causes ALL providers to register.
 *
 * Adding a new provider is a one-line change here — no orchestrator
 * edit needed. That is the whole point of the post-ingest hook
 * registry: the orchestrator no longer needs to know about specific
 * provider keys.
 *
 * `CanonicalIngestionPipelineService` requires this file at module
 * load, so the registrations are guaranteed to be in place before any
 * sync call hits `runAfterEntities` / `runAfterLive`.
 */

require('../../adapters/themeparks/themeparks-sync.service');

module.exports = {};
