/**
 * Typed master profile (JSONB), template completeness, and derived KPI fields.
 * Provider sync must not write `master_profile`; curated paths can be locked via
 * `enrichment.locks.masterProfile` (array of top-level keys).
 */

function isPresent(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return true;
}

/**
 * Flatten profile + specialization rows for template required-field checks.
 * @param {Record<string, unknown>} masterProfile
 * @param {Record<string, unknown>} [rideMaster]
 * @param {Record<string, unknown>} [showMaster]
 * @param {Record<string, unknown>} [restaurantMaster]
 */
function flattenTypedValues(masterProfile, rideMaster, showMaster, restaurantMaster) {
  const mp = masterProfile && typeof masterProfile === 'object' ? { ...masterProfile } : {};
  const rm = rideMaster && typeof rideMaster === 'object' ? rideMaster : {};
  const sm = showMaster && typeof showMaster === 'object' ? showMaster : {};
  const rtm = restaurantMaster && typeof restaurantMaster === 'object' ? restaurantMaster : {};
  const out = { ...mp };
  const rideAliases = {
    dispatch_interval_sec: rm.dispatchIntervalSec,
    theoretical_capacity_per_hour: rm.theoreticalCapacityPph,
    target_throughput_per_hour: rm.capacityPph,
    seats_per_vehicle: rm.seatsPerCycle,
    vehicles_count: rm.trainsCount,
  };
  for (const [k, v] of Object.entries(rideAliases)) {
    if (!isPresent(out[k]) && v != null) out[k] = v;
  }
  Object.assign(out, sm, rtm);
  return out;
}

/**
 * @param {string[]} requiredKeys
 * @param {Record<string, unknown>} flat
 * @param {{ name?: string, timezone?: string|null }} [parkRow] for park_name / timezone aliases
 */
function profileCompleteness(requiredKeys, flat, parkRow) {
  if (!Array.isArray(requiredKeys) || requiredKeys.length === 0) return 'INCOMPLETE';
  for (const key of requiredKeys) {
    let v = flat[key];
    if (key === 'park_name' && parkRow && !isPresent(v)) v = parkRow.name;
    if (key === 'timezone' && parkRow && !isPresent(v)) v = parkRow.timezone;
    if (!isPresent(v)) return 'INCOMPLETE';
  }
  return 'COMPLETE';
}

function computeRideDerived(flat) {
  const dispatch = Number(flat.dispatch_interval_sec);
  const seats = Number(flat.seats_per_vehicle ?? flat.seatsPerCycle);
  const vehicles = Number(flat.vehicles_count ?? flat.trainsCount);
  let calculated_capacity_per_hour = null;
  if (dispatch > 0 && seats >= 0 && vehicles >= 0) {
    calculated_capacity_per_hour = Math.floor((3600 / dispatch) * seats * vehicles);
  }
  const theoretical = Number(flat.theoretical_capacity_per_hour ?? flat.theoreticalCapacityPph);
  const target = Number(flat.target_throughput_per_hour ?? flat.capacityPph);
  let effective_capacity_per_hour = null;
  if (Number.isFinite(theoretical) && Number.isFinite(target)) {
    effective_capacity_per_hour = Math.min(theoretical, target);
  } else if (Number.isFinite(theoretical)) effective_capacity_per_hour = theoretical;
  else if (Number.isFinite(target)) effective_capacity_per_hour = target;
  return { calculated_capacity_per_hour, effective_capacity_per_hour };
}

function computeShowDerived(flat) {
  const cap = Number(flat.venue_capacity);
  const spd = Number(flat.shows_per_day_target);
  let theoretical_guests_per_day = null;
  if (Number.isFinite(cap) && Number.isFinite(spd)) theoretical_guests_per_day = cap * spd;
  return { theoretical_guests_per_day };
}

function computeRestaurantDerived(flat) {
  const regs = Number(flat.cash_registers);
  const svcMin = Number(flat.avg_service_time_min);
  let calculated_service_capacity_per_hour = null;
  if (Number.isFinite(regs) && svcMin > 0) {
    calculated_service_capacity_per_hour = regs * (60 / svcMin);
  }
  const seating = Number(flat.seating_capacity);
  const turn = Number(flat.table_turnover_time_min);
  let calculated_seating_throughput_per_hour = null;
  if (Number.isFinite(seating) && turn > 0) {
    calculated_seating_throughput_per_hour = seating * (60 / turn);
  }
  return { calculated_service_capacity_per_hour, calculated_seating_throughput_per_hour };
}

/** @param {{ defaultValuesJson?: unknown, requiredFieldsJson?: unknown }|null} template */
function mergeTemplateDefaults(masterProfile, enrichment, template) {
  if (!template || typeof template !== 'object') return masterProfile && typeof masterProfile === 'object' ? { ...masterProfile } : {};
  const locks = new Set(
    enrichment && typeof enrichment === 'object' && Array.isArray(enrichment.locks?.masterProfile)
      ? enrichment.locks.masterProfile
      : []
  );
  const defaults =
    template.defaultValuesJson && typeof template.defaultValuesJson === 'object' ? template.defaultValuesJson : {};
  const next = masterProfile && typeof masterProfile === 'object' ? { ...masterProfile } : {};
  for (const [k, v] of Object.entries(defaults)) {
    if (locks.has(k)) continue;
    if (!isPresent(next[k])) next[k] = v;
  }
  return next;
}

/** Like mergeTemplateDefaults but overwrites existing curated keys (still respects locks). */
function mergeTemplateOverride(masterProfile, enrichment, template) {
  if (!template || typeof template !== 'object') return masterProfile && typeof masterProfile === 'object' ? { ...masterProfile } : {};
  const locks = new Set(
    enrichment && typeof enrichment === 'object' && Array.isArray(enrichment.locks?.masterProfile)
      ? enrichment.locks.masterProfile
      : []
  );
  const defaults =
    template.defaultValuesJson && typeof template.defaultValuesJson === 'object' ? template.defaultValuesJson : {};
  const next = masterProfile && typeof masterProfile === 'object' ? { ...masterProfile } : {};
  for (const [k, v] of Object.entries(defaults)) {
    if (locks.has(k)) continue;
    next[k] = v;
  }
  return next;
}

/**
 * Staffing chain validation: min <= normal <= peak when all three are numeric.
 * @returns {string|null} error message or null
 */
function mergeProfilePatch(existingProfile, incoming, locksMasterProfileSet) {
  const next = existingProfile && typeof existingProfile === 'object' ? { ...existingProfile } : {};
  if (!incoming || typeof incoming !== 'object') return next;
  for (const [k, v] of Object.entries(incoming)) {
    if (locksMasterProfileSet.has(k)) continue;
    next[k] = v;
  }
  return next;
}

function validateStaffingChain(flat) {
  const a = flat.employees_required_min;
  const b = flat.employees_required_normal;
  const c = flat.employees_required_peak;
  if (![a, b, c].every((x) => x === null || x === undefined || x === '' || Number.isFinite(Number(x)))) return null;
  const na = Number(a);
  const nb = Number(b);
  const nc = Number(c);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || !Number.isFinite(nc)) return null;
  if (na > nb || nb > nc) return 'employees_required_min must be <= employees_required_normal <= employees_required_peak';
  return null;
}

module.exports = {
  isPresent,
  flattenTypedValues,
  profileCompleteness,
  computeRideDerived,
  computeShowDerived,
  computeRestaurantDerived,
  mergeTemplateDefaults,
  mergeTemplateOverride,
  mergeProfilePatch,
  validateStaffingChain,
};
