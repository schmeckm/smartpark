const { Model, DataTypes } = require('sequelize');

class AssetType extends Model {}
class EntityTypeTemplate extends Model {}
class Park extends Model {}
class ParkZone extends Model {}
class ParkAsset extends Model {}
class RideMasterData extends Model {}
class ShowMasterData extends Model {}
class RestaurantMasterData extends Model {}
class ShopMasterData extends Model {}
class RideTemplate extends Model {}
class StaffingTemplate extends Model {}
class MaintenanceTemplate extends Model {}
class AssetObservation extends Model {}
class AssetTarget extends Model {}
class AssetRuntimeOverride extends Model {}
class AssetDowntimeEvent extends Model {}
class ShiftHandoverEntry extends Model {}

/**
 * @param {import('sequelize').Sequelize} sequelize
 */
function definePlatformModels(sequelize) {
  AssetType.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
    },
    { sequelize, modelName: 'AssetType', tableName: 'asset_types', underscored: true }
  );

  EntityTypeTemplate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      entityType: { type: DataTypes.STRING(32), allowNull: false, field: 'entity_type' },
      templateCode: { type: DataTypes.STRING(64), allowNull: false, field: 'template_code' },
      templateName: { type: DataTypes.STRING(200), allowNull: false, field: 'template_name' },
      description: { type: DataTypes.TEXT, allowNull: true },
      defaultValuesJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'default_values_json' },
      requiredFieldsJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'required_fields_json' },
      calculatedFieldsJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'calculated_fields_json' },
      validationRulesJson: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'validation_rules_json' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
    },
    {
      sequelize,
      modelName: 'EntityTypeTemplate',
      tableName: 'entity_type_templates',
      underscored: true,
      timestamps: true,
    }
  );

  Park.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      slug: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      timezone: { type: DataTypes.STRING(64), allowNull: true },
      externalSource: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'THEMEPARKS_WIKI', field: 'external_source' },
      externalEntityId: { type: DataTypes.STRING(64), allowNull: true, field: 'external_entity_id' },
      providerSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'provider_snapshot' },
      enrichment: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'enrichment' },
      syncManaged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'sync_managed' },
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_synced_at' },
      templateId: { type: DataTypes.UUID, allowNull: true, field: 'template_id' },
      masterProfile: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'master_profile' },
      latitude: { type: DataTypes.DOUBLE, allowNull: true },
      longitude: { type: DataTypes.DOUBLE, allowNull: true },
    },
    { sequelize, modelName: 'Park', tableName: 'parks', underscored: true }
  );

  ParkZone.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      name: { type: DataTypes.STRING(200), allowNull: false },
      slug: { type: DataTypes.STRING(128), allowNull: false },
      parentZoneId: { type: DataTypes.UUID, allowNull: true, field: 'parent_zone_id' },
      externalEntityId: { type: DataTypes.STRING(64), allowNull: true, field: 'external_entity_id' },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
    },
    { sequelize, modelName: 'ParkZone', tableName: 'park_zones', underscored: true }
  );

  ParkAsset.init(
    {
      assetId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, field: 'asset_id' },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      zoneId: { type: DataTypes.UUID, allowNull: true, field: 'zone_id' },
      parentAssetId: { type: DataTypes.UUID, allowNull: true, field: 'parent_asset_id' },
      assetTypeId: { type: DataTypes.UUID, allowNull: false, field: 'asset_type_id' },
      name: { type: DataTypes.STRING(240), allowNull: false },
      shortName: { type: DataTypes.STRING(120), allowNull: true, field: 'short_name' },
      slug: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      latitude: { type: DataTypes.DOUBLE, allowNull: true },
      longitude: { type: DataTypes.DOUBLE, allowNull: true },
      zoneLabel: { type: DataTypes.STRING(200), allowNull: true, field: 'zone_label' },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'UNKNOWN' },
      activeFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'active_flag' },
      openingFlag: { type: DataTypes.BOOLEAN, allowNull: true, field: 'opening_flag' },
      externalSource: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'THEMEPARKS_WIKI', field: 'external_source' },
      externalEntityId: { type: DataTypes.STRING(64), allowNull: true, field: 'external_entity_id' },
      externalParentId: { type: DataTypes.STRING(64), allowNull: true, field: 'external_parent_id' },
      providerSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'provider_snapshot' },
      enrichment: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'enrichment' },
      syncManaged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'sync_managed' },
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_synced_at' },
      templateId: { type: DataTypes.UUID, allowNull: true, field: 'template_id' },
      masterProfile: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'master_profile' },
    },
    { sequelize, modelName: 'ParkAsset', tableName: 'park_assets', underscored: true, timestamps: true }
  );

  RideMasterData.init(
    {
      assetId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'asset_id' },
      capacityPph: { type: DataTypes.INTEGER, allowNull: true, field: 'capacity_pph' },
      theoreticalCapacityPph: { type: DataTypes.INTEGER, allowNull: true, field: 'theoretical_capacity_pph' },
      dispatchIntervalSec: { type: DataTypes.INTEGER, allowNull: true, field: 'dispatch_interval_sec' },
      cycleTimeSec: { type: DataTypes.INTEGER, allowNull: true, field: 'cycle_time_sec' },
      plannedCycleTimeSec: { type: DataTypes.INTEGER, allowNull: true, field: 'planned_cycle_time_sec' },
      opcReferenceCycleTimeSec: { type: DataTypes.INTEGER, allowNull: true, field: 'opc_reference_cycle_time_sec' },
      maxQueueGuests: { type: DataTypes.INTEGER, allowNull: true, field: 'max_queue_guests' },
      maxSpeedKmh: { type: DataTypes.INTEGER, allowNull: true, field: 'max_speed_kmh' },
      structureHeightM: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'structure_height_m' },
      trackLengthM: { type: DataTypes.INTEGER, allowNull: true, field: 'track_length_m' },
      virtualLineEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'virtual_line_enabled',
      },
      seatsPerCycle: { type: DataTypes.INTEGER, allowNull: true, field: 'seats_per_cycle' },
      trainsCount: { type: DataTypes.INTEGER, allowNull: true, field: 'trains_count' },
      rideCategory: { type: DataTypes.STRING(80), allowNull: true, field: 'ride_category' },
      minStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'min_staff' },
      normalStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'normal_staff' },
      peakStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'peak_staff' },
      weatherSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'weather_sensitive' },
      rainSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'rain_sensitive' },
      windLimitKmh: { type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'wind_limit_kmh' },
      minHeightCm: { type: DataTypes.INTEGER, allowNull: true, field: 'min_height_cm' },
      maxHeightCm: { type: DataTypes.INTEGER, allowNull: true, field: 'max_height_cm' },
      thrillLevel: { type: DataTypes.SMALLINT, allowNull: true, field: 'thrill_level' },
      manufacturer: { type: DataTypes.STRING(160), allowNull: true },
      buildYear: { type: DataTypes.SMALLINT, allowNull: true, field: 'build_year' },
      plcType: { type: DataTypes.STRING(80), allowNull: true, field: 'plc_type' },
      maintenanceClass: { type: DataTypes.STRING(16), allowNull: true, field: 'maintenance_class' },
    },
    { sequelize, modelName: 'RideMasterData', tableName: 'ride_master_data', underscored: true }
  );

  ShowMasterData.init(
    {
      assetId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'asset_id' },
      showType: { type: DataTypes.STRING(80), allowNull: true, field: 'show_type' },
      venueName: { type: DataTypes.STRING(80), allowNull: true, field: 'venue_name' },
      durationMin: { type: DataTypes.INTEGER, allowNull: true, field: 'duration_min' },
      seatsCapacity: { type: DataTypes.INTEGER, allowNull: true, field: 'seats_capacity' },
      standingCapacity: { type: DataTypes.INTEGER, allowNull: true, field: 'standing_capacity' },
      schedulePattern: { type: DataTypes.STRING(64), allowNull: true, field: 'schedule_pattern' },
      showsPerDay: { type: DataTypes.INTEGER, allowNull: true, field: 'shows_per_day' },
      firstShowTime: { type: DataTypes.STRING(8), allowNull: true, field: 'first_show_time' },
      lastShowTime: { type: DataTypes.STRING(8), allowNull: true, field: 'last_show_time' },
      performerCount: { type: DataTypes.INTEGER, allowNull: true, field: 'performer_count' },
      technicalStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'technical_staff' },
      operatorStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'operator_staff' },
      language: { type: DataTypes.STRING(16), allowNull: true },
      indoorFlag: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'indoor_flag' },
      weatherSensitive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'weather_sensitive' },
      audienceRating: { type: DataTypes.STRING(40), allowNull: true, field: 'audience_rating' },
    },
    { sequelize, modelName: 'ShowMasterData', tableName: 'show_master_data', underscored: true }
  );

  RestaurantMasterData.init(
    {
      assetId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'asset_id' },
      restaurantType: { type: DataTypes.STRING(80), allowNull: true, field: 'restaurant_type' },
      cuisineType: { type: DataTypes.STRING(120), allowNull: true, field: 'cuisine_type' },
      indoorSeats: { type: DataTypes.INTEGER, allowNull: true, field: 'indoor_seats' },
      outdoorSeats: { type: DataTypes.INTEGER, allowNull: true, field: 'outdoor_seats' },
      maxCapacity: { type: DataTypes.INTEGER, allowNull: true, field: 'max_capacity' },
      seatingCapacity: { type: DataTypes.INTEGER, allowNull: true, field: 'seating_capacity' },
      avgServiceTimeMin: { type: DataTypes.INTEGER, allowNull: true, field: 'avg_service_time_min' },
      avgTableTurnoverMin: { type: DataTypes.INTEGER, allowNull: true, field: 'avg_table_turnover_min' },
      kitchenCapacityOrdersH: { type: DataTypes.INTEGER, allowNull: true, field: 'kitchen_capacity_orders_h' },
      kitchenStaffMin: { type: DataTypes.INTEGER, allowNull: true, field: 'kitchen_staff_min' },
      serviceStaffMin: { type: DataTypes.INTEGER, allowNull: true, field: 'service_staff_min' },
      peakStaff: { type: DataTypes.INTEGER, allowNull: true, field: 'peak_staff' },
      avgBasketValue: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'avg_basket_value' },
      alcoholLicense: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'alcohol_license' },
      mobileOrdering: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'mobile_ordering' },
      serviceStyle: { type: DataTypes.STRING(80), allowNull: true, field: 'service_style' },
    },
    { sequelize, modelName: 'RestaurantMasterData', tableName: 'restaurant_master_data', underscored: true }
  );

  ShopMasterData.init(
    {
      assetId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'asset_id' },
      retailCategory: { type: DataTypes.STRING(120), allowNull: true, field: 'retail_category' },
      squareMeters: { type: DataTypes.INTEGER, allowNull: true, field: 'square_meters' },
    },
    { sequelize, modelName: 'ShopMasterData', tableName: 'shop_master_data', underscored: true }
  );

  AssetTarget.init(
    {
      assetId: { type: DataTypes.UUID, allowNull: false, primaryKey: true, field: 'asset_id' },
      targetAvailabilityPct: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'target_availability_pct' },
      targetWaitTimeMin: { type: DataTypes.INTEGER, allowNull: true, field: 'target_wait_time_min' },
      targetUtilizationPct: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'target_utilization_pct' },
      targetOeePct: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'target_oee_pct' },
      revenuePriority: { type: DataTypes.STRING(32), allowNull: true, field: 'revenue_priority' },
    },
    { sequelize, modelName: 'AssetTarget', tableName: 'asset_targets', underscored: true, timestamps: true }
  );

  AssetRuntimeOverride.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      validFrom: { type: DataTypes.DATE, allowNull: true, field: 'valid_from' },
      validTo: { type: DataTypes.DATE, allowNull: true, field: 'valid_to' },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { sequelize, modelName: 'AssetRuntimeOverride', tableName: 'asset_runtime_overrides', underscored: true, timestamps: true }
  );

  AssetDowntimeEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      startedAt: { type: DataTypes.DATE, allowNull: false, field: 'started_at' },
      endedAt: { type: DataTypes.DATE, allowNull: true, field: 'ended_at' },
      planned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      reasonCode: { type: DataTypes.STRING(64), allowNull: false, field: 'reason_code' },
      notes: { type: DataTypes.TEXT, allowNull: true },
      source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'manual' },
      createdByUserId: { type: DataTypes.UUID, allowNull: true, field: 'created_by_user_id' },
    },
    {
      sequelize,
      modelName: 'AssetDowntimeEvent',
      tableName: 'asset_downtime_events',
      underscored: true,
      timestamps: true,
    }
  );

  ShiftHandoverEntry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      parkId: { type: DataTypes.UUID, allowNull: false, field: 'park_id' },
      windowFrom: { type: DataTypes.DATE, allowNull: false, field: 'window_from' },
      windowTo: { type: DataTypes.DATE, allowNull: false, field: 'window_to' },
      shiftLabel: { type: DataTypes.STRING(64), allowNull: true, field: 'shift_label' },
      downtimeSnapshot: { type: DataTypes.JSONB, allowNull: true, field: 'downtime_snapshot' },
      notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      createdByUserId: { type: DataTypes.UUID, allowNull: true, field: 'created_by_user_id' },
      /** Null = parkweit; sonst z. B. PARK_ASSET + UUID aus park_assets.asset_id */
      linkedEntityType: { type: DataTypes.STRING(40), allowNull: true, field: 'linked_entity_type' },
      linkedEntityId: { type: DataTypes.STRING(64), allowNull: true, field: 'linked_entity_id' },
      acknowledgedAt: { type: DataTypes.DATE, allowNull: true, field: 'acknowledged_at' },
      acknowledgedByUserId: { type: DataTypes.UUID, allowNull: true, field: 'acknowledged_by_user_id' },
      acknowledgementNote: { type: DataTypes.TEXT, allowNull: true, field: 'acknowledgement_note' },
      followUpTasks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'follow_up_tasks' },
      diffSnapshot: { type: DataTypes.JSONB, allowNull: true, field: 'diff_snapshot' },
      reminderDueAt: { type: DataTypes.DATE, allowNull: true, field: 'reminder_due_at' },
      reminderSentAt: { type: DataTypes.DATE, allowNull: true, field: 'reminder_sent_at' },
    },
    {
      sequelize,
      modelName: 'ShiftHandoverEntry',
      tableName: 'shift_handover_entries',
      underscored: true,
      timestamps: true,
    }
  );

  RideTemplate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(160), allowNull: false },
      defaultProfile: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'default_profile' },
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_system' },
    },
    { sequelize, modelName: 'RideTemplate', tableName: 'ride_templates', underscored: true }
  );

  StaffingTemplate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(160), allowNull: false },
      templateBody: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'template_body' },
    },
    { sequelize, modelName: 'StaffingTemplate', tableName: 'staffing_templates', underscored: true }
  );

  MaintenanceTemplate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(160), allowNull: false },
      templateBody: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'template_body' },
    },
    { sequelize, modelName: 'MaintenanceTemplate', tableName: 'maintenance_templates', underscored: true }
  );

  AssetObservation.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      assetId: { type: DataTypes.UUID, allowNull: false, field: 'asset_id' },
      metricCode: { type: DataTypes.STRING(64), allowNull: false, field: 'metric_code' },
      metricValue: { type: DataTypes.TEXT, allowNull: false, field: 'metric_value' },
      unit: { type: DataTypes.STRING(32), allowNull: true },
      timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'THEMEPARKS_WIKI' },
    },
    {
      sequelize,
      modelName: 'AssetObservation',
      tableName: 'asset_observations',
      underscored: true,
      timestamps: true,
      updatedAt: false,
    }
  );

  Park.belongsTo(EntityTypeTemplate, { foreignKey: 'templateId', as: 'entityTemplate' });
  EntityTypeTemplate.hasMany(Park, { foreignKey: 'templateId', as: 'parks' });
  ParkAsset.belongsTo(EntityTypeTemplate, { foreignKey: 'templateId', as: 'entityTemplate' });
  EntityTypeTemplate.hasMany(ParkAsset, { foreignKey: 'templateId', as: 'parkAssets' });

  Park.hasMany(ParkZone, { foreignKey: 'parkId', as: 'zones' });
  ParkZone.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
  ParkZone.belongsTo(ParkZone, { foreignKey: 'parentZoneId', as: 'parentZone' });
  ParkZone.hasMany(ParkZone, { foreignKey: 'parentZoneId', as: 'childZones' });

  Park.hasMany(ParkAsset, { foreignKey: 'parkId', as: 'assets' });
  ParkAsset.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
  ParkZone.hasMany(ParkAsset, { foreignKey: 'zoneId', as: 'assets' });
  ParkAsset.belongsTo(ParkZone, { foreignKey: 'zoneId', as: 'zone' });
  ParkAsset.belongsTo(AssetType, { foreignKey: 'assetTypeId', as: 'assetType' });
  AssetType.hasMany(ParkAsset, { foreignKey: 'assetTypeId', as: 'assets' });
  ParkAsset.belongsTo(ParkAsset, { foreignKey: 'parentAssetId', as: 'parentAsset' });
  ParkAsset.hasMany(ParkAsset, { foreignKey: 'parentAssetId', as: 'childAssets' });

  ParkAsset.hasOne(RideMasterData, { foreignKey: 'assetId', as: 'rideMaster' });
  RideMasterData.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });
  ParkAsset.hasOne(ShowMasterData, { foreignKey: 'assetId', as: 'showMaster' });
  ShowMasterData.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });
  ParkAsset.hasOne(RestaurantMasterData, { foreignKey: 'assetId', as: 'restaurantMaster' });
  RestaurantMasterData.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });
  ParkAsset.hasOne(ShopMasterData, { foreignKey: 'assetId', as: 'shopMaster' });
  ShopMasterData.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });

  ParkAsset.hasOne(AssetTarget, { foreignKey: 'assetId', as: 'assetTarget' });
  AssetTarget.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });
  ParkAsset.hasMany(AssetRuntimeOverride, { foreignKey: 'assetId', as: 'runtimeOverrides' });
  AssetRuntimeOverride.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });

  ParkAsset.hasMany(AssetObservation, { foreignKey: 'assetId', as: 'observations' });
  AssetObservation.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });

  ParkAsset.hasMany(AssetDowntimeEvent, { foreignKey: 'assetId', as: 'downtimeEvents' });
  AssetDowntimeEvent.belongsTo(ParkAsset, { foreignKey: 'assetId', as: 'asset' });
  AssetDowntimeEvent.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

  Park.hasMany(ShiftHandoverEntry, { foreignKey: 'parkId', as: 'shiftHandovers' });
  ShiftHandoverEntry.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

  return {
    AssetType,
    EntityTypeTemplate,
    Park,
    ParkZone,
    ParkAsset,
    RideMasterData,
    ShowMasterData,
    RestaurantMasterData,
    ShopMasterData,
    RideTemplate,
    StaffingTemplate,
    MaintenanceTemplate,
    AssetObservation,
    AssetTarget,
    AssetRuntimeOverride,
    AssetDowntimeEvent,
    ShiftHandoverEntry,
  };
}

module.exports = { definePlatformModels };
