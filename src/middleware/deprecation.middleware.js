'use strict';

/**
 * `Deprecation` / `Sunset` / `Link` response-header middleware (RFC 8594, RFC 9745,
 * Web Linking RFC 8288). Use it to mark a single Express route as deprecated
 * without changing its semantics — the response body, status, and timing are
 * untouched, only headers are added.
 *
 * The middleware is intentionally request-static: it does not read `req.path`,
 * does not log, and does not branch on the user. The deprecation is a property
 * of the *route registration* (you mount it before the handler), not of the
 * request, so observability stays predictable.
 *
 * Why this exists:
 *  - We are mid-migration on several v1 endpoints (Phase B). Some legacy aliases
 *    must stay live for backwards compatibility while new clients should be
 *    nudged to the canonical path.
 *  - OpenAPI's `deprecated: true` is read at API-doc time, not at request time;
 *    SDK consumers that don't regenerate from `openapi.yaml` will miss it.
 *  - HTTP `Deprecation` and `Sunset` headers are runtime signals that show up
 *    in the client's response object, dev-tools network tab, and SDK
 *    middleware. They are the standard way to flag a deprecated alias.
 *
 * Usage:
 *
 *   const { deprecation } = require('../middleware/deprecation.middleware');
 *
 *   app.post(
 *     '/api/v1/integrations/adapters/install-local',
 *     deprecation({
 *       canonical: '/api/v1/integrations/installed-adapters/install-local',
 *       reason: 'Phase B2 — alias kept live for one major version.',
 *     }),
 *     authenticate,
 *     ... handlers ...
 *   );
 *
 * Headers emitted (none are removed if already set on the response):
 *   - `Deprecation: true`         (always)
 *   - `Link: <{canonical}>; rel="successor-version"` (when `canonical` provided)
 *   - `X-API-Deprecation-Reason: {reason}`           (when `reason` provided)
 *   - `Sunset: {sunset}`          (when `sunset` ISO-8601 datetime provided)
 *
 * @param {object} [options]
 * @param {string} [options.canonical] Full canonical URL or path; emitted as
 *   `Link: <…>; rel="successor-version"` (RFC 8288 + IETF API
 *   Versioning best practice).
 * @param {string} [options.reason] Free-form reason copied into the
 *   non-standard `X-API-Deprecation-Reason` header for ops visibility.
 * @param {string} [options.sunset] ISO-8601 datetime for the planned removal;
 *   emitted as RFC 8594 `Sunset` header. Leave undefined when no removal
 *   date has been agreed.
 * @returns {(req: import('express').Request, res: import('express').Response, next: Function) => void}
 */
function deprecation({ canonical, reason, sunset } = {}) {
  return function deprecationMiddleware(req, res, next) {
    res.setHeader('Deprecation', 'true');
    if (canonical) {
      res.setHeader('Link', `<${canonical}>; rel="successor-version"`);
    }
    if (reason) {
      res.setHeader('X-API-Deprecation-Reason', String(reason));
    }
    if (sunset) {
      res.setHeader('Sunset', String(sunset));
    }
    next();
  };
}

module.exports = { deprecation };
