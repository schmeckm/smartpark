const { AppError } = require('../utils/app-error');

const REQUIRED_BY_TYPE = {
  DESTINATION_SYNCED: ['externalDestinationId'],
  PARK_SYNCED: ['externalParkId'],
  PARK_ENTITY_SYNCED: ['externalParkId', 'externalEntityId'],
  WAIT_TIME_UPDATED: ['externalParkId', 'externalEntityId'],
  ENTITY_STATUS_UPDATED: ['externalParkId', 'externalEntityId'],
  PARK_OPERATING_HOURS_UPDATED: ['externalParkId'],
  PARK_CROWD_LEVEL_UPDATED: ['externalParkId'],
  WEATHER_OBSERVATION_UPDATED: [],
  CALENDAR_CONTEXT_UPDATED: [],
};

class CanonicalMessageValidationService {
  validate(message) {
    if (!message || typeof message !== 'object') {
      throw new AppError('Invalid canonical message shape', 422, { code: 'VALIDATION_ERROR' });
    }
    if (!message.messageType || !REQUIRED_BY_TYPE[message.messageType]) {
      throw new AppError(`Unsupported canonical message type: ${message.messageType}`, 422, {
        code: 'VALIDATION_ERROR',
      });
    }
    if (!message.provider) {
      throw new AppError('provider is required', 422, { code: 'VALIDATION_ERROR' });
    }
    const required = REQUIRED_BY_TYPE[message.messageType];
    const missing = required.filter((k) => !message[k]);
    if (missing.length) {
      throw new AppError('Missing canonical message keys', 422, {
        code: 'VALIDATION_ERROR',
        details: { missing },
      });
    }
    if (!message.payload || typeof message.payload !== 'object') {
      throw new AppError('payload must be an object', 422, { code: 'VALIDATION_ERROR' });
    }

    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (message.messageType === 'WEATHER_OBSERVATION_UPDATED') {
      const pid = message.payload.internalParkId;
      const ext = message.externalParkId != null ? String(message.externalParkId).trim() : '';
      if (!pid && !ext) {
        throw new AppError('weather observation requires externalParkId or payload.internalParkId', 422, {
          code: 'VALIDATION_ERROR',
        });
      }
      if (pid != null && String(pid).trim() !== '' && !uuidLike.test(String(pid))) {
        throw new AppError('payload.internalParkId must be a UUID when set', 422, { code: 'VALIDATION_ERROR' });
      }
    }
    if (message.messageType === 'CALENDAR_CONTEXT_UPDATED') {
      const d = message.payload.contextDate;
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
        throw new AppError('calendar context requires payload.contextDate YYYY-MM-DD', 422, {
          code: 'VALIDATION_ERROR',
        });
      }
      const pid = message.payload.internalParkId;
      const ext = message.externalParkId != null ? String(message.externalParkId).trim() : '';
      if (!pid && !ext) {
        throw new AppError('calendar context requires externalParkId or payload.internalParkId', 422, {
          code: 'VALIDATION_ERROR',
        });
      }
      if (pid != null && String(pid).trim() !== '' && !uuidLike.test(String(pid))) {
        throw new AppError('payload.internalParkId must be a UUID when set', 422, { code: 'VALIDATION_ERROR' });
      }
    }

    return true;
  }
}

module.exports = { CanonicalMessageValidationService };
