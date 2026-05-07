const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

const spec = YAML.load(path.resolve(__dirname, 'openapi.yaml'));

function registerSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
}

module.exports = { registerSwagger };
