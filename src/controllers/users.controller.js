const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { UserRepository } = require('../repositories/user.repository');
const { AuthService } = require('../services/auth.service');

const userRepository = new UserRepository();
const authService = new AuthService();

function settingsPayload(user) {
  const u = authService.toPublicUser(user);
  const prefs = u.uiPreferences && typeof u.uiPreferences === 'object' && !Array.isArray(u.uiPreferences) ? u.uiPreferences : {};
  return {
    languageCode: u.languageCode,
    displayName: u.displayName ?? null,
    timezone: u.timezone ?? null,
    dateFormat: u.dateFormat,
    timeFormat: u.timeFormat,
    locale: u.locale ?? null,
    uiPreferences: prefs,
  };
}

const getMySettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: settingsPayload(req.user) });
});

const patchMySettings = asyncHandler(async (req, res) => {
  const body = req.validated;
  const user = await userRepository.updateSettings(req.user.id, {
    languageCode: body.languageCode,
    displayName: body.displayName,
    timezone: body.timezone,
    dateFormat: body.dateFormat,
    timeFormat: body.timeFormat,
    locale: body.locale,
    uiPreferences: body.uiPreferences,
  });
  if (!user) {
    throw new AppError('User not found', 404, { code: 'NOT_FOUND' });
  }
  const reloaded = await userRepository.findById(user.id);
  res.json({ success: true, data: authService.toPublicUser(reloaded) });
});

module.exports = { getMySettings, patchMySettings };
