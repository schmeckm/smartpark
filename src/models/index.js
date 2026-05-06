const { sequelize } = require('../db/sequelize');
const { defineZone } = require('./zone.model');
const { defineRide } = require('./ride.model');
const { defineStaff } = require('./staff.model');
const { defineCrowdEvent } = require('./crowd-event.model');
const { defineIncident } = require('./incident.model');
const { defineRecommendation } = require('./recommendation.model');
const { defineUser } = require('./user.model');
const { defineUserRole } = require('./user-role.model');
const { defineRefreshToken } = require('./refresh-token.model');
const { defineAuditLog } = require('./audit-log.model');
const { defineIntegrationEventLog } = require('./integration-event-log.model');
const { defineWeatherObservation } = require('./weather-observation.model');
const { defineDataQualityIssue } = require('./data-quality-issue.model');
const { defineZoneCrowdSample } = require('./zone-crowd-sample.model');
const { defineMlModelVersion } = require('./ml-model-version.model');
const { defineForecast } = require('./forecast.model');
const { defineRecommendationScore } = require('./recommendation-score.model');
const { defineCanonicalInboundMessage } = require('./canonical-inbound-message.model');
const { defineProviderAdapterConfig } = require('./provider-adapter-config.model');
const { defineExternalEntityMapping } = require('./external-entity-mapping.model');
const { defineMappingRule } = require('./mapping-rule.model');
const { defineAppSetting } = require('./app-setting.model');
const { definePlatformSetting } = require('./platform-setting.model');
const { defineRideWaitTimeSample } = require('./ride-wait-time-sample.model');
const { defineParkCalendarContext } = require('./park-calendar-context.model');
const { defineParkOperatingSnapshot } = require('./park-operating-snapshot.model');
const { defineParkFeatureSnapshot } = require('./park-feature-snapshot.model');
const { defineRideFeatureSnapshot } = require('./ride-feature-snapshot.model');
const { defineMlGlobalFactor } = require('./ml-global-factor.model');
const { defineMlParkFactor } = require('./ml-park-factor.model');
const { defineMlProfile } = require('./ml-profile.model');
const { defineAssetMlProfileAssignment } = require('./asset-ml-profile-assignment.model');
const { defineAssetMlOverride } = require('./asset-ml-override.model');
const { defineForecastTrainingLabel } = require('./forecast-training-label.model');
const { defineAiPipelineRun } = require('./ai-pipeline-run.model');
const { defineAiStudioModel } = require('./ai-studio-model.model');
const { defineModelMetricsDaily } = require('./model-metrics-daily.model');
const { defineAdapterPackage } = require('./adapter-package.model');
const { defineUnsNode } = require('./uns-node.model');
const { defineUnsLatestState } = require('./uns-latest-state.model');
const { defineUnsDevice } = require('./uns-device.model');
const { defineAdapterRunLog } = require('./adapter-run-log.model');
const { defineMdmModels } = require('../modules/mdm/mdm.models');
const { definePlatformModels } = require('../modules/assets/platform.models');
const { defineUnsRegistryModels } = require('./uns-registry.models');
const { defineUnsSpyModels } = require('./uns-spy.models');
const { defineVisitPlanVersion } = require('./visit-plan-version.model');
const { defineVisitActualYearly } = require('./visit-actual-yearly.model');
const { defineVisitorJourneyEvent } = require('./visitor-journey-event.model');
const { defineSqdcMoodRating } = require('./sqdc-mood-rating.model');
const { defineSqdcSafetyEvent } = require('./sqdc-safety-event.model');
const { defineSqdcBoardSnapshot } = require('./sqdc-board-snapshot.model');
const { defineSqdcDailySnapshot } = require('./sqdc-daily-snapshot.model');
const { defineSqdcEvent } = require('./sqdc-event.model');
const { defineSqdcMoodFeedback } = require('./sqdc-mood-feedback.model');
const { defineMlModelRegistry } = require('./ml-model-registry.model');
const { defineRegistryPublishEvent } = require('./registry-publish-event.model');
const { defineRegistrySignalDeprecation } = require('./registry-signal-deprecation.model');

const Zone = defineZone(sequelize);
const Ride = defineRide(sequelize);
const Staff = defineStaff(sequelize);
const CrowdEvent = defineCrowdEvent(sequelize);
const Incident = defineIncident(sequelize);
const Recommendation = defineRecommendation(sequelize);
const User = defineUser(sequelize);
const UserRole = defineUserRole(sequelize);
const RefreshToken = defineRefreshToken(sequelize);
const AuditLog = defineAuditLog(sequelize);
const IntegrationEventLog = defineIntegrationEventLog(sequelize);
const WeatherObservation = defineWeatherObservation(sequelize);
const DataQualityIssue = defineDataQualityIssue(sequelize);
const ZoneCrowdSample = defineZoneCrowdSample(sequelize);
const MlModelVersion = defineMlModelVersion(sequelize);
const Forecast = defineForecast(sequelize);
const RecommendationScore = defineRecommendationScore(sequelize);
const CanonicalInboundMessage = defineCanonicalInboundMessage(sequelize);
const ProviderAdapterConfig = defineProviderAdapterConfig(sequelize);
const ExternalEntityMapping = defineExternalEntityMapping(sequelize);
const MappingRule = defineMappingRule(sequelize);
const AppSetting = defineAppSetting(sequelize);
const PlatformSetting = definePlatformSetting(sequelize);
const RideWaitTimeSample = defineRideWaitTimeSample(sequelize);
const ParkCalendarContext = defineParkCalendarContext(sequelize);
const ParkOperatingSnapshot = defineParkOperatingSnapshot(sequelize);
const ParkFeatureSnapshot = defineParkFeatureSnapshot(sequelize);
const RideFeatureSnapshot = defineRideFeatureSnapshot(sequelize);
const MlGlobalFactor = defineMlGlobalFactor(sequelize);
const MlParkFactor = defineMlParkFactor(sequelize);
const MlProfile = defineMlProfile(sequelize);
const AssetMlProfileAssignment = defineAssetMlProfileAssignment(sequelize);
const AssetMlOverride = defineAssetMlOverride(sequelize);
const ForecastTrainingLabel = defineForecastTrainingLabel(sequelize);
const AiPipelineRun = defineAiPipelineRun(sequelize);
const AiStudioModel = defineAiStudioModel(sequelize);
const ModelMetricsDaily = defineModelMetricsDaily(sequelize);
const AdapterPackage = defineAdapterPackage(sequelize);
const UnsNode = defineUnsNode(sequelize);
const UnsLatestState = defineUnsLatestState(sequelize);
const UnsDevice = defineUnsDevice(sequelize);
const AdapterRunLog = defineAdapterRunLog(sequelize);

const {
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
} = defineMdmModels(sequelize, { Ride, User });

const VisitPlanVersion = defineVisitPlanVersion(sequelize);
const VisitActualYearly = defineVisitActualYearly(sequelize);
const VisitorJourneyEvent = defineVisitorJourneyEvent(sequelize);
const SqdcMoodRating = defineSqdcMoodRating(sequelize);
const SqdcSafetyEvent = defineSqdcSafetyEvent(sequelize);
const SqdcBoardSnapshot = defineSqdcBoardSnapshot(sequelize);
const SqdcDailySnapshot = defineSqdcDailySnapshot(sequelize);
const SqdcEvent = defineSqdcEvent(sequelize);
const SqdcMoodFeedback = defineSqdcMoodFeedback(sequelize);
const MlModelRegistry = defineMlModelRegistry(sequelize);
const RegistryPublishEvent = defineRegistryPublishEvent(sequelize);
const RegistrySignalDeprecation = defineRegistrySignalDeprecation(sequelize);

const {
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
} = definePlatformModels(sequelize);

const {
  UnsRegistryEntity,
  UnsRegistryMapping,
  UnsRegistryTopic,
  UnsRegistryMetadata,
  SignalCatalog,
  RideSignalCapability,
  SparkplugMetricDefinition,
  REGISTRY_SOURCE_MIRRORED,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
} = defineUnsRegistryModels(sequelize);

const {
  MqttInboundMessage,
  UnsDiscoveryEvent,
  UnsTopicProposal,
  SPY_CLASSIFICATION,
} = defineUnsSpyModels(sequelize);

Zone.hasMany(Ride, { foreignKey: 'zoneId', as: 'rides' });
Ride.belongsTo(Zone, { foreignKey: 'zoneId', as: 'zone' });

Zone.hasMany(Staff, { foreignKey: 'currentZoneId', as: 'staffMembers' });
Staff.belongsTo(Zone, { foreignKey: 'currentZoneId', as: 'currentZone' });
Staff.belongsTo(Staff, { foreignKey: 'supervisorId', as: 'supervisor' });
Staff.hasMany(Staff, { foreignKey: 'supervisorId', as: 'directReports' });

Zone.hasMany(CrowdEvent, { foreignKey: 'zoneId', as: 'crowdEvents' });
CrowdEvent.belongsTo(Zone, { foreignKey: 'zoneId', as: 'zone' });

CrowdEvent.hasMany(Recommendation, { foreignKey: 'eventId', as: 'recommendations' });
Recommendation.belongsTo(CrowdEvent, { foreignKey: 'eventId', as: 'event' });

Recommendation.hasOne(RecommendationScore, { foreignKey: 'recommendationId', as: 'score' });
RecommendationScore.belongsTo(Recommendation, { foreignKey: 'recommendationId', as: 'recommendation' });
RecommendationScore.belongsTo(MlModelVersion, { foreignKey: 'modelVersionId', as: 'modelVersion' });
MlModelVersion.hasMany(RecommendationScore, { foreignKey: 'modelVersionId', as: 'recommendationScores' });
Ride.hasMany(RideWaitTimeSample, { foreignKey: 'internalRideId', as: 'waitTimeSamples' });
RideWaitTimeSample.belongsTo(Ride, { foreignKey: 'internalRideId', as: 'ride' });
RideWaitTimeSample.belongsTo(ParkAsset, { foreignKey: 'parkAssetId', targetKey: 'assetId', as: 'platformAsset' });

ParkAsset.hasMany(RegistrySignalDeprecation, {
  foreignKey: 'rideAssetId',
  sourceKey: 'assetId',
  as: 'registrySignalDeprecations',
});
RegistrySignalDeprecation.belongsTo(ParkAsset, {
  foreignKey: 'rideAssetId',
  targetKey: 'assetId',
  as: 'rideAsset',
});

SignalCatalog.hasMany(RegistrySignalDeprecation, {
  foreignKey: 'signalCatalogId',
  as: 'registryDeprecations',
});
RegistrySignalDeprecation.belongsTo(SignalCatalog, { foreignKey: 'signalCatalogId', as: 'signalCatalog' });

User.hasMany(RegistrySignalDeprecation, { foreignKey: 'updatedByUserId', as: 'registrySignalDeprecationUpdates' });
RegistrySignalDeprecation.belongsTo(User, { foreignKey: 'updatedByUserId', as: 'updatedByUser' });

Park.hasMany(ParkCalendarContext, { foreignKey: 'parkId', as: 'calendarContexts' });
ParkCalendarContext.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(MlParkFactor, { foreignKey: 'parkId', as: 'mlParkFactors' });
MlParkFactor.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(AiStudioModel, { foreignKey: 'parkId', as: 'aiStudioModels' });
AiStudioModel.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(VisitPlanVersion, { foreignKey: 'parkId', as: 'visitPlanVersions' });
VisitPlanVersion.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(VisitorJourneyEvent, { foreignKey: 'parkId', as: 'visitorJourneyEvents' });
VisitorJourneyEvent.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
VisitorJourneyEvent.belongsTo(ParkAsset, { foreignKey: 'assetId', targetKey: 'assetId', as: 'asset' });

MlProfile.hasMany(AssetMlProfileAssignment, { foreignKey: 'profileId', as: 'assignments' });
AssetMlProfileAssignment.belongsTo(MlProfile, { foreignKey: 'profileId', as: 'mlProfile' });
ParkAsset.hasMany(AssetMlProfileAssignment, { foreignKey: 'assetId', sourceKey: 'assetId', as: 'mlProfileAssignments' });
AssetMlProfileAssignment.belongsTo(ParkAsset, { foreignKey: 'assetId', targetKey: 'assetId', as: 'asset' });
ParkAsset.hasMany(AssetMlOverride, { foreignKey: 'assetId', sourceKey: 'assetId', as: 'mlOverrides' });
AssetMlOverride.belongsTo(ParkAsset, { foreignKey: 'assetId', targetKey: 'assetId', as: 'asset' });

User.hasMany(UserRole, { foreignKey: 'userId', as: 'userRoles' });
UserRole.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
RefreshToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Park.hasMany(Incident, { foreignKey: 'parkId', as: 'incidents' });
Incident.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
Incident.belongsTo(User, { foreignKey: 'ownerUserId', as: 'owner' });
Incident.belongsTo(User, { foreignKey: 'createdByUserId', as: 'creator' });

Park.hasMany(SqdcMoodRating, { foreignKey: 'parkId', as: 'sqdcMoodRatings' });
SqdcMoodRating.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
SqdcMoodRating.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(SqdcMoodRating, { foreignKey: 'userId', as: 'sqdcMoodRatings' });

Park.hasMany(SqdcSafetyEvent, { foreignKey: 'parkId', as: 'sqdcSafetyEvents' });
SqdcSafetyEvent.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
SqdcSafetyEvent.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });
User.hasMany(SqdcSafetyEvent, { foreignKey: 'createdByUserId', as: 'sqdcSafetyEventsCreated' });

Park.hasMany(SqdcBoardSnapshot, { foreignKey: 'parkId', as: 'sqdcBoardSnapshots' });
SqdcBoardSnapshot.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
SqdcBoardSnapshot.belongsTo(User, { foreignKey: 'capturedByUserId', as: 'capturedBy' });
User.hasMany(SqdcBoardSnapshot, { foreignKey: 'capturedByUserId', as: 'sqdcBoardSnapshotsCaptured' });

Park.hasMany(SqdcDailySnapshot, { foreignKey: 'parkId', as: 'sqdcDailySnapshots' });
SqdcDailySnapshot.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(SqdcEvent, { foreignKey: 'parkId', as: 'sqdcEvents' });
SqdcEvent.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });

Park.hasMany(SqdcMoodFeedback, { foreignKey: 'parkId', as: 'sqdcMoodFeedbacks' });
SqdcMoodFeedback.belongsTo(Park, { foreignKey: 'parkId', as: 'park' });
SqdcMoodFeedback.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });
User.hasMany(SqdcMoodFeedback, { foreignKey: 'createdByUserId', as: 'sqdcMoodFeedbacksCreated' });

AssetDowntimeEvent.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });
ShiftHandoverEntry.belongsTo(User, { foreignKey: 'createdByUserId', as: 'createdBy' });

DataQualityIssue.belongsTo(IntegrationEventLog, { foreignKey: 'integrationEventId', as: 'integrationEvent' });
IntegrationEventLog.hasMany(DataQualityIssue, { foreignKey: 'integrationEventId', as: 'dataQualityIssues' });

Zone.hasMany(ZoneCrowdSample, { foreignKey: 'zoneId', as: 'crowdSamples' });
ZoneCrowdSample.belongsTo(Zone, { foreignKey: 'zoneId', as: 'zone' });

MlModelVersion.hasMany(Forecast, { foreignKey: 'modelVersionId', as: 'forecasts' });
Forecast.belongsTo(MlModelVersion, { foreignKey: 'modelVersionId', as: 'modelVersion' });
MlModelVersion.hasMany(ModelMetricsDaily, { foreignKey: 'modelVersionId', as: 'dailyMetrics' });
ModelMetricsDaily.belongsTo(MlModelVersion, { foreignKey: 'modelVersionId', as: 'modelVersion' });
UnsNode.hasMany(UnsNode, { foreignKey: 'parentId', as: 'children' });
UnsNode.belongsTo(UnsNode, { foreignKey: 'parentId', as: 'parent' });
UnsNode.hasMany(UnsDevice, { foreignKey: 'assignedNodeId', as: 'devices' });
UnsDevice.belongsTo(UnsNode, { foreignKey: 'assignedNodeId', as: 'assignedNode' });

module.exports = {
  sequelize,
  Zone,
  Ride,
  Staff,
  CrowdEvent,
  Incident,
  Recommendation,
  RecommendationScore,
  User,
  UserRole,
  RefreshToken,
  AuditLog,
  IntegrationEventLog,
  WeatherObservation,
  DataQualityIssue,
  ZoneCrowdSample,
  MlModelVersion,
  Forecast,
  CanonicalInboundMessage,
  ProviderAdapterConfig,
  ExternalEntityMapping,
  MappingRule,
  AppSetting,
  PlatformSetting,
  RideWaitTimeSample,
  ParkCalendarContext,
  ParkOperatingSnapshot,
  ParkFeatureSnapshot,
  RideFeatureSnapshot,
  MlGlobalFactor,
  MlParkFactor,
  MlProfile,
  AssetMlProfileAssignment,
  AssetMlOverride,
  ForecastTrainingLabel,
  AiPipelineRun,
  AiStudioModel,
  ModelMetricsDaily,
  AdapterPackage,
  UnsNode,
  UnsLatestState,
  UnsDevice,
  AdapterRunLog,
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
  VisitPlanVersion,
  VisitActualYearly,
  VisitorJourneyEvent,
  SqdcMoodRating,
  SqdcSafetyEvent,
  SqdcBoardSnapshot,
  SqdcDailySnapshot,
  SqdcEvent,
  SqdcMoodFeedback,
  MlModelRegistry,
  RegistryPublishEvent,
  RegistrySignalDeprecation,
  UnsRegistryEntity,
  UnsRegistryMapping,
  UnsRegistryTopic,
  UnsRegistryMetadata,
  SignalCatalog,
  RideSignalCapability,
  SparkplugMetricDefinition,
  REGISTRY_SOURCE_MIRRORED,
  REGISTRY_SOURCE_PREPARED_OPERATOR,
  MqttInboundMessage,
  UnsDiscoveryEvent,
  UnsTopicProposal,
  SPY_CLASSIFICATION,
};
