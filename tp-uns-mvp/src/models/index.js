const { sequelize } = require('../db/sequelize');
const { definePark } = require('./park.model');
const { defineUnsNode } = require('./uns-node.model');
const { defineDevice } = require('./device.model');
const { defineCanonicalEvent } = require('./canonical-event.model');
const { defineLatestState } = require('./latest-state.model');
const { defineForecastSnapshot } = require('./forecast-snapshot.model');

const Park = definePark(sequelize);
const UnsNode = defineUnsNode(sequelize);
const Device = defineDevice(sequelize);
const CanonicalEvent = defineCanonicalEvent(sequelize);
const LatestState = defineLatestState(sequelize);
const ForecastSnapshot = defineForecastSnapshot(sequelize);

Park.hasMany(UnsNode, { foreignKey: 'parkId', as: 'nodes' });
UnsNode.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
UnsNode.belongsTo(UnsNode, { foreignKey: 'parentId', as: 'parent' });
UnsNode.hasMany(UnsNode, { foreignKey: 'parentId', as: 'children' });

Park.hasMany(Device, { foreignKey: 'parkId', as: 'devices' });
Device.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
Device.belongsTo(UnsNode, { foreignKey: 'assignedNodeId', as: 'assignedNode' });

Park.hasMany(CanonicalEvent, { foreignKey: 'parkId', as: 'events' });
CanonicalEvent.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(LatestState, { foreignKey: 'parkId', as: 'latestStates' });
LatestState.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(ForecastSnapshot, { foreignKey: 'parkId', as: 'forecastSnapshots' });
ForecastSnapshot.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

module.exports = {
  sequelize,
  Park,
  UnsNode,
  Device,
  CanonicalEvent,
  LatestState,
  ForecastSnapshot,
};
