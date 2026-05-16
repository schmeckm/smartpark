'use strict';

const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { TrafficProviderConfigService } = require('../services/traffic-provider-config.service');
const { TomTomTrafficProviderError } = require('../services/traffic-attendance/tomtom-traffic.provider');

const trafficProviderConfigService = new TrafficProviderConfigService();

function mapTomTomError(e) {
  if (!(e instanceof TomTomTrafficProviderError)) return null;
  if (e.code === 'TOMTOM_DISABLED') return new AppError('TomTom traffic integration is disabled', 403, { code: 'TOMTOM_DISABLED' });
  if (e.code === 'TOMTOM_API_KEY_MISSING') {
    return new AppError('TomTom API key is not configured', 503, { code: 'TOMTOM_API_KEY_MISSING' });
  }
  if (e.code === 'INVALID_COORDS') return new AppError(e.message, 422, { code: 'INVALID_COORDS' });
  return null;
}

const listTrafficProviders = asyncHandler(async (_req, res) => {
  const data = await trafficProviderConfigService.listMasked();
  res.json({ success: true, data });
});

const putTomTomTrafficProvider = asyncHandler(async (req, res) => {
  const userId = req.user?.id || null;
  const body = req.validated || req.body;
  const data = await trafficProviderConfigService.upsertTomTom(body, userId);
  res.json({ success: true, data });
});

const postTomTomTrafficProviderTest = asyncHandler(async (req, res) => {
  try {
    const data = await trafficProviderConfigService.testTomTomConnection(req.validated || {});
    res.json({ success: true, data });
  } catch (e) {
    const mapped = mapTomTomError(e);
    if (mapped) throw mapped;
    throw e;
  }
});

module.exports = {
  listTrafficProviders,
  putTomTomTrafficProvider,
  postTomTomTrafficProviderTest,
};
