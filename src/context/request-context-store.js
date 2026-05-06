const { AsyncLocalStorage } = require('async_hooks');

const requestContextStore = new AsyncLocalStorage();

function getRequestContext() {
  return requestContextStore.getStore();
}

module.exports = { requestContextStore, getRequestContext };
