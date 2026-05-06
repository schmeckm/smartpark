const { asyncHandler } = require('../utils/async-handler');
const { getPlatformSettingsService } = require('../services/platform-settings.service');
const { AuditLogService } = require('../services/audit-log.service');
const AUDIT = require('../constants/audit-actions');
const env = require('../config/env');

const auditLogService = new AuditLogService();

const listPlatformSettings = asyncHandler(async (req, res) => {
  const raw = req.query.category;
  const category = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
  const svc = getPlatformSettingsService();
  const settings = await svc.getSettingsByCategory(category);
  res.json({
    success: true,
    data: {
      settings,
      mqtt: {
        mqttEnabled: env.mqttEnabled,
        mqttBrokerUrl: env.mqttBrokerUrl,
        mqttClientId: env.mqttClientId,
        mqttUsernameConfigured: Boolean(env.mqttUsername),
      },
      general: {
        nodeEnv: env.nodeEnv,
        port: env.port,
        corsOrigin: env.corsOrigin,
      },
    },
  });
});

const patchPlatformSetting = asyncHandler(async (req, res) => {
  const { settingKey, value } = req.validated;
  const svc = getPlatformSettingsService();
  const beforeRows = await svc.getSettingsByCategory(null);
  const prev = beforeRows.find((r) => r.settingKey === settingKey);
  const resolved = await svc.setSetting(settingKey, value);
  await auditLogService.log({
    action: AUDIT.PLATFORM_SETTING_UPDATE,
    entityType: 'platform_setting',
    entityId: null,
    oldValue: prev
      ? {
          settingKey,
          effectiveValue: prev.effectiveValue,
          resolvedSource: prev.resolvedSource,
        }
      : { settingKey, effectiveValue: null, resolvedSource: null },
    newValue: {
      settingKey,
      effectiveValue: resolved.value,
      resolvedSource: resolved.source,
      patchedValue: value,
    },
  });
  res.json({
    success: true,
    data: {
      settingKey,
      effectiveValue: resolved.value,
      resolvedSource: resolved.source,
    },
  });
});

module.exports = {
  listPlatformSettings,
  patchPlatformSetting,
};
