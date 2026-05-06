const { Model, DataTypes } = require('sequelize');

class MdmPark extends Model {}
class MdmParkZone extends Model {}
class MdmRideType extends Model {}
class MdmRideTemplate extends Model {}
class MdmRide extends Model {}
class MdmRideOperations extends Model {}
class MdmRideCapacity extends Model {}
class MdmRideStaffing extends Model {}
class MdmRideSafety extends Model {}
class MdmRideGuestRules extends Model {}
class MdmRideIntegration extends Model {}
class MdmRideKpiTargets extends Model {}
class MdmRideStaffRole extends Model {}
class MdmRideDocument extends Model {}
class MdmRideStatusHistory extends Model {}

/**
 * @param {import('sequelize').Sequelize} sequelize
 * @param {{ Ride?: import('sequelize').Model; User?: import('sequelize').Model }} refs
 */
function defineMdmModels(sequelize, refs = {}) {
  const { Ride, User } = refs;

  MdmPark.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      timezone: { type: DataTypes.STRING(64), allowNull: true },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      futureHints: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'future_hints' },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmPark', tableName: 'mdm_parks', underscored: true }
  );

  MdmParkZone.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      code: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(200), allowNull: false },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
      legacyZoneId: { type: DataTypes.UUID, allowNull: true, field: 'legacy_zone_id' },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmParkZone', tableName: 'mdm_park_zones', underscored: true }
  );

  MdmRideType.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmRideType', tableName: 'mdm_ride_types', underscored: true }
  );

  MdmRideTemplate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      rideTypeId: { type: DataTypes.UUID, allowNull: false, field: 'ride_type_id' },
      code: { type: DataTypes.STRING(64), allowNull: false },
      displayName: { type: DataTypes.STRING(160), allowNull: false, field: 'display_name' },
      defaultProfile: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'default_profile' },
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_system' },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmRideTemplate', tableName: 'mdm_ride_templates', underscored: true }
  );

  MdmRide.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      parkZoneId: { type: DataTypes.UUID, allowNull: false, field: 'park_zone_id' },
      rideTypeId: { type: DataTypes.UUID, allowNull: false, field: 'ride_type_id' },
      internalRideId: { type: DataTypes.UUID, allowNull: true, unique: true, field: 'internal_ride_id' },
      externalId: { type: DataTypes.STRING(255), allowNull: true, field: 'external_id' },
      name: { type: DataTypes.STRING(200), allowNull: false },
      shortName: { type: DataTypes.STRING(80), allowNull: true, field: 'short_name' },
      description: { type: DataTypes.TEXT, allowNull: true },
      manufacturer: { type: DataTypes.STRING(160), allowNull: true },
      model: { type: DataTypes.STRING(120), allowNull: true },
      buildYear: { type: DataTypes.SMALLINT, allowNull: true, field: 'build_year' },
      commissioningDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'commissioning_date' },
      lifecycleStatus: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'ACTIVE', field: 'lifecycle_status' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      /** Phase B: same shape as ParkAsset master_profile.unsAssetExtensions (signal hints only; not a registry). */
      extensions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'extensions' },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmRide', tableName: 'mdm_rides', underscored: true }
  );

  const extInit = (ModelClass, tableName, fields) => {
    ModelClass.init(
      {
        rideId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'ride_id' },
        ...fields,
        createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
        updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
      },
      { sequelize, modelName: ModelClass.name, tableName, underscored: true }
    );
  };

  extInit(MdmRideOperations, 'mdm_ride_operations', {
    plannedOpeningTime: { type: DataTypes.TIME, allowNull: true, field: 'planned_opening_time' },
    plannedClosingTime: { type: DataTypes.TIME, allowNull: true, field: 'planned_closing_time' },
    seasonalFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'seasonal_flag' },
    weatherSensitiveFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'weather_sensitive_flag' },
    windLimitKmh: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'wind_limit_kmh' },
    minTemperatureC: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'min_temperature_c' },
    maxTemperatureC: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'max_temperature_c' },
    nightOperationFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'night_operation_flag' },
  });

  extInit(MdmRideCapacity, 'mdm_ride_capacity', {
    seatsPerCycle: { type: DataTypes.INTEGER, allowNull: true, field: 'seats_per_cycle' },
    trainsCount: { type: DataTypes.INTEGER, allowNull: true, field: 'trains_count' },
    dispatchIntervalSec: { type: DataTypes.INTEGER, allowNull: true, field: 'dispatch_interval_sec' },
    theoreticalCapacityPph: { type: DataTypes.INTEGER, allowNull: true, field: 'theoretical_capacity_pph' },
    reducedCapacityPph: { type: DataTypes.INTEGER, allowNull: true, field: 'reduced_capacity_pph' },
    wheelchairCapacity: { type: DataTypes.INTEGER, allowNull: true, field: 'wheelchair_capacity' },
    singleRiderFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'single_rider_flag' },
  });

  extInit(MdmRideStaffing, 'mdm_ride_staffing', {
    minimumStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'minimum_staff' },
    standardStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'standard_staff' },
    peakStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'peak_staff' },
    requiredRolesJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'required_roles_json' },
    trainingLevel: { type: DataTypes.STRING(64), allowNull: true, field: 'training_level' },
  });

  extInit(MdmRideSafety, 'mdm_ride_safety', {
    safetyClass: { type: DataTypes.STRING(64), allowNull: true, field: 'safety_class' },
    lastInspectionDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'last_inspection_date' },
    nextInspectionDue: { type: DataTypes.DATEONLY, allowNull: true, field: 'next_inspection_due' },
    maintenanceStrategy: { type: DataTypes.STRING(120), allowNull: true, field: 'maintenance_strategy' },
    emergencySopCode: { type: DataTypes.STRING(80), allowNull: true, field: 'emergency_sop_code' },
  });

  extInit(MdmRideGuestRules, 'mdm_ride_guest_rules', {
    minHeightCm: { type: DataTypes.INTEGER, allowNull: true, field: 'min_height_cm' },
    maxHeightCm: { type: DataTypes.INTEGER, allowNull: true, field: 'max_height_cm' },
    ageRestriction: { type: DataTypes.STRING(120), allowNull: true, field: 'age_restriction' },
    fastpassEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'fastpass_enabled' },
    familyFriendlyFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'family_friendly_flag' },
    thrillLevel: { type: DataTypes.SMALLINT, allowNull: true, field: 'thrill_level' },
  });

  extInit(MdmRideIntegration, 'mdm_ride_integration', {
    plcType: { type: DataTypes.STRING(64), allowNull: true, field: 'plc_type' },
    opcuaEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'opcua_enabled' },
    mqttTopicBase: { type: DataTypes.STRING(500), allowNull: true, field: 'mqtt_topic_base' },
    cameraEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'camera_enabled' },
    queueSensorType: { type: DataTypes.STRING(80), allowNull: true, field: 'queue_sensor_type' },
    healthTopic: { type: DataTypes.STRING(500), allowNull: true, field: 'health_topic' },
  });

  extInit(MdmRideKpiTargets, 'mdm_ride_kpi_targets', {
    targetAvailabilityPct: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'target_availability_pct' },
    targetOeePct: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'target_oee_pct' },
    targetWaitTimeMin: { type: DataTypes.INTEGER, allowNull: true, field: 'target_wait_time_min' },
    revenuePriority: { type: DataTypes.SMALLINT, allowNull: true, field: 'revenue_priority' },
    forecastCluster: { type: DataTypes.STRING(64), allowNull: true, field: 'forecast_cluster' },
  });

  MdmRideStaffRole.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      rideId: { type: DataTypes.UUID, allowNull: false, field: 'ride_id' },
      roleCode: { type: DataTypes.STRING(64), allowNull: false, field: 'role_code' },
      headcountStandard: { type: DataTypes.INTEGER, allowNull: true, field: 'headcount_standard' },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmRideStaffRole', tableName: 'mdm_ride_staff_roles', underscored: true }
  );

  MdmRideDocument.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      rideId: { type: DataTypes.UUID, allowNull: false, field: 'ride_id' },
      docType: { type: DataTypes.STRING(64), allowNull: false, field: 'doc_type' },
      title: { type: DataTypes.STRING(240), allowNull: false },
      storageUri: { type: DataTypes.TEXT, allowNull: true, field: 'storage_uri' },
      mimeType: { type: DataTypes.STRING(120), allowNull: true, field: 'mime_type' },
      checksum: { type: DataTypes.STRING(128), allowNull: true },
      validFrom: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_from' },
      validTo: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_to' },
      createdBy: { type: DataTypes.UUID, allowNull: true, field: 'created_by' },
      updatedBy: { type: DataTypes.UUID, allowNull: true, field: 'updated_by' },
    },
    { sequelize, modelName: 'MdmRideDocument', tableName: 'mdm_ride_documents', underscored: true }
  );

  MdmRideStatusHistory.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      rideId: { type: DataTypes.UUID, allowNull: false, field: 'ride_id' },
      fromStatus: { type: DataTypes.STRING(32), allowNull: true, field: 'from_status' },
      toStatus: { type: DataTypes.STRING(32), allowNull: false, field: 'to_status' },
      reason: { type: DataTypes.TEXT, allowNull: true },
      changedAt: { type: DataTypes.DATE, allowNull: false, field: 'changed_at' },
      changedBy: { type: DataTypes.UUID, allowNull: true, field: 'changed_by' },
    },
    { sequelize, modelName: 'MdmRideStatusHistory', tableName: 'mdm_ride_status_history', underscored: true, timestamps: false }
  );

  MdmPark.hasMany(MdmParkZone, { foreignKey: 'parkId', as: 'zones' });
  MdmParkZone.belongsTo(MdmPark, { foreignKey: 'parkId', as: 'park' });

  MdmRideType.hasMany(MdmRideTemplate, { foreignKey: 'rideTypeId', as: 'templates' });
  MdmRideTemplate.belongsTo(MdmRideType, { foreignKey: 'rideTypeId', as: 'rideType' });

  MdmPark.hasMany(MdmRide, { foreignKey: 'parkId', as: 'rides' });
  MdmParkZone.hasMany(MdmRide, { foreignKey: 'parkZoneId', as: 'rides' });
  MdmRideType.hasMany(MdmRide, { foreignKey: 'rideTypeId', as: 'rides' });

  MdmRide.belongsTo(MdmPark, { foreignKey: 'parkId', as: 'park' });
  MdmRide.belongsTo(MdmParkZone, { foreignKey: 'parkZoneId', as: 'parkZone' });
  MdmRide.belongsTo(MdmRideType, { foreignKey: 'rideTypeId', as: 'rideType' });

  if (Ride) {
    MdmRide.belongsTo(Ride, { foreignKey: 'internalRideId', as: 'internalRide' });
    Ride.hasOne(MdmRide, { foreignKey: 'internalRideId', as: 'mdmProfile' });
  }

  const oneToOne = (Ext, name) => {
    MdmRide.hasOne(Ext, { foreignKey: 'rideId', as: name });
    Ext.belongsTo(MdmRide, { foreignKey: 'rideId', as: 'ride' });
  };
  oneToOne(MdmRideOperations, 'operations');
  oneToOne(MdmRideCapacity, 'capacity');
  oneToOne(MdmRideStaffing, 'staffing');
  oneToOne(MdmRideSafety, 'safety');
  oneToOne(MdmRideGuestRules, 'guestRules');
  oneToOne(MdmRideIntegration, 'integration');
  oneToOne(MdmRideKpiTargets, 'kpiTargets');

  MdmRide.hasMany(MdmRideStaffRole, { foreignKey: 'rideId', as: 'staffRoles' });
  MdmRideStaffRole.belongsTo(MdmRide, { foreignKey: 'rideId', as: 'ride' });

  MdmRide.hasMany(MdmRideDocument, { foreignKey: 'rideId', as: 'documents' });
  MdmRideDocument.belongsTo(MdmRide, { foreignKey: 'rideId', as: 'ride' });

  MdmRide.hasMany(MdmRideStatusHistory, { foreignKey: 'rideId', as: 'statusHistory' });
  MdmRideStatusHistory.belongsTo(MdmRide, { foreignKey: 'rideId', as: 'ride' });

  if (User) {
    MdmPark.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser', constraints: false });
    MdmPark.belongsTo(User, { foreignKey: 'updatedBy', as: 'updatedByUser', constraints: false });
  }

  return {
    MdmPark,
    MdmParkZone,
    MdmRideType,
    MdmRideTemplate,
    MdmRide,
    MdmRideOperations,
    MdmRideCapacity,
    MdmRideStaffing,
    MdmRideSafety,
    MdmRideGuestRules,
    MdmRideIntegration,
    MdmRideKpiTargets,
    MdmRideStaffRole,
    MdmRideDocument,
    MdmRideStatusHistory,
  };
}

module.exports = { defineMdmModels };
