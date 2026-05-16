'use strict';

const fs = require('node:fs');

/**
 * True when the Node process runs inside a Linux container (e.g. docker compose `api` service).
 * Used only for fallbacks when env vars are unset — explicit DB_HOST / MQTT_BROKER_URL / INFLUX_URL always win.
 */
function isRunningInDocker() {
  if (process.env.SMART_PARK_FORCE_DOCKER_DEFAULTS === '1') return true;
  if (process.env.SMART_PARK_FORCE_DOCKER_DEFAULTS === '0') return false;
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

/** Default Postgres host when DB_HOST is unset. */
function defaultDbHost() {
  return isRunningInDocker() ? 'db' : '127.0.0.1';
}

/** Default MQTT broker URL when MQTT_BROKER_URL is unset. */
function defaultMqttBrokerUrl() {
  return isRunningInDocker() ? 'mqtt://mqtt:1883' : 'mqtt://127.0.0.1:1883';
}

/** Default InfluxDB base URL when INFLUX_URL is unset (empty string when not applicable). */
function defaultInfluxUrl() {
  return isRunningInDocker() ? 'http://influxdb:8086' : 'http://127.0.0.1:8086';
}

module.exports = {
  isRunningInDocker,
  defaultDbHost,
  defaultMqttBrokerUrl,
  defaultInfluxUrl,
};
