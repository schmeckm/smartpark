'use strict';

const test = require('node:test');
const { RuleTester } = require('eslint');
const rule = require('./no-require-models-mid-fn');

test('no-require-models-mid-fn (ESLint RuleTester)', () => {
  const tester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
  });

  tester.run('no-require-models-mid-fn', rule, {
    valid: [
      // Top-level require is the canonical pattern — must NOT be flagged.
      "const { Park } = require('../models');",
      "const m = require('./models');",
      "const m = require('../../models');",
      "const m = require('../../../models');",
      "const m = require('models');",
      "const m = require('../models/index');",
      "const m = require('../models/index.js');",
      // Top-level require of unrelated module — must NOT be flagged.
      "const x = require('./other-thing');",
      // Mid-function require of a non-models module — must NOT be flagged
      // (rule is intentionally narrow).
      "function f() { const x = require('./other'); }",
      // Top-level wrapper that re-exports the central models index is fine.
      "module.exports = require('../models');",
    ],
    invalid: [
      {
        code: 'function load() { const m = require("../models"); return m; }',
        errors: [{ messageId: 'midFnRequire' }],
      },
      {
        code: 'const fn = () => { const { Park } = require("../models"); return Park; };',
        errors: [{ messageId: 'midFnRequire' }],
      },
      {
        code: 'class S { run() { const m = require("../../models"); return m; } }',
        errors: [{ messageId: 'midFnRequire' }],
      },
      {
        code: 'function f() { return require("./models").Park; }',
        errors: [{ messageId: 'midFnRequire' }],
      },
      {
        code: 'async function f() { const m = await Promise.resolve(require("../../../models")); return m; }',
        errors: [{ messageId: 'midFnRequire' }],
      },
      {
        code: 'function f() { const m = require("../models/index"); return m; }',
        errors: [{ messageId: 'midFnRequire' }],
      },
      {
        code: 'function f() { const m = require("../models/index.js"); return m; }',
        errors: [{ messageId: 'midFnRequire' }],
      },
    ],
  });
});
