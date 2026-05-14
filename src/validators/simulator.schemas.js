const Joi = require('joi');

const runScenarioSchema = Joi.object({
  name: Joi.string()
    .valid(
      'CROWD_SPIKE_ALPINE',
      'RIDE_CLOSURE_HIGH_IMPACT',
      'RAIN_SHIFT_TO_INDOOR',
      'FOOD_RUSH_LUNCH',
      'PARADE_END_CROWD_SHIFT',
      'SILVER_COMET_LINE'
    )
    .required(),
  parkId: Joi.string().uuid().optional(),
});

module.exports = { runScenarioSchema };
