const { asyncHandler } = require('../utils/async-handler');
const { AuthService } = require('../services/auth.service');

const authService = new AuthService();

const login = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const result = await authService.login(body.email, body.password);
  res.json({ success: true, data: result });
});

const refresh = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  const result = await authService.refresh(body.refreshToken);
  res.json({ success: true, data: result });
});

const logout = asyncHandler(async (req, res) => {
  const body = req.validated || req.body;
  await authService.logout(body.refreshToken, req.user.id);
  res.json({ success: true, data: { loggedOut: true } });
});

const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: authService.toPublicUser(req.user) });
});

module.exports = { login, refresh, logout, me };
