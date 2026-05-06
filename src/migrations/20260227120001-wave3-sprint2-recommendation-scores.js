'use strict';

/** @param {import('sequelize').QueryInterface} queryInterface @param {import('sequelize').Sequelize} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('recommendation_scores', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true,
      },
      recommendation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'recommendations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      score: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
      urgency: { type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'), allowNull: false },
      impact: { type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'), allowNull: false },
      confidence: { type: Sequelize.DECIMAL(8, 6), allowNull: false },
      expected_benefit: { type: Sequelize.JSONB, allowNull: true },
      explanation: { type: Sequelize.JSONB, allowNull: false },
      factors: { type: Sequelize.JSONB, allowNull: false },
      model_version_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'ml_model_versions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('recommendation_scores', ['recommendation_id'], {
      name: 'idx_recommendation_scores_rec_id',
      unique: true,
    });
    await queryInterface.addIndex('recommendation_scores', ['score'], { name: 'idx_recommendation_scores_score' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('recommendation_scores');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_recommendation_scores_urgency";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_recommendation_scores_impact";');
  },
};
