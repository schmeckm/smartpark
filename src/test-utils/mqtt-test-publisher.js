'use strict';

/**
 * Lightweight MQTT publish helper for UNS Spy / inbound observation tests.
 * Does not start the API MQTT connector — connects with its own client id suffix.
 *
 * @param {{ brokerUrl?: string, username?: string, password?: string, clientId?: string }} [opts]
 * @returns {Promise<{ publish(topic: string, payload: object|string): Promise<void>, end(): void }>}
 */
async function createMqttTestPublisher(opts = {}) {
  const mqtt = require('mqtt');
  const env = require('../config/env');
  const url = opts.brokerUrl || env.mqttBrokerUrl;
  const clientId = `${opts.clientId || env.mqttClientId}-uns-test-${process.pid}`;
  const connOpts = {
    reconnectPeriod: 0,
    connectTimeout: 8000,
    clientId,
  };
  if (opts.username ?? env.mqttUsername) {
    connOpts.username = opts.username ?? env.mqttUsername;
    connOpts.password = opts.password ?? env.mqttPassword;
  }

  const client = mqtt.connect(url, connOpts);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('MQTT connect timeout')), 9000);
    client.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    client.once('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

  return {
    publish(topic, payload) {
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
      return new Promise((resolve, reject) => {
        client.publish(String(topic), body, { qos: 0 }, (err) => (err ? reject(err) : resolve()));
      });
    },
    end() {
      try {
        client.end(true);
      } catch {
        /* */
      }
    },
  };
}

module.exports = { createMqttTestPublisher };
