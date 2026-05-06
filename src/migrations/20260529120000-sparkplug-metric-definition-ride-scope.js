'use strict';

/**
 * Phase 5b: Scope operator-prepared Sparkplug metric definitions per ride + signal.
 * Replaces global UNIQUE(registry_source, metric_name) with:
 * - Partial unique for MIRRORED_FROM_LEGACY on (registry_source, metric_name)
 * - Partial unique for PREPARED_OPERATOR on (registry_source, park_id, ride_asset_id, signal_key)
 *
 * Existing rows are preserved; PREPARED_OPERATOR rows are backfilled from payload_json + park_assets.
 * No MQTT / uns_nodes / uns_latest_states changes.
 */

const MIRRORED = 'MIRRORED_FROM_LEGACY';
const PREPARED = 'PREPARED_OPERATOR';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('sparkplug_metric_definitions', 'registry_entity_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'uns_registry_entities', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'ride_asset_id', {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'park_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'parks', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'edge_node_id', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'device_id', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn('sparkplug_metric_definitions', 'signal_key', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });

    await queryInterface.addIndex('sparkplug_metric_definitions', ['ride_asset_id'], {
      name: 'sparkplug_metric_definitions_ride_asset_idx',
    });
    await queryInterface.addIndex('sparkplug_metric_definitions', ['park_id'], {
      name: 'sparkplug_metric_definitions_park_idx',
    });

    // Backfill PREPARED_OPERATOR rows from payload_json + park_assets (park_id, registry_entity_id).
    await queryInterface.sequelize.query(
      `
      UPDATE sparkplug_metric_definitions smd
      SET
        ride_asset_id = COALESCE(smd.ride_asset_id, (smd.payload_json->>'rideAssetId')::uuid),
        signal_key = COALESCE(NULLIF(BTRIM(smd.signal_key), ''), smd.metric_name),
        park_id = COALESCE(smd.park_id, pa.park_id),
        registry_entity_id = COALESCE(smd.registry_entity_id, ure.id),
        device_id = COALESCE(NULLIF(BTRIM(smd.device_id), ''), smd.payload_json->>'rideAssetId')
      FROM park_assets pa
      LEFT JOIN uns_registry_entities ure
        ON ure.legacy_table = 'park_assets'
        AND ure.legacy_id = pa.asset_id::text
        AND ure.entity_kind = 'PLATFORM_ASSET'
      WHERE smd.registry_source = :prepared
        AND smd.payload_json->>'rideAssetId' IS NOT NULL
        AND smd.payload_json->>'rideAssetId' <> ''
        AND smd.payload_json->>'rideAssetId' ~ '^[0-9a-fA-F-]{36}$'
        AND pa.asset_id::text = smd.payload_json->>'rideAssetId';
    `,
      { replacements: { prepared: PREPARED } }
    );

    await queryInterface.sequelize.query(
      `
      UPDATE sparkplug_metric_definitions smd
      SET
        signal_key = COALESCE(NULLIF(BTRIM(smd.signal_key), ''), smd.metric_name),
        device_id = COALESCE(NULLIF(BTRIM(smd.device_id), ''), smd.payload_json->>'rideAssetId')
      WHERE smd.registry_source = :prepared
        AND (smd.signal_key IS NULL OR BTRIM(smd.signal_key) = '');
    `,
      { replacements: { prepared: PREPARED } }
    );

    await queryInterface.sequelize.query(
      `
      UPDATE sparkplug_metric_definitions smd
      SET park_id = pa.park_id
      FROM park_assets pa
      WHERE smd.registry_source = :prepared
        AND smd.ride_asset_id IS NOT NULL
        AND smd.park_id IS NULL
        AND pa.asset_id = smd.ride_asset_id;
    `,
      { replacements: { prepared: PREPARED } }
    );

    await queryInterface.removeIndex('sparkplug_metric_definitions', 'sparkplug_metric_definitions_source_name_uq');

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX sparkplug_metric_definitions_mirrored_source_name_uq
      ON sparkplug_metric_definitions (registry_source, metric_name)
      WHERE registry_source = :mirrored;
    `, { replacements: { mirrored: MIRRORED } });

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX sparkplug_metric_definitions_prepared_scope_uq
      ON sparkplug_metric_definitions (registry_source, park_id, ride_asset_id, signal_key)
      WHERE registry_source = :prepared
        AND park_id IS NOT NULL
        AND ride_asset_id IS NOT NULL
        AND signal_key IS NOT NULL
        AND trim(signal_key) <> '';
    `, { replacements: { prepared: PREPARED } });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS sparkplug_metric_definitions_prepared_scope_uq;'
    );
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS sparkplug_metric_definitions_mirrored_source_name_uq;'
    );

    /**
     * Restores the legacy global unique on (registry_source, metric_name).
     * Fails if more than one PREPARED_OPERATOR row exists for the same metric_name (possible after Phase 5b up).
     * Resolve duplicates before undo, or delete extra PREPARED rows.
     */
    await queryInterface.addIndex('sparkplug_metric_definitions', ['registry_source', 'metric_name'], {
      unique: true,
      name: 'sparkplug_metric_definitions_source_name_uq',
    });

    await queryInterface.removeIndex('sparkplug_metric_definitions', 'sparkplug_metric_definitions_ride_asset_idx');
    await queryInterface.removeIndex('sparkplug_metric_definitions', 'sparkplug_metric_definitions_park_idx');

    await queryInterface.removeColumn('sparkplug_metric_definitions', 'signal_key');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'device_id');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'edge_node_id');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'park_id');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'ride_asset_id');
    await queryInterface.removeColumn('sparkplug_metric_definitions', 'registry_entity_id');
  },
};
