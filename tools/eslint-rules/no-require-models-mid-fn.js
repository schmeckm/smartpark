'use strict';

/**
 * Custom ESLint rule: no-require-models-mid-fn
 *
 * Flags `require('…/models')` (or `require('models')`) calls that happen INSIDE
 * a function body. The Smart Park OS audit identified mid-function model
 * imports as the canonical anti-pattern leading to:
 *
 *   - hidden cross-domain coupling (a controller silently growing access to a
 *     model it didn't declare at the top of the file),
 *   - circular import bugs that only manifest at the first call (because the
 *     require is deferred), and
 *   - drift between what the file claims to depend on (top of file) and what
 *     it actually touches at runtime.
 *
 * Top-level `const { … } = require('../models')` remains fine — that's the
 * recommended pattern. This rule is intentionally narrow (it does not ban
 * deferred requires in general, only `…/models` ones).
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow require("…/models") inside function bodies (must be hoisted to the top of the module).',
    },
    schema: [],
    messages: {
      midFnRequire:
        'require("{{request}}") must be at the top level of the module, not inside a function. Mid-function model imports hide cross-domain coupling and create circular-require bugs.',
    },
  },
  create(context) {
    const fnStack = [];

    function isModelsRequire(node) {
      if (
        node.type !== 'CallExpression' ||
        node.callee.type !== 'Identifier' ||
        node.callee.name !== 'require' ||
        node.arguments.length !== 1
      ) {
        return null;
      }
      const arg = node.arguments[0];
      if (arg.type !== 'Literal' || typeof arg.value !== 'string') return null;

      const req = arg.value;
      // Match `models`, `./models`, `../models`, `../../models`, … (with optional /index).
      const trimmed = req.replace(/\/index(\.js)?$/, '');
      if (/(^|\/)models$/.test(trimmed)) return req;
      return null;
    }

    return {
      ':function'(node) {
        fnStack.push(node);
      },
      ':function:exit'() {
        fnStack.pop();
      },
      CallExpression(node) {
        const request = isModelsRequire(node);
        if (request == null) return;
        if (fnStack.length === 0) return; // top-level require: allowed.
        context.report({
          node,
          messageId: 'midFnRequire',
          data: { request },
        });
      },
    };
  },
};
