const { randomUUID } = require('crypto');
const { requestContextStore } = require('../context/request-context-store');

function requestContext(req, res, next) {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.requestId);

  const store = {
    req,
    requestId: req.requestId,
    userId: null,
    user: null,
  };

  requestContextStore.run(store, () => next());
}

module.exports = { requestContext };
