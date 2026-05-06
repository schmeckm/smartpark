'use strict';

const { Model, DataTypes } = require('sequelize');

class RegistrySignalDeprecation extends Model {}

function defineRegistrySignalDeprecation(sequelize) {
  RegistrySignalDeprecation.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      rideAssetId: { type: DataTypes.UUID, allowNull: false, field: 'ride_asset_id' },
      signalKey: { type: DataTypes.STRING(128), allowNull: false, field: 'signal_key' },
      signalCatalogId: { type: DataTypes.UUID, allowNull: true, field: 'signal_catalog_id' },
      registryAuthoritative: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'registry_authoritative',
      },
      legacyFallbackDisabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'legacy_fallback_disabled',
      },
      legacyPublishDisabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'legacy_publish_disabled',
      },
      validationStartedAt: { type: DataTypes.DATE, allowNull: true, field: 'validation_started_at' },
      authoritativeMarkedAt: { type: DataTypes.DATE, allowNull: true, field: 'authoritative_marked_at' },
      legacyFallbackDisabledAt: { type: DataTypes.DATE, allowNull: true, field: 'legacy_fallback_disabled_at' },
      legacyPublishDisabledAt: { type: DataTypes.DATE, allowNull: true, field: 'legacy_publish_disabled_at' },
      lastHealthPassAt: { type: DataTypes.DATE, allowNull: true, field: 'last_health_pass_at' },
      stabilityWindowStartedAt: { type: DataTypes.DATE, allowNull: true, field: 'stability_window_started_at' },
      updatedByUserId: { type: DataTypes.UUID, allowNull: true, field: 'updated_by_user_id' },
    },
    {
      sequelize,
      modelName: 'RegistrySignalDeprecation',
      tableName: 'registry_signal_deprecations',
      underscored: true,
      timestamps: true,
    }
  );
  return RegistrySignalDeprecation;
}

module.exports = { defineRegistrySignalDeprecation, RegistrySignalDeprecation };
