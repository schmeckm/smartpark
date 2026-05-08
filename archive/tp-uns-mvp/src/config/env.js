const dotenv = require('dotenv');

dotenv.config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/tpuns',
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttTopicSubscribe: process.env.MQTT_TOPIC_SUBSCRIBE || 'tpuns/+/v1/#',
  mqttClientId: process.env.MQTT_CLIENT_ID || 'tpuns-backend',
  swaggerEnabled: String(process.env.SWAGGER_ENABLED || 'true') !== 'false',
};
