const { Server } = require('socket.io');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { verifyAccessToken } = require('../utils/jwt.util');
const { User, UserRole } = require('../models');
const { resolveUserRoleCodes } = require('../constants/role-codes');
const { userCanAccessPark } = require('../services/user-park-access.service');

let io;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOrigins(value) {
  if (!value || value === '*') return true;
  return value.split(',').map((s) => s.trim());
}

function parkRoom(parkId) {
  return `park:${parkId}`;
}

/**
 * Extract internal park UUID from common socket payload shapes.
 * @param {unknown} payload
 * @returns {string | null}
 */
function resolveParkIdFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const p = /** @type {Record<string, unknown>} */ (payload);
  const direct = p.parkId ?? p.internalParkId ?? p.park_id;
  if (direct != null && UUID_RE.test(String(direct))) return String(direct);
  const zone = p.zone;
  if (zone && typeof zone === 'object') {
    const zid = /** @type {Record<string, unknown>} */ (zone).parkId;
    if (zid != null && UUID_RE.test(String(zid))) return String(zid);
  }
  const event = p.event;
  if (event && typeof event === 'object') {
    const eid = /** @type {Record<string, unknown>} */ (event).parkId;
    if (eid != null && UUID_RE.test(String(eid))) return String(eid);
  }
  const message = p.message;
  if (message && typeof message === 'object') {
    const mid = /** @type {Record<string, unknown>} */ (message).parkId;
    if (mid != null && UUID_RE.test(String(mid))) return String(mid);
  }
  if (Array.isArray(p.events) && p.events[0] && typeof p.events[0] === 'object') {
    const e0 = /** @type {Record<string, unknown>} */ (p.events[0]);
    if (e0.parkId != null && UUID_RE.test(String(e0.parkId))) return String(e0.parkId);
  }
  return null;
}

/**
 * Park-scoped broadcast when parkId is known; otherwise legacy global emit (ops-wide events).
 * @param {string} event
 * @param {unknown} payload
 */
function broadcast(event, payload) {
  const pid = resolveParkIdFromPayload(payload);
  if (pid) {
    getIO().to(parkRoom(pid)).emit(event, payload);
    return;
  }
  getIO().emit(event, payload);
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: parseOrigins(env.corsOrigin),
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        (typeof socket.handshake.headers?.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '').trim()
          : '');
      if (!raw) {
        return next(new Error('Unauthorized'));
      }
      const payload = verifyAccessToken(raw);
      if (payload.type !== 'access') {
        return next(new Error('Unauthorized'));
      }
      const user = await User.findByPk(payload.sub, {
        include: [{ model: UserRole, as: 'userRoles', required: false }],
      });
      if (!user || !user.active) {
        return next(new Error('Unauthorized'));
      }
      socket.data.userId = user.id;
      socket.data.user = user;
      socket.data.roles = resolveUserRoleCodes(user);
      socket.data.subscribedParkId = null;
      return next();
    } catch (e) {
      logger.warn({ err: e.message }, 'socket auth failed');
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, 'socket connected');

    socket.on('park:subscribe', async (raw, ack) => {
      try {
        const parkId =
          raw && typeof raw === 'object' && raw.parkId != null ? String(raw.parkId).trim() : '';
        if (!UUID_RE.test(parkId)) {
          const err = { code: 'INVALID_PARK_ID', message: 'Invalid parkId' };
          if (typeof ack === 'function') ack(err);
          return;
        }
        const allowed = await userCanAccessPark(socket.data.user, parkId);
        if (!allowed) {
          const err = { code: 'PARK_ACCESS_DENIED', message: 'Park not assigned to this user' };
          if (typeof ack === 'function') ack(err);
          return;
        }
        if (socket.data.subscribedParkId) {
          socket.leave(parkRoom(socket.data.subscribedParkId));
        }
        socket.join(parkRoom(parkId));
        socket.data.subscribedParkId = parkId;
        if (typeof ack === 'function') ack({ ok: true, parkId });
      } catch (e) {
        logger.warn({ err: e.message, userId: socket.data.userId }, 'park:subscribe failed');
        if (typeof ack === 'function') ack({ code: 'SUBSCRIBE_FAILED', message: 'Subscribe failed' });
      }
    });

    const handshakePark =
      socket.handshake.auth?.parkId != null ? String(socket.handshake.auth.parkId).trim() : '';
    if (UUID_RE.test(handshakePark)) {
      void (async () => {
        try {
          if (!(await userCanAccessPark(socket.data.user, handshakePark))) return;
          socket.join(parkRoom(handshakePark));
          socket.data.subscribedParkId = handshakePark;
        } catch (e) {
          logger.warn({ err: e.message }, 'handshake park subscribe failed');
        }
      })();
    }

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'socket disconnected');
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }
  return io;
}

function emitZoneUpdated(zone) {
  try {
    broadcast('zones:updated', { zone: zone.toJSON ? zone.toJSON() : zone });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit zones:updated skipped');
  }
}

function emitCrowdEventCreated(event) {
  try {
    const plain = event.toJSON ? event.toJSON() : event;
    broadcast('events:created', { event: plain, parkId: plain.parkId ?? null });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit events:created skipped');
  }
}

function emitRecommendationCreated(recommendation) {
  try {
    broadcast('recommendations:created', {
      recommendation: recommendation.toJSON ? recommendation.toJSON() : recommendation,
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit recommendations:created skipped');
  }
}

function emitRecommendationUpdated(recommendation) {
  try {
    broadcast('recommendations:updated', {
      recommendation: recommendation.toJSON ? recommendation.toJSON() : recommendation,
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit recommendations:updated skipped');
  }
}

function emitMqttStatus(payload) {
  try {
    getIO().emit('mqtt:status', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit mqtt:status skipped');
  }
}

function emitWeatherUpdated(observation) {
  try {
    const plain = observation.toJSON ? observation.toJSON() : observation;
    broadcast('weather:updated', {
      observation: plain,
      parkId: plain.parkId ?? null,
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit weather:updated skipped');
  }
}

function emitIngestionEvent(payload) {
  try {
    broadcast('integration:ingested', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit integration:ingested skipped');
  }
}

function emitSimulatorTick(payload) {
  try {
    broadcast('simulator:tick', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit simulator:tick skipped');
  }
}

function emitDataQualityNew(issue) {
  try {
    broadcast('dataquality:new', { issue: issue.toJSON ? issue.toJSON() : issue });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit dataquality:new skipped');
  }
}

function emitAiForecastUpdated(payload) {
  try {
    broadcast('ai:forecast:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit ai:forecast:updated skipped');
  }
}

function emitAiRecommendationScored(payload) {
  try {
    broadcast('ai:recommendation-scored', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit ai:recommendation-scored skipped');
  }
}

function emitCanonicalMessageReceived(payload) {
  try {
    broadcast('canonical:message:received', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit canonical:message:received skipped');
  }
}

function emitCanonicalMessageApplied(payload) {
  try {
    broadcast('canonical:message:applied', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit canonical:message:applied skipped');
  }
}

function emitCanonicalMessageFailed(payload) {
  try {
    broadcast('canonical:message:failed', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit canonical:message:failed skipped');
  }
}

function emitExternalMappingUpdated(payload) {
  try {
    broadcast('external:mapping:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit external:mapping:updated skipped');
  }
}

function emitExternalParkDataUpdated(payload) {
  try {
    broadcast('external:parkdata:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit external:parkdata:updated skipped');
  }
}

function emitUnsStateUpdated(payload) {
  try {
    broadcast('uns:state:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit uns:state:updated skipped');
  }
}

function emitUnsMqttLiveEvents(payload) {
  try {
    broadcast('uns:mqtt:live:events', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit uns:mqtt:live:events skipped');
  }
}

function emitSimulatorOeeQueueAlert(payload) {
  try {
    broadcast('simulator:oee:queue-alert', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit simulator:oee:queue-alert skipped');
  }
}

module.exports = {
  initSocket,
  getIO,
  parkRoom,
  resolveParkIdFromPayload,
  emitZoneUpdated,
  emitCrowdEventCreated,
  emitRecommendationCreated,
  emitRecommendationUpdated,
  emitMqttStatus,
  emitWeatherUpdated,
  emitIngestionEvent,
  emitSimulatorTick,
  emitDataQualityNew,
  emitAiForecastUpdated,
  emitAiRecommendationScored,
  emitCanonicalMessageReceived,
  emitCanonicalMessageApplied,
  emitCanonicalMessageFailed,
  emitExternalMappingUpdated,
  emitExternalParkDataUpdated,
  emitUnsStateUpdated,
  emitUnsMqttLiveEvents,
  emitSimulatorOeeQueueAlert,
};
