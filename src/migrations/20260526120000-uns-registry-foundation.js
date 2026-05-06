'use strict';

/**
 * Phase 1 + 2: additive UNS Registry tables (mirror of legacy master data + UNS nodes).
 * Does not alter uns_nodes, MQTT, or orchestrator behavior.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('uns_registry_entities', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      entity_kind: {
        type: Sequelize.STRING(40),
        allowNull: false,
      },
      legacy_table: { type: Sequelize.STRING(64), allowNull: false },
      legacy_id: { type: Sequelize.STRING(64), allowNull: false },
      park_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      slug: { type: Sequelize.STRING(200), allowNull: true },
      name: { type: Sequelize.STRING(500), allowNull: true },
      external_entity_id: { type: Sequelize.STRING(255), allowNull: true },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      mirrored_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('uns_registry_entities', ['registry_source', 'legacy_table', 'legacy_id'], {
      unique: true,
      name: 'uns_registry_entities_source_legacy_uq',
    });
    await queryInterface.addIndex('uns_registry_entities', ['park_id', 'entity_kind'], {
      name: 'uns_registry_entities_park_kind_idx',
    });

    await queryInterface.createTable('uns_registry_mappings', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      relation_kind: { type: Sequelize.STRING(64), allowNull: false },
      from_entity_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'uns_registry_entities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      to_entity_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'uns_registry_entities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      mirrored_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('uns_registry_mappings', ['from_entity_id'], {
      name: 'uns_registry_mappings_from_idx',
    });
    await queryInterface.addIndex('uns_registry_mappings', ['to_entity_id'], {
      name: 'uns_registry_mappings_to_idx',
    });
    await queryInterface.addIndex('uns_registry_mappings', ['registry_source', 'relation_kind'], {
      name: 'uns_registry_mappings_source_rel_idx',
    });

    await queryInterface.createTable('uns_registry_topics', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      topic_path: { type: Sequelize.STRING(1000), allowNull: false },
      uns_node_legacy_id: { type: Sequelize.UUID, allowNull: true },
      park_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      registry_entity_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'uns_registry_entities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      mirrored_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('uns_registry_topics', ['registry_source', 'topic_path'], {
      unique: true,
      name: 'uns_registry_topics_source_path_uq',
    });
    await queryInterface.addIndex('uns_registry_topics', ['park_id'], {
      name: 'uns_registry_topics_park_idx',
    });

    await queryInterface.createTable('uns_registry_metadata', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      registry_entity_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'uns_registry_entities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      meta_key: { type: Sequelize.STRING(255), allowNull: false },
      meta_value_json: { type: Sequelize.JSONB, allowNull: true },
      mirrored_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('uns_registry_metadata', ['registry_entity_id', 'meta_key', 'registry_source'], {
      unique: true,
      name: 'uns_registry_metadata_entity_key_source_uq',
    });

    await queryInterface.createTable('signal_catalog', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      signal_code: { type: Sequelize.STRING(128), allowNull: false },
      label: { type: Sequelize.STRING(255), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      unit: { type: Sequelize.STRING(64), allowNull: true },
      category: { type: Sequelize.STRING(64), allowNull: true },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('signal_catalog', ['registry_source', 'signal_code'], {
      unique: true,
      name: 'signal_catalog_source_code_uq',
    });

    await queryInterface.createTable('ride_signal_capabilities', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      park_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'parks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      asset_id: { type: Sequelize.UUID, allowNull: false },
      signal_catalog_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'signal_catalog', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      capability_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      mirrored_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('ride_signal_capabilities', ['park_id', 'asset_id', 'signal_catalog_id', 'registry_source'], {
      unique: true,
      name: 'ride_signal_capabilities_park_asset_signal_uq',
    });

    await queryInterface.createTable('sparkplug_metric_definitions', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      metric_name: { type: Sequelize.STRING(128), allowNull: false },
      alias_of: { type: Sequelize.STRING(128), allowNull: true },
      data_type: { type: Sequelize.STRING(64), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      registry_source: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'MIRRORED_FROM_LEGACY',
      },
      payload_json: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('sparkplug_metric_definitions', ['registry_source', 'metric_name'], {
      unique: true,
      name: 'sparkplug_metric_definitions_source_name_uq',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ride_signal_capabilities');
    await queryInterface.dropTable('sparkplug_metric_definitions');
    await queryInterface.dropTable('signal_catalog');
    await queryInterface.dropTable('uns_registry_metadata');
    await queryInterface.dropTable('uns_registry_topics');
    await queryInterface.dropTable('uns_registry_mappings');
    await queryInterface.dropTable('uns_registry_entities');
  },
};
