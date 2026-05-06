const Joi = require('joi');

const statuses = ['OPEN', 'ACCEPTED', 'REJECTED', 'COMPLETED'];

const updateRecommendationStatusSchema = Joi.object({
  status: Joi.string().valid(...statuses).required(),
});

module.exports = { updateRecommendationStatusSchema };
