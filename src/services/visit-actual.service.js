const { VisitActualYearly } = require('../models');

function assertGuestCountsMatchYear(guestCounts, actualYear) {
  const y = String(actualYear);
  if (!guestCounts || typeof guestCounts !== 'object') return;
  for (const k of Object.keys(guestCounts)) {
    const parts = k.split('::');
    if (parts.length !== 2) {
      throw new Error(`INVALID_ACTUAL_DATE_KEY:${k}`);
    }
    const iso = parts[1];
    if (!iso.startsWith(`${y}-`)) {
      throw new Error(`ACTUAL_DATE_OUTSIDE_YEAR:${iso}`);
    }
  }
}

class VisitActualYearlyService {
  async getForParkYear(parkId, actualYear) {
    const row = await VisitActualYearly.findOne({ where: { parkId, actualYear } });
    if (!row) {
      return {
        actualYear,
        guestCounts: {},
        updatedAt: null,
      };
    }
    const plain = row.get({ plain: true });
    return {
      actualYear,
      guestCounts: plain.guest_counts && typeof plain.guest_counts === 'object' ? plain.guest_counts : {},
      updatedAt: plain.updated_at?.toISOString?.() ?? plain.updated_at ?? null,
    };
  }

  async upsertForParkYear(parkId, actualYear, guestCounts) {
    assertGuestCountsMatchYear(guestCounts, actualYear);
    let row = await VisitActualYearly.findOne({ where: { parkId, actualYear } });
    if (!row) {
      row = await VisitActualYearly.create({
        parkId,
        actualYear,
        guestCounts,
      });
    } else {
      row.guestCounts = guestCounts;
      await row.save();
    }
    return this.getForParkYear(parkId, actualYear);
  }
}

module.exports = { VisitActualYearlyService, assertGuestCountsMatchYear };
