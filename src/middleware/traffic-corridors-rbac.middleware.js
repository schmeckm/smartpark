'use strict';

const { requireAnyPermission } = require('./rbac.middleware');

/** Read traffic corridors / snapshots / forecasts (legacy `rides.read` still accepted). */
const requireTrafficCorridorsRead = requireAnyPermission(
  ['traffic_corridors', 'read'],
  ['rides', 'read']
);

/** Mutate corridors, manual snapshots, TomTom poll (legacy `rides.update` still accepted). */
const requireTrafficCorridorsUpdate = requireAnyPermission(
  ['traffic_corridors', 'update'],
  ['rides', 'update']
);

module.exports = { requireTrafficCorridorsRead, requireTrafficCorridorsUpdate };
