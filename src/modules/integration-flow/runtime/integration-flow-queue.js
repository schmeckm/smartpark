'use strict';

const { EventEmitter } = require('events');
const env = require('../../../config/env');

/**
 * @returns {number}
 */
function resolveConcurrency() {
  return env.integrationFlowConcurrency;
}

/**
 * In-memory worker queue for integration flow runs (decouples schedulers from blocking execution).
 */
class IntegrationFlowQueue extends EventEmitter {
  /**
   * @param {number} concurrency
   */
  constructor(concurrency) {
    super();
    this.concurrency = Math.max(1, concurrency);
    this.activeCount = 0;
    /** @type {{ task: () => Promise<unknown>, resolve: Function, reject: Function }[]} */
    this.pending = [];
  }

  /**
   * Enqueue a flow execution task.
   * @param {() => Promise<unknown>} task
   * @returns {Promise<unknown>}
   */
  push(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.emit('enqueue', this.getStats());
      this._drain();
    });
  }

  _drain() {
    while (this.activeCount < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.activeCount += 1;
      this.emit('dequeue', this.getStats());
      Promise.resolve()
        .then(() => job.task())
        .then(
          (result) => job.resolve(result),
          (err) => job.reject(err)
        )
        .finally(() => {
          this.activeCount -= 1;
          this.emit('complete', this.getStats());
          this._drain();
        });
    }
  }

  getStats() {
    return {
      concurrency: this.concurrency,
      active: this.activeCount,
      pending: this.pending.length,
    };
  }
}

/** @type {IntegrationFlowQueue | null} */
let singleton = null;

function getIntegrationFlowQueue() {
  if (!singleton) {
    singleton = new IntegrationFlowQueue(resolveConcurrency());
  }
  return singleton;
}

/** @internal test helper */
function resetIntegrationFlowQueueForTests() {
  singleton = null;
}

module.exports = {
  IntegrationFlowQueue,
  getIntegrationFlowQueue,
  resetIntegrationFlowQueueForTests,
  resolveConcurrency,
};
