'use strict';

const Z_PLAZA = 'b1000001-0000-4000-8000-000000000001';
const Z_ALPINE = 'b1000001-0000-4000-8000-000000000002';
const Z_MED = 'b1000001-0000-4000-8000-000000000003';
const Z_NORDIC = 'b1000001-0000-4000-8000-000000000004';
const Z_FAIRYTALE = 'b1000001-0000-4000-8000-000000000005';

const now = new Date();

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert(
      'zones',
      [
        {
          id: Z_PLAZA,
          name: 'Kingdom Plaza',
          type: 'MAIN_GATE',
          current_crowd_level: 4200,
          forecast_crowd_level: 5100,
          max_capacity: 9000,
          status: 'ACTIVE',
          adjacent_zone_ids: [Z_ALPINE, Z_FAIRYTALE],
          created_at: now,
          updated_at: now,
        },
        {
          id: Z_ALPINE,
          name: 'Alpine Summit',
          type: 'THRILL',
          current_crowd_level: 6800,
          forecast_crowd_level: 7200,
          max_capacity: 8500,
          status: 'ACTIVE',
          adjacent_zone_ids: [Z_PLAZA, Z_MED, Z_NORDIC, Z_FAIRYTALE],
          created_at: now,
          updated_at: now,
        },
        {
          id: Z_MED,
          name: 'Mediterranean Boardwalk',
          type: 'WATERFRONT',
          current_crowd_level: 3100,
          forecast_crowd_level: 3600,
          max_capacity: 7000,
          status: 'ACTIVE',
          adjacent_zone_ids: [Z_ALPINE, Z_NORDIC],
          created_at: now,
          updated_at: now,
        },
        {
          id: Z_NORDIC,
          name: 'Nordic Harbor',
          type: 'FAMILY',
          current_crowd_level: 2600,
          forecast_crowd_level: 2900,
          max_capacity: 6000,
          status: 'ACTIVE',
          adjacent_zone_ids: [Z_ALPINE, Z_MED, Z_FAIRYTALE],
          created_at: now,
          updated_at: now,
        },
        {
          id: Z_FAIRYTALE,
          name: 'Enchanted Glades',
          type: 'FAMILY',
          current_crowd_level: 2100,
          forecast_crowd_level: 2400,
          max_capacity: 5500,
          status: 'ACTIVE',
          adjacent_zone_ids: [Z_PLAZA, Z_ALPINE, Z_NORDIC],
          created_at: now,
          updated_at: now,
        },
      ],
      {}
    );

    await queryInterface.bulkInsert(
      'rides',
      [
        {
          id: 'c2000001-0000-4000-8000-000000000001',
          name: 'Silver Comet',
          zone_id: Z_ALPINE,
          status: 'OPEN',
          wait_time: 55,
          capacity_per_hour: 1400,
          criticality: 5,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'c2000001-0000-4000-8000-000000000002',
          name: 'Blue Streak Launch',
          zone_id: Z_ALPINE,
          status: 'OPEN',
          wait_time: 40,
          capacity_per_hour: 1200,
          criticality: 5,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'c2000001-0000-4000-8000-000000000003',
          name: 'Timber Twister',
          zone_id: Z_FAIRYTALE,
          status: 'OPEN',
          wait_time: 25,
          capacity_per_hour: 900,
          criticality: 3,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'c2000001-0000-4000-8000-000000000004',
          name: 'Harbor Carousel',
          zone_id: Z_NORDIC,
          status: 'OPEN',
          wait_time: 15,
          capacity_per_hour: 600,
          criticality: 2,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'c2000001-0000-4000-8000-000000000005',
          name: 'Lagoon Splash',
          zone_id: Z_MED,
          status: 'MAINTENANCE',
          wait_time: 0,
          capacity_per_hour: 800,
          criticality: 4,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'c2000001-0000-4000-8000-000000000006',
          name: 'Plaza Panorama Wheel',
          zone_id: Z_PLAZA,
          status: 'OPEN',
          wait_time: 20,
          capacity_per_hour: 700,
          criticality: 3,
          created_at: now,
          updated_at: now,
        },
      ],
      {}
    );

    await queryInterface.bulkInsert(
      'staff',
      [
        {
          id: 'd3000001-0000-4000-8000-000000000001',
          first_name: 'Lena',
          last_name: 'Vogt',
          role: 'FOOD_SERVICE',
          current_zone_id: Z_MED,
          available: true,
          skill_level: 4,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000002',
          first_name: 'Jonas',
          last_name: 'Weber',
          role: 'FOOD_SERVICE',
          current_zone_id: Z_NORDIC,
          available: true,
          skill_level: 3,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000003',
          first_name: 'Mira',
          last_name: 'Keller',
          role: 'RIDE_OPERATOR',
          current_zone_id: Z_ALPINE,
          available: true,
          skill_level: 5,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000004',
          first_name: 'Felix',
          last_name: 'Brandt',
          role: 'SECURITY',
          current_zone_id: Z_PLAZA,
          available: true,
          skill_level: 4,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000005',
          first_name: 'Sofia',
          last_name: 'Richter',
          role: 'CLEANING',
          current_zone_id: Z_ALPINE,
          available: true,
          skill_level: 3,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000006',
          first_name: 'Noah',
          last_name: 'Schmidt',
          role: 'GUEST_SERVICE',
          current_zone_id: Z_FAIRYTALE,
          available: false,
          skill_level: 4,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000007',
          first_name: 'Elias',
          last_name: 'Neumann',
          role: 'FOOD_SERVICE',
          current_zone_id: Z_PLAZA,
          available: true,
          skill_level: 2,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'd3000001-0000-4000-8000-000000000008',
          first_name: 'Hannah',
          last_name: 'Koch',
          role: 'SECURITY',
          current_zone_id: Z_MED,
          available: true,
          skill_level: 5,
          created_at: now,
          updated_at: now,
        },
      ],
      {}
    );

    const ev1 = 'e4000001-0000-4000-8000-000000000001';
    const ev2 = 'e4000001-0000-4000-8000-000000000002';

    await queryInterface.bulkInsert(
      'crowd_events',
      [
        {
          id: ev1,
          zone_id: Z_ALPINE,
          event_type: 'CROWD_SPIKE',
          crowd_level: 7200,
          severity: 4,
          source: 'sensor-fusion',
          created_at: now,
        },
        {
          id: ev2,
          zone_id: Z_MED,
          event_type: 'RIDE_CLOSURE',
          crowd_level: 2800,
          severity: 2,
          source: 'operations-console',
          created_at: now,
        },
      ],
      {}
    );

    await queryInterface.bulkInsert(
      'recommendations',
      [
        {
          id: 'f5000001-0000-4000-8000-000000000001',
          event_id: ev1,
          recommendation_type: 'SEND_SECURITY',
          priority: 'HIGH',
          message: 'Alpine Summit crowd pressure elevated; pre-position security near queue merges.',
          status: 'OPEN',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'f5000001-0000-4000-8000-000000000002',
          event_id: ev1,
          recommendation_type: 'GUEST_ROUTING',
          priority: 'HIGH',
          message: 'Silver Comet wait exceeds 45 minutes; route guests to Nordic Harbor family rides.',
          status: 'OPEN',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'f5000001-0000-4000-8000-000000000003',
          event_id: ev2,
          recommendation_type: 'GUEST_ROUTING',
          priority: 'MEDIUM',
          message: 'Lagoon Splash is in maintenance; communicate alternate water play in Nordic Harbor.',
          status: 'ACCEPTED',
          created_at: now,
          updated_at: now,
        },
      ],
      {}
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('recommendations', null, {});
    await queryInterface.bulkDelete('crowd_events', null, {});
    await queryInterface.bulkDelete('staff', null, {});
    await queryInterface.bulkDelete('rides', null, {});
    await queryInterface.bulkDelete('zones', null, {});
  },
};
