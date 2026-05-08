const { adapterObservationSchema } = require('./adapter-observation.schema');

class AdapterObservationValidatorService {
  validateOne(observation) {
    const { error, value } = adapterObservationSchema.validate(observation, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return { ok: false, errors: error.details.map((d) => ({ path: d.path.join('.'), message: d.message })) };
    }
    return { ok: true, value };
  }

  /**
   * @returns {{ valid: Array, invalid: Array<{ index: number, observation: unknown, errors: Array }> }}
   */
  validateMany(observations) {
    if (!Array.isArray(observations)) {
      return { valid: [], invalid: [{ index: -1, observation: observations, errors: [{ message: 'not_an_array' }] }] };
    }
    const valid = [];
    const invalid = [];
    observations.forEach((obs, index) => {
      const r = this.validateOne(obs);
      if (r.ok) valid.push(r.value);
      else invalid.push({ index, observation: obs, errors: r.errors });
    });
    return { valid, invalid };
  }
}

module.exports = { AdapterObservationValidatorService };
