'use strict';

const Joi = require('joi');

const idParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const widgetConfigSchema = Joi.object().unknown(true);

const widgetInstanceCreateBody = Joi.object({
  widgetKey: Joi.string().min(1).max(128).required(),
  title: Joi.string().max(255).allow(null, ''),
  description: Joi.string().allow(null, ''),
  widgetConfig: widgetConfigSchema.default({}),
  dataSourceKey: Joi.string().max(128).allow(null, ''),
  enabled: Joi.boolean(),
});

const widgetInstancePatchBody = Joi.object({
  widgetKey: Joi.string().min(1).max(128),
  title: Joi.string().max(255).allow(null, ''),
  description: Joi.string().allow(null, ''),
  widgetConfig: widgetConfigSchema,
  dataSourceKey: Joi.string().max(128).allow(null, ''),
  enabled: Joi.boolean(),
}).min(1);

const listInstancesQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(200),
  offset: Joi.number().integer().min(0),
});

const widgetInstancePatchMerged = Joi.object({
  id: Joi.string().uuid().required(),
  widgetKey: Joi.string().min(1).max(128),
  title: Joi.string().max(255).allow(null, ''),
  description: Joi.string().allow(null, ''),
  widgetConfig: widgetConfigSchema,
  dataSourceKey: Joi.string().max(128).allow(null, ''),
  enabled: Joi.boolean(),
}).min(2);

module.exports = {
  idParamsSchema,
  widgetInstanceCreateBody,
  widgetInstancePatchBody,
  widgetInstancePatchMerged,
  listInstancesQuerySchema,
};
