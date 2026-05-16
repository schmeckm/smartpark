'use strict';

/** @type {ReadonlyArray<Record<string, unknown>>} */
const KNOWN_MODES = Object.freeze([
  {
    code: 'bearing_wear',
    label: 'Probable bearing wear',
    baseSeverity: 'HIGH',
    explanation: 'Elevated broadband vibration with sustained or increasing trend typical of mechanical bearing degradation.',
    recommendedActions: ['Inspect bearing lubrication and seating', 'Schedule vibration baseline comparison', 'Review recent load changes'],
  },
  {
    code: 'thermal_overload',
    label: 'Thermal overload / lubrication stress',
    baseSeverity: 'HIGH',
    explanation: 'Operating fluid or winding-adjacent temperatures are approaching or beyond warning bands.',
    recommendedActions: ['Verify cooler circuits and filtration', 'Check for blocked airflow / jacket flow', 'Inspect for sustained overload epochs'],
  },
  {
    code: 'motor_instability',
    label: 'Motor / drive instability',
    baseSeverity: 'MEDIUM',
    explanation: 'RPM or power draw shows high variability or spikes inconsistent with steady dispatch modeling.',
    recommendedActions: ['Check VFD / drive parameterization', 'Inspect coupling and mechanical lash', 'Review phasing of multi-motor loads'],
  },
  {
    code: 'hydraulic_instability',
    label: 'Hydraulic instability',
    baseSeverity: 'MEDIUM',
    explanation: 'Hydraulic pressure exhibits abnormal variance or loss-of-line pressure behavior.',
    recommendedActions: ['Inspect accumulators, relief valves, and pump inlet conditions', 'Verify load-sensing setpoints', 'Check for aeration or cavitation precursors'],
  },
  {
    code: 'cavitation',
    label: 'Cavitation risk (pump)',
    baseSeverity: 'HIGH',
    explanation: 'High pump speed with reduced hydraulic delivery suggests possible cavitation or suction restriction.',
    recommendedActions: ['Inspect strainers and suction geometry', 'Verify NPSH margin vs design', 'Reduce aggressiveness temporarily until inspection'],
  },
  {
    code: 'overload',
    label: 'Mechanical / electrical overload',
    baseSeverity: 'HIGH',
    explanation: 'Drive power or torque-proximal metrics indicate sustained overload relative to configured limits.',
    recommendedActions: ['Validate dispatch envelope vs mechanical rating', 'Check for mechanical binding', 'Review braking and peak power phases'],
  },
  {
    code: 'unknown_pattern',
    label: 'Anomalous pattern (unclassified)',
    baseSeverity: 'LOW',
    explanation: 'Telemetry violates thresholds but does not match a high-confidence maintenance archetype yet.',
    recommendedActions: ['Capture Sparkplug export / historian trace', 'Escalate to OT reliability review', 'Add contextual operating phase tags'],
  },
]);

/**
 * Rule-based failure mode inference from evaluated signals + metric trends.
 * @param {Array<Record<string, unknown>>} signals
 * @param {Array<Record<string, unknown>>} metricTrends
 * @returns {Array<Record<string, unknown>>}
 */
function classifyPdFailureModes(signals, metricTrends) {
  const sigs = Array.isArray(signals) ? signals : [];
  const trends = new Map((Array.isArray(metricTrends) ? metricTrends : []).map((t) => [String(t.metricName || ''), t]));

  const byName = (n) => sigs.find((s) => String(s.metricName || '').toLowerCase() === n.toLowerCase());
  const vib = byName('bearing_vibration_mm_s');
  const temp = byName('oil_temperature_c');
  const rpm = byName('motor_rpm');
  const power = byName('motor_power_kw');
  const pumpRpm = byName('pump_rpm');
  const flow = byName('water_flow_l_min');
  const hyd = byName('hydraulic_pressure_bar');

  /** @type {Array<{ code: string; score: number }>} */
  const scored = [];

  function bump(code, amt) {
    const cur = scored.find((x) => x.code === code);
    if (cur) cur.score += amt;
    else scored.push({ code, score: amt });
  }

  if (vib && (vib.status === 'WARN' || vib.status === 'CRITICAL')) {
    const tr = trends.get('bearing_vibration_mm_s');
    const worsening = tr && String(tr.trend) === 'DECLINING';
    bump('bearing_wear', worsening ? 3 : 2);
  }
  if (temp && (temp.status === 'WARN' || temp.status === 'CRITICAL')) bump('thermal_overload', 3);

  const rpmTrend = rpm ? trends.get('motor_rpm') : null;
  const powerTrend = power ? trends.get('motor_power_kw') : null;
  if (
    (rpmTrend && String(rpmTrend.trend) === 'UNSTABLE') ||
    (powerTrend && String(powerTrend.trend) === 'UNSTABLE') ||
    (rpm && rpm.status === 'WARN')
  ) {
    bump('motor_instability', 2);
  }
  if (hyd) {
    const htr = trends.get('hydraulic_pressure_bar');
    if (htr && String(htr.trend) === 'UNSTABLE') bump('hydraulic_instability', 3);
    if (hyd.status === 'WARN' || hyd.status === 'CRITICAL') bump('hydraulic_instability', 2);
  }
  if (pumpRpm && flow) {
    const pumpOk = pumpRpm.value != null && Number(pumpRpm.value) > 0;
    const flowLow = flow.value != null && Number(flow.value) < 60;
    if (pumpOk && flowLow && (flow.status === 'WARN' || flow.status === 'CRITICAL')) bump('cavitation', 2);
  }
  if (power && (power.status === 'CRITICAL' || power.status === 'WARN')) bump('overload', 2);

  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((x) => x.score >= 2);
  if (!top.length) {
    const anyBad = sigs.some((s) => s.status === 'WARN' || s.status === 'CRITICAL' || s.status === 'NO_DATA');
    if (anyBad) bump('unknown_pattern', 1);
  }

  const finalCodes = top.length ? top.map((x) => x.code) : scored.length ? [scored[0].code] : [];
  if (!finalCodes.length && sigs.some((s) => s.status === 'NO_DATA')) {
    finalCodes.push('unknown_pattern');
  }

  const modesByCode = new Map(KNOWN_MODES.map((m) => [String(m.code), m]));
  return finalCodes.slice(0, 4).map((code) => {
    const def = modesByCode.get(code) || modesByCode.get('unknown_pattern');
    const rank = scored.find((s) => s.code === code)?.score || 1;
    let severity = String(def?.baseSeverity || 'LOW');
    if (rank >= 4) severity = severity === 'LOW' ? 'MEDIUM' : severity;
    return {
      code,
      label: def?.label,
      severity,
      explanation: def?.explanation,
      recommendedActions: def?.recommendedActions,
      score: rank,
    };
  });
}

module.exports = {
  classifyPdFailureModes,
  KNOWN_MODES,
};
