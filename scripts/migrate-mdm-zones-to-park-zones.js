/* eslint-disable no-console */
'use strict';

/**
 * Übernimmt MDM-Katalog-Zonen (`mdm_park_zones` + `mdm_parks`) nach Plattform-`park_zones`,
 * damit Asset-Daten / `park_assets.zone_id` echte Themengebiete nutzen können (nicht nur die
 * ThemeParks-Default-Zone „General“ aus `findOrCreateDefaultZone`).
 *
 * Park-Zuordnung: `parks.slug` gleich `mdm_parks.code` (Groß/Kleinschreibung egal).
 *
 * Wiederholbar: `park_zones.external_entity_id` = `mdm:<uuid_der_mdm_park_zone>`.
 *
 * Usage:
 *   node scripts/migrate-mdm-zones-to-park-zones.js
 *   node scripts/migrate-mdm-zones-to-park-zones.js --dry-run
 */

require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { Op } = require('sequelize');
const { sequelize, MdmPark, MdmParkZone, Park, ParkZone } = require(path.join(__dirname, '..', 'src', 'models'));

const DRY = process.argv.includes('--dry-run');

function slugFromCode(code) {
  const s = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s || 'zone').slice(0, 128);
}

async function resolvePlatformPark(mdmPark) {
  const code = String(mdmPark.code || '').trim();
  if (!code) return null;
  let p = await Park.findOne({ where: { slug: code } });
  if (p) return p;
  p = await Park.findOne({ where: { slug: { [Op.iLike]: code } } });
  return p || null;
}

async function uniqueSlugForPark(parkId, baseSlug) {
  let slug = baseSlug.slice(0, 128);
  for (let n = 0; n < 500; n += 1) {
    const clash = await ParkZone.findOne({ where: { parkId, slug } });
    if (!clash) return slug;
    const suffix = `_m${n + 1}`;
    slug = `${baseSlug.slice(0, 128 - suffix.length)}${suffix}`;
  }
  throw new Error(`Konnte keinen freien Slug für parkId=${parkId} ableiten (Basis: ${baseSlug}).`);
}

async function migrate() {
  const mdmParks = await MdmPark.findAll({ order: [['code', 'ASC']] });
  if (!mdmParks.length) {
    console.log('Keine mdm_parks — nichts zu tun.');
    return;
  }

  let parksMatched = 0;
  let zonesCreated = 0;
  let zonesUpdated = 0;
  let skippedNoPark = 0;

  for (const mp of mdmParks) {
    const platformPark = await resolvePlatformPark(mp);
    if (!platformPark) {
      console.warn(`[skip] MDM-Park code=${mp.code}: kein Platform-Park mit passendem slug.`);
      skippedNoPark += 1;
      continue;
    }
    parksMatched += 1;

    const zones = await MdmParkZone.findAll({
      where: { parkId: mp.id },
      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
      ],
    });

    for (const z of zones) {
      const ext = `mdm:${z.id}`;
      const baseSlug = slugFromCode(z.code);
      const existing = await ParkZone.findOne({
        where: { parkId: platformPark.id, externalEntityId: ext },
      });

      if (existing) {
        if (DRY) {
          console.log(`[dry-run] update zone ${ext} → ${z.name} (sort ${z.sortOrder})`);
        } else {
          await existing.update({
            name: z.name,
            sortOrder: z.sortOrder ?? 0,
          });
        }
        zonesUpdated += 1;
        continue;
      }

      const slug = await uniqueSlugForPark(platformPark.id, baseSlug);
      if (DRY) {
        console.log(`[dry-run] create park_zone park=${platformPark.slug} slug=${slug} name=${z.name} ext=${ext}`);
        zonesCreated += 1;
        continue;
      }

      await ParkZone.create({
        parkId: platformPark.id,
        name: z.name,
        slug,
        sortOrder: z.sortOrder ?? 0,
        externalEntityId: ext,
        parentZoneId: null,
      });
      zonesCreated += 1;
    }
  }

  console.log(
    DRY
      ? `[dry-run] Fertig. Platform-Parks mit Treffer: ${parksMatched}, übersprungen (kein Park): ${skippedNoPark}, neue Zonen (simuliert): ${zonesCreated}, Updates (simuliert): ${zonesUpdated}.`
      : `Fertig. Platform-Parks mit Treffer: ${parksMatched}, übersprungen (kein Park): ${skippedNoPark}, neue park_zones: ${zonesCreated}, aktualisiert: ${zonesUpdated}.`,
  );
}

migrate()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
