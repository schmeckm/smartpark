/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize, Park, ParkAsset, ShowMasterData } = require(path.join(__dirname, '..', 'src', 'models'));

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SHOW_TARGETS = [
  {
    label: 'Arena of Football',
    showType: 'Arena/Stunt',
    seatsCapacity: 2500,
    showsPerDay: 4,
    estDailyCapacity: 10000,
    aliases: ['arena of football', 'arena_of_football'],
    explicitSlugs: ['arena_of_football_be_part_of_it'],
  },
  {
    label: 'Europa-Park Teatro',
    showType: 'Theater',
    seatsCapacity: 1000,
    showsPerDay: 5,
    estDailyCapacity: 5000,
    aliases: ['europa park teatro', 'europa_park_teatro'],
  },
  {
    label: 'Eisshow',
    showType: 'Ice Show',
    seatsCapacity: 1250,
    showsPerDay: 5,
    estDailyCapacity: 6250,
    aliases: ['eisshow', 'ice show'],
  },
  {
    label: 'Globe Theatre',
    showType: 'Theater',
    seatsCapacity: 500,
    showsPerDay: 6,
    estDailyCapacity: 3000,
    aliases: ['globe theatre', 'globe'],
    explicitSlugs: ['advent_carol_singing_at_the_globe_theater'],
  },
  {
    label: 'Limerick Castle',
    showType: 'Walkthrough/Show',
    seatsCapacity: null,
    showsPerDay: null,
    estDailyCapacity: 10000,
    aliases: ['limerick castle', 'limerick'],
    explicitSlugs: ['limerick_castle'],
  },
  {
    label: 'Parade Europa-Park',
    showType: 'Outdoor Parade',
    seatsCapacity: null,
    showsPerDay: 1,
    estDailyCapacity: 10000,
    aliases: ['parade europa park', 'parade'],
    explicitSlugs: ['ed_s_parade'],
  },
  {
    label: 'Spanish Arena',
    showType: 'Arena Show',
    seatsCapacity: 2000,
    showsPerDay: 3,
    estDailyCapacity: 6000,
    aliases: ['spanish arena'],
  },
  {
    label: 'Junior Club Studio',
    showType: 'Kinder-Show',
    seatsCapacity: 300,
    showsPerDay: 7,
    estDailyCapacity: 2100,
    aliases: ['junior club studio', 'junior club'],
    explicitSlugs: ['happy_birthday_junior_club'],
  },
];

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

  const matched = [];
  const unmatched = [];
  let updated = 0;
  const bySlug = new Map(assets.map((a) => [a.slug, a]));

  if (!dryRun) await sequelize.transaction(async (tx) => {
    for (const t of SHOW_TARGETS) {
      const aliases = t.aliases.map(normalize);
      const found = Array.isArray(t.explicitSlugs) && t.explicitSlugs.length
        ? t.explicitSlugs.map((s) => bySlug.get(s)).find(Boolean)
        : assets.find((a) => aliases.some((alias) => a.nslug.includes(alias) || a.nname.includes(alias)));
      if (!found) {
        unmatched.push(t.label);
        continue;
      }
      await ShowMasterData.upsert(
        {
          assetId: found.assetId,
          showType: t.showType,
          seatsCapacity: t.seatsCapacity,
          showsPerDay: t.showsPerDay,
        },
        { transaction: tx }
      );
      const mergedProfile = {
        ...(found.masterProfile || {}),
        showCapacityProfile: {
          estimatedDailyCapacity: t.estDailyCapacity,
          source: 'manual_capacity_table',
        },
      };
      await ParkAsset.update({ masterProfile: mergedProfile }, { where: { assetId: found.assetId }, transaction: tx });
      matched.push({ label: t.label, slug: found.slug, estDailyCapacity: t.estDailyCapacity });
      updated += 1;
    }
  });

  if (dryRun) {
    for (const t of SHOW_TARGETS) {
      const aliases = t.aliases.map(normalize);
      const found = Array.isArray(t.explicitSlugs) && t.explicitSlugs.length
        ? t.explicitSlugs.map((s) => bySlug.get(s)).find(Boolean)
        : assets.find((a) => aliases.some((alias) => a.nslug.includes(alias) || a.nname.includes(alias)));
      if (!found) unmatched.push(t.label);
      else matched.push({ label: t.label, slug: found.slug, estDailyCapacity: t.estDailyCapacity });
    }
  }

  console.log(`[show-targets] park=${parkSlug} dryRun=${dryRun} matched=${matched.length} updated=${updated}`);
  for (const m of matched) console.log(`  - ${m.label} -> ${m.slug} (daily~${m.estDailyCapacity})`);
  if (unmatched.length) {
    console.log('[show-targets] unmatched entries:');
    for (const u of unmatched) console.log(`  - ${u}`);
  }
}

main()
  .catch((err) => {
    console.error('[show-targets] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });

