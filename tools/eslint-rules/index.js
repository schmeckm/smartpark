'use strict';

const noRequireModelsMidFn = require('./no-require-models-mid-fn');

module.exports = {
  meta: {
    name: 'smart-park-rules',
    version: '0.1.0',
  },
  rules: {
    'no-require-models-mid-fn': noRequireModelsMidFn,
  },
};
