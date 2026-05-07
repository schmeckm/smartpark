'use strict';

/**
 * Smart Park OS — ESLint baseline (Phase QW5).
 *
 * Goal: a thin, brownfield-safe baseline. We do NOT enable opinionated style
 * rules here; the existing codebase has its own conventions enforced by code
 * review. What this config enforces is **architectural** debt limits:
 *
 *   1. `max-lines` — global ceiling of 500 lines per source file. The 12 files
 *      currently above the ceiling are explicitly listed in
 *      `MAX_LINES_ALLOW_LIST` with their measured size at the time of writing.
 *      Each line in that list is technical debt; the long-term goal is to
 *      shrink and remove entries, never to add new ones.
 *
 *   2. `smart-park/no-require-models-mid-fn` — disallow `require('…/models')`
 *      inside function bodies. Mid-function model imports were the canonical
 *      anti-pattern flagged in the audit (hidden cross-domain coupling,
 *      circular-require bugs that only manifest at the first call). The 11
 *      production files currently containing this pattern are listed in
 *      `MID_FN_MODELS_ALLOW_LIST`; new files cannot acquire it.
 *
 * Pre-existing legacy `// eslint-disable-next-line ...` comments referencing
 * rules this baseline does not enable (e.g. `no-await-in-loop`, `global-require`,
 * `import/no-dynamic-require`) are intentionally NOT reported as "unused
 * directives", because they document earlier decisions for a future config.
 *
 * Out of scope (not linted): admin-dashboard sub-app, scripts, integration
 * tests, migrations, seeders, the archived `tp-uns-mvp` lab tree, generated
 * docs, and data/log directories.
 */

const globals = require('globals');
const smartParkRules = require('./tools/eslint-rules');

/**
 * Files currently above 500 lines (measured 2026-05-07). DO NOT add new
 * entries without also adding a TODO at the top of the file naming the
 * service it should be split into. Removing entries is the desired direction.
 *
 * Numbers are the measured size at the time of writing — kept in the comment
 * so future reviewers can see whether a file grew or shrank since the
 * allow-list was first put in place.
 */
const MAX_LINES_ALLOW_LIST = [
  'src/modules/master-data/master-data.service.js', // 1122
  'src/services/integration-orchestrator.service.js', // 1003
  'src/services/sqdc-board.service.js', // 982
  'src/services/attraction-oee-simulator.service.js', // 888
  'src/services/ai-studio.service.js', // 843
  'src/modules/uns/uns.service.js', // 809
  'src/services/registry-publisher.service.js', // 801
  'src/services/ride-signal-capability.service.js', // 696
  'src/services/adapter-runtime.service.js', // 640
  'src/services/operations-facts.service.js', // 587
  'src/services/registry-preview.service.js', // 508
  'src/services/addon-board.service.js', // 502
];

/**
 * Files currently containing one or more mid-function `require('…/models')`
 * calls (measured 2026-05-07). Each is technical debt; the goal is to hoist
 * the import to the top of the file and then remove the entry. New files MUST
 * NOT acquire this pattern.
 *
 * Numbers are the violation count at the time of writing.
 */
const MID_FN_MODELS_ALLOW_LIST = [
  'src/controllers/attraction-oee-simulator.controller.js', // 1
  'src/middleware/park-context.middleware.js', // 1
  'src/modules/adapters/themeparks/themeparks-sync.controller.js', // 3
  'src/modules/master-data/entity-type-templates.service.js', // 1
  'src/modules/master-data/master-data.service.js', // 1
  'src/modules/mdm/mdm.controller.js', // 1
  'src/modules/observations/observations.controller.js', // 1
  'src/modules/platform/platform-assets.controller.js', // 5
  'src/modules/platform/platform-parks.controller.js', // 1
  'src/modules/platform/platform-templates.controller.js', // 3
  'src/modules/rides/park-master-rides.controller.js', // 1
  'src/services/canonical-message-apply.service.js', // 4
  'src/services/geo-flow-simulator.service.js', // 2
  'src/services/geo-pressure-engine.service.js', // 1
  'src/services/integration-orchestrator.service.js', // 2
  'src/services/uns-spy-adapter-discovery.service.js', // 2
];

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'admin-dashboard/**',
      'tp-uns-mvp/**',
      'archive/**',
      'docs/**',
      'data/**',
      'logs/**',
      'coverage/**',
      'src/migrations/**',
      'src/seeders/**',
      'src/integration-tests/**',
      'scripts/**',
      'tests/**',
      'public/**',
      'dist/**',
      // Generated artifacts and tool config that doesn't need linting.
      '.history/**',
    ],
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    plugins: {
      'smart-park': smartParkRules,
    },
    linterOptions: {
      // Pre-existing legacy disable comments reference rules this baseline
      // does not enable. Treat them as documentation, not lint problems.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      'smart-park/no-require-models-mid-fn': 'error',
    },
  },
  {
    files: MAX_LINES_ALLOW_LIST,
    rules: {
      'max-lines': 'off',
    },
  },
  {
    files: MID_FN_MODELS_ALLOW_LIST,
    rules: {
      'smart-park/no-require-models-mid-fn': 'off',
    },
  },
  // Tests inside the source tree often legitimately enumerate cases (length)
  // and use deferred `require('../models')` for mock injection (rule). Both
  // are out of scope for the architectural ceiling.
  {
    files: ['src/**/*.test.js'],
    rules: {
      'max-lines': 'off',
      'smart-park/no-require-models-mid-fn': 'off',
    },
  },
];
