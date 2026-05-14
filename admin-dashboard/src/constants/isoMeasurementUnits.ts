/**
 * Curated SI / ISO 80000-style units plus common engineering / customary symbols
 * for OT dashboards. Stored values match the labels (Sparkplug / UNS friendly).
 */
export type IsoMeasurementUnitGroup = {
  /** i18n key under `pdmPage` */
  categoryKey: string
  units: string[]
}

export const ISO_MEASUREMENT_UNIT_GROUPS: IsoMeasurementUnitGroup[] = [
  { categoryKey: 'isoUnitGroup_temperature', units: ['°C', '°F', 'K'] },
  {
    categoryKey: 'isoUnitGroup_pressure',
    units: ['Pa', 'hPa', 'kPa', 'MPa', 'bar', 'mbar', 'psi', 'inHg', 'mmHg'],
  },
  {
    categoryKey: 'isoUnitGroup_electrical',
    units: ['V', 'mV', 'kV', 'A', 'mA', 'Ω', 'mΩ', 'kΩ', 'W', 'kW', 'MW', 'VA', 'var', 'Hz'],
  },
  { categoryKey: 'isoUnitGroup_length_mass', units: ['m', 'mm', 'cm', 'km', 'in', 'ft', 'kg', 'g', 'lb', 't'] },
  { categoryKey: 'isoUnitGroup_time', units: ['s', 'ms', 'min', 'h', 'd'] },
  { categoryKey: 'isoUnitGroup_kinematic', units: ['m/s', 'm/s²', 'km/h', 'mm/s', 'ft/s', 'mph'] },
  { categoryKey: 'isoUnitGroup_rotation', units: ['rpm', 'rad/s'] },
  { categoryKey: 'isoUnitGroup_angle', units: ['°', 'rad'] },
  {
    categoryKey: 'isoUnitGroup_fluid',
    units: ['m³', 'L', 'mL', 'm³/h', 'm³/s', 'L/min', 'L/h', 'gal/min', 'gal/h', 'ft³/min'],
  },
  {
    categoryKey: 'isoUnitGroup_force_energy',
    units: ['N', 'kN', 'lbf', 'N·m', 'ft·lbf', 'J', 'kJ', 'MJ', 'kWh', 'BTU'],
  },
  { categoryKey: 'isoUnitGroup_dimensionless', units: ['%', 'ppm', 'ppb'] },
]

/** Select sentinel: show free-text field for non-listed units */
export const PDM_UNIT_CHOICE_CUSTOM = '__custom__'
