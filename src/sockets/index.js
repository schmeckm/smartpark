const { Server } = require('socket.io');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { verifyAccessToken } = require('../utils/jwt.util');

let io;

function parseOrigins(value) {
  if (!value || value === '*') return true;
  return value.split(',').map((s) => s.trim());
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: parseOrigins(env.corsOrigin),
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket, next) => {
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
      socket.data.userId = payload.sub;
      socket.data.roles = Array.isArray(payload.roles) ? payload.roles : [];
      return next();
    } catch (e) {
      logger.warn({ err: e.message }, 'socket auth failed');
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, 'socket connected');
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
    getIO().emit('zones:updated', { zone: zone.toJSON ? zone.toJSON() : zone });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit zones:updated skipped');
  }
}

function emitCrowdEventCreated(event) {
  try {
    getIO().emit('events:created', { event: event.toJSON ? event.toJSON() : event });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit events:created skipped');
  }
}

function emitRecommendationCreated(recommendation) {
  try {
    getIO().emit('recommendations:created', {
      recommendation: recommendation.toJSON ? recommendation.toJSON() : recommendation,
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit recommendations:created skipped');
  }
}

function emitRecommendationUpdated(recommendation) {
  try {
    getIO().emit('recommendations:updated', {
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
    getIO().emit('weather:updated', { observation: observation.toJSON ? observation.toJSON() : observation });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit weather:updated skipped');
  }
}

function emitIngestionEvent(payload) {
  try {
    getIO().emit('integration:ingested', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit integration:ingested skipped');
  }
}

function emitSimulatorTick(payload) {
  try {
    getIO().emit('simulator:tick', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit simulator:tick skipped');
  }
}

function emitDataQualityNew(issue) {
  try {
    getIO().emit('dataquality:new', { issue: issue.toJSON ? issue.toJSON() : issue });
  } catch (e) {
    logger.warn({ err: e.message }, 'emit dataquality:new skipped');
  }
}

function emitAiForecastUpdated(payload) {
  try {
    getIO().emit('ai:forecast:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit ai:forecast:updated skipped');
  }
}

function emitAiRecommendationScored(payload) {
  try {
    getIO().emit('ai:recommendation-scored', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit ai:recommendation-scored skipped');
  }
}

function emitCanonicalMessageReceived(payload) {
  try {
    getIO().emit('canonical:message:received', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit canonical:message:received skipped');
  }
}

function emitCanonicalMessageApplied(payload) {
  try {
    getIO().emit('canonical:message:applied', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit canonical:message:applied skipped');
  }
}

function emitCanonicalMessageFailed(payload) {
  try {
    getIO().emit('canonical:message:failed', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit canonical:message:failed skipped');
  }
}

function emitExternalMappingUpdated(payload) {
  try {
    getIO().emit('external:mapping:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit external:mapping:updated skipped');
  }
}

function emitExternalParkDataUpdated(payload) {
  try {
    getIO().emit('external:parkdata:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit external:parkdata:updated skipped');
  }
}

function emitUnsStateUpdated(payload) {
  try {
    getIO().emit('uns:state:updated', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit uns:state:updated skipped');
  }
}

/** Flattened Sparkplug MQTT rows (from broker subscriber) for UNS Live. */
function emitUnsMqttLiveEvents(payload) {
  try {
    getIO().emit('uns:mqtt:live:events', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit uns:mqtt:live:events skipped');
  }
}

/** Attraction OEE simulator: queue overcapacity vs ride master limits (real-time toast in admin). */
function emitSimulatorOeeQueueAlert(payload) {
  try {
    getIO().emit('simulator:oee:queue-alert', payload);
  } catch (e) {
    logger.warn({ err: e.message }, 'emit simulator:oee:queue-alert skipped');
  }
}

module.exports = {
  initSocket,
  getIO,
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
