const express = require('express');
const { getMqttClient, validatePayload } = require('../mqtt/mqtt-subscriber.service');
const { validateTopicPath } = require('../services/uns-topic-generator.service');
const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');

const router = express.Router();

router.post(
  '/publish',
  asyncHandler(async (req, res) => {
    const { topic, payload } = req.body || {};
    if (!validateTopicPath(topic)) throw new AppError('Invalid topic path', 422);
    validatePayload(payload);
    const client = getMqttClient();
    if (!client) throw new AppError('MQTT client not connected', 503);
    await new Promise((resolve, reject) => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
    res.json({ success: true, data: { published: true, topic } });
  })
);

module.exports = { mqttRouter: router };
