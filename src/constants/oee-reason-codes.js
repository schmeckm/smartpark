/**
 * MVP reason codes for asset downtime (geplant / ungeplant via boolean `planned`).
 * Extend via migration + ADR when CMMS integration arrives.
 */
const OEE_REASON_CODES = Object.freeze([
  'UNPLANNED_MECHANICAL',
  'UNPLANNED_ELECTRICAL',
  'UNPLANNED_CONTROLS',
  'UNPLANNED_WEATHER',
  'UNPLANNED_GUEST',
  /** ThemeParks-/Adapter-Status: Attraktion laut Feed geschlossen (nur während geplanter Parköffnung gespiegelt). */
  'UNPLANNED_ADAPTER_UNAVAILABLE',
  'UNPLANNED_OTHER',
  'PLANNED_MAINTENANCE',
  'PLANNED_INSPECTION',
  'PLANNED_TRAINING',
  'PLANNED_OTHER',
]);

/** @type {Record<string, string>} */
const OEE_REASON_LABELS_DE = Object.freeze({
  UNPLANNED_MECHANICAL: 'Ungeplant — Mechanik',
  UNPLANNED_ELECTRICAL: 'Ungeplant — Elektrik',
  UNPLANNED_CONTROLS: 'Ungeplant — Steuerung/Software',
  UNPLANNED_WEATHER: 'Ungeplant — Wetter',
  UNPLANNED_GUEST: 'Ungeplant — Gäste / EVAC',
  UNPLANNED_ADAPTER_UNAVAILABLE: 'Ungeplant — Adapter / Feed (nicht verfügbar)',
  UNPLANNED_OTHER: 'Ungeplant — Sonstiges',
  PLANNED_MAINTENANCE: 'Geplant — Wartung',
  PLANNED_INSPECTION: 'Geplant — Inspektion / Prüfung',
  PLANNED_TRAINING: 'Geplant — Training / Einweisung',
  PLANNED_OTHER: 'Geplant — Sonstiges',
});

module.exports = { OEE_REASON_CODES, OEE_REASON_LABELS_DE };
