const { asyncHandler } = require('../utils/async-handler');
const { AppError } = require('../utils/app-error');
const { UserRepository } = require('../repositories/user.repository');
const { AuthService } = require('../services/auth.service');
const { UserAdminService } = require('../services/user-admin.service');

const userRepository = new UserRepository();
const authService = new AuthService();
const userAdminService = new UserAdminService();

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

const listUsers = asyncHandler(async (req, res) => {
  const users = await userAdminService.listUsers();
  res.json({ success: true, data: users });
});

const createUser = asyncHandler(async (req, res) => {
  const user = await userAdminService.createUser(req.validated, req.user.id);
  res.status(201).json({ success: true, data: user });
});

const updateUser = asyncHandler(async (req, res) => {
  const { id, ...body } = req.validated;
  const user = await userAdminService.updateUser(id, body, req.user.id);
  res.json({ success: true, data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  await userAdminService.deleteUser(req.validated.id, req.user.id);
  res.status(204).send();
});

module.exports = {
  getMySettings,
  patchMySettings,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};
