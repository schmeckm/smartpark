/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize, Park, ParkAsset, RestaurantMasterData } = require(path.join(__dirname, '..', 'src', 'models'));

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const RESTAURANT_TARGETS = [
  { label: 'FoodLoop', restaurantType: 'Erlebnisrestaurant', seats: 300, guestsPeakH: 600, aliases: ['foodloop'] },
  { label: 'Bamboe Baai', restaurantType: 'Themenrestaurant', seats: 400, guestsPeakH: 750, aliases: ['bamboe baai', 'bamboe_baai'] },
  { label: 'SPICES - Küchen der Welt', restaurantType: 'Buffet', seats: 500, guestsPeakH: 1000, aliases: ['spices', 'spices kuchen der welt'] },
  { label: 'Don Quichotte', restaurantType: 'Table Service', seats: 250, guestsPeakH: 400, aliases: ['don quichotte'] },
  { label: 'Harborside', restaurantType: 'Buffet', seats: 600, guestsPeakH: 1100, aliases: ['harborside'] },
  { label: 'Tre Kronen', restaurantType: 'Nordic Restaurant', seats: 250, guestsPeakH: 500, aliases: ['tre kronen', 'tre kr nen', 'tre_kronen'] },
  { label: 'See-Restaurant', restaurantType: 'Self Service', seats: 350, guestsPeakH: 650, aliases: ['see restaurant', 'see_restaurant', 'seehaus', 'restaurant_seehaus'] },
  { label: 'Sala Santa Isabel', restaurantType: 'Themenrestaurant', seats: 300, guestsPeakH: 600, aliases: ['sala santa isabel', 'sala_santa_isabel'] },
  { label: 'Petit France', restaurantType: 'Schnellrestaurant', seats: 150, guestsPeakH: 400, aliases: ['petit france', 'petit_france', 'restaurant_petite_france'] },
  { label: 'Mack & Wild', restaurantType: 'Fine Dining', seats: 120, guestsPeakH: 150, aliases: ['mack wild', 'mack_and_wild'] },
];

function estimateTurnoverPerHour(seats, guestsPeakH) {
  if (!seats || !guestsPeakH) return null;
  return Math.round((guestsPeakH / seats) * 100) / 100;
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  const parkSlug = 'europa_park';
  const park = await Park.findOne({ where: { slug: parkSlug } });
  if (!park) throw new Error(`Park not found: ${parkSlug}`);

  const rows = await ParkAsset.findAll({
    where: { parkId: park.id },
    attributes: ['assetId', 'slug', 'name', 'masterProfile'],
  });
  const assets = rows.map((r) => ({
    assetId: String(r.assetId),
    slug: String(r.slug || ''),
    name: String(r.name || ''),
    masterProfile: r.masterProfile || {},
    nslug: normalize(r.slug),
    nname: normalize(r.name),
  }));

  let updated = 0;
  const matched = [];
  const unmatched = [];

  if (!dryRun)
    await sequelize.transaction(async (tx) => {
      for (const t of RESTAURANT_TARGETS) {
        const aliases = t.aliases.map(normalize);
        const found = assets.find((a) => aliases.some((alias) => a.nslug.includes(alias) || a.nname.includes(alias)));
        if (!found) {
          unmatched.push(t.label);
          continue;
        }
        const turnover = estimateTurnoverPerHour(t.seats, t.guestsPeakH);
        await RestaurantMasterData.upsert(
          {
            assetId: found.assetId,
            restaurantType: t.restaurantType,
            seatingCapacity: t.seats,
            maxCapacity: t.seats,
            avgTableTurnoverMin: turnover ? Math.round(60 / turnover) : null,
            kitchenCapacityOrdersH: t.guestsPeakH,
          },
          { transaction: tx }
        );

        const mergedProfile = {
          ...(found.masterProfile || {}),
          restaurantCapacityProfile: {
            seats: t.seats,
            guestsPeakPerHour: t.guestsPeakH,
            tableTurnPerHour: turnover,
            theoreticalCapacityPerHour: t.seats && turnover ? Math.round(t.seats * turnover) : null,
            aiUseCases: [
              'lunch_peak_prediction',
              'rain_crowd_shift',
              'dynamic_recommendations',
              'queue_avoidance',
              'revenue_optimization',
              'waste_reduction',
              'staffing_ai',
              'heatmap_integration',
            ],
            source: 'manual_capacity_table',
          },
        };
        await ParkAsset.update({ masterProfile: mergedProfile }, { where: { assetId: found.assetId }, transaction: tx });
        matched.push({ label: t.label, slug: found.slug, seats: t.seats, guestsPeakH: t.guestsPeakH, turnover });
        updated += 1;
      }
    });

  if (dryRun) {
    for (const t of RESTAURANT_TARGETS) {
      const aliases = t.aliases.map(normalize);
      const found = assets.find((a) => aliases.some((alias) => a.nslug.includes(alias) || a.nname.includes(alias)));
      if (!found) unmatched.push(t.label);
      else matched.push({ label: t.label, slug: found.slug, seats: t.seats, guestsPeakH: t.guestsPeakH, turnover: estimateTurnoverPerHour(t.seats, t.guestsPeakH) });
    }
  }

  console.log(`[restaurant-targets] park=${parkSlug} dryRun=${dryRun} matched=${matched.length} updated=${updated}`);
  for (const m of matched) {
    console.log(`  - ${m.label} -> ${m.slug} seats=${m.seats} peak/h=${m.guestsPeakH} turn/h=${m.turnover}`);
  }
  if (unmatched.length) {
    console.log('[restaurant-targets] unmatched entries:');
    for (const u of unmatched) console.log(`  - ${u}`);
  }
}

main()
  .catch((err) => {
    console.error('[restaurant-targets] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });

