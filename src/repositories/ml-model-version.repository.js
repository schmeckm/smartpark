const { MlModelVersion } = require('../models');

const BASELINE = {
  modelName: 'baseline-crowd-moving-average',
  modelType: 'BASELINE',
  version: '0.1.0',
};

class MlModelVersionRepository {
  async getOrCreateBaseline() {
    const [row] = await MlModelVersion.findOrCreate({
      where: { modelName: BASELINE.modelName, version: BASELINE.version },
      defaults: {
        modelType: BASELINE.modelType,
        status: 'ACTIVE',
        metrics: { source: 'nodejs-baseline' },
        trainedAt: null,
      },
    });
    return row;
  }
}

module.exports = { MlModelVersionRepository, BASELINE_ML: BASELINE };
