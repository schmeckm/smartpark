'use strict';

const { syntheticScheduleFromParkEnrichment } = require('../utils/master-operating-hours.util');
const { evaluateScheduledOperatingHours } = require('../utils/operating-hours-eval.util');

/**
 * @param {object} meta - parkXByKey entry with park, parkX, externalParkId, provider
 * @param {Date} bucketUtc
 * @param {import('../repositories/park-operating-snapshot.repository').ParkOperatingSnapshotRepository} operatingRepo
 */
async function computeParkScheduledOperatingForMeta(meta, bucketUtc, operatingRepo) {
  let withinScheduledOperatingHours = null;
  let scheduledOperatingSnapshotAt = null;
  const { externalParkId, parkX } = meta;
  if (parkX.localDate && meta.park) {
    const parkPlain =
      meta.park && typeof meta.park.get === 'function' ? meta.park.get({ plain: true }) : meta.park || {};
    const masterSchedule = syntheticScheduleFromParkEnrichment(parkPlain.enrichment, parkX.localDate);
    if (masterSchedule) {
      const ev = evaluateScheduledOperatingHours(masterSchedule, bucketUtc, parkX.timezone);
      withinScheduledOperatingHours = ev.within;
      scheduledOperatingSnapshotAt = parkPlain.updatedAt ? new Date(parkPlain.updatedAt) : null;
    } else {
      const extCandidates = [
        ...new Set(
          [externalParkId, parkPlain.externalEntityId, parkPlain.slug]
            .filter((x) => x != null && String(x).trim() !== '')
            .map((x) => String(x).trim())
        ),
      ];
      if (extCandidates.length) {
        const opRow = await operatingRepo.findLatestOpeningRowForLocalDateFirstMatching(
          meta.provider || 'themeparks_wiki',
          extCandidates,
          parkX.localDate
        );
        if (opRow) {
          const ev = evaluateScheduledOperatingHours(opRow.openingTimes, bucketUtc, parkX.timezone);
          withinScheduledOperatingHours = ev.within;
          scheduledOperatingSnapshotAt = opRow.sampledAt || null;
        }
      }
    }
  }
  return { withinScheduledOperatingHours, scheduledOperatingSnapshotAt };
}

module.exports = { computeParkScheduledOperatingForMeta };
