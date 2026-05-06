const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  password: Joi.string().required().min(8).max(128),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required().min(32).max(512),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().min(32).max(512).optional(),
});

module.exports = { loginSchema, refreshSchema, logoutSchema };
