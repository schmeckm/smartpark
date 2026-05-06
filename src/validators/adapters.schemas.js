const Joi = require('joi');

const adapterOpsKeyParamsSchema = Joi.object({
  adapterKey: Joi.string().trim().max(120).pattern(/^[a-z0-9_-]+$/i).required(),
});

const adapterRunsQuerySchema = Joi.object({
  adapterKey: Joi.string().trim().max(120).pattern(/^[a-z0-9_-]*$/i).allow(''),
  limit: Joi.number().integer().min(1).max(500).default(100),
});

module.exports = {
  adapterOpsKeyParamsSchema,
  adapterRunsQuerySchema,
};
