/**
 * Dedupe top influencing factors by coarse group so UI/API do not show
 * redundant lines (e.g. staffing heuristic vs ML staffing code).
 */

function parseImpactMinutes(impact) {
  if (impact == null) return 0;
  const m = String(impact).match(/(-?\d+)/);
  return m ? Math.abs(parseInt(m[1], 10)) : 0;
}

/**
 * @param {string} feature
 * @returns {string}
 */
function factorGroup(feature) {
  const f = String(feature || '').toLowerCase();
  if (f.includes('staffing') || f === 'staffing_gap' || f.includes('staffing_gap')) return 'STAFFING';
  if (f.includes('rain') || f.includes('precipitation') || f.includes('weather') || f.includes('heat')) return 'WEATHER';
  if (f.includes('holiday') || f.includes('school') || f.includes('calendar') || f.includes('weekend') || f.includes('summer_season')) return 'HOLIDAY';
  if (f.includes('traffic')) return 'TRAFFIC';
  if (f.includes('capacity') || f.includes('throughput') || f.includes('queue_elasticity')) return 'CAPACITY';
  if (f.includes('macro') || f.includes('tourism') || f.includes('economy')) return 'MACRO';
  if (f.includes('event') || f.includes('visitor_wave')) return 'EVENT';
  return 'OTHER';
}

/**
 * @param {Array<{ feature?: string, impact?: string, detail?: string }>} factors
 * @returns {typeof factors}
 */
function dedupeInfluencingFactorsByGroup(factors) {
  if (!Array.isArray(factors) || !factors.length) return [];
  const bestByGroup = new Map();
  for (const row of factors) {
    if (!row || !row.feature) continue;
    const g = factorGroup(row.feature);
    const score = parseImpactMinutes(row.impact);
    const prev = bestByGroup.get(g);
    if (!prev || score >= parseImpactMinutes(prev.impact)) {
      bestByGroup.set(g, { ...row, factorGroup: g });
    }
  }
  const order = ['STAFFING', 'WEATHER', 'HOLIDAY', 'TRAFFIC', 'CAPACITY', 'MACRO', 'EVENT', 'OTHER'];
  const out = [];
  for (const g of order) {
    if (bestByGroup.has(g)) out.push(bestByGroup.get(g));
  }
  return out.slice(0, 12);
}

module.exports = { factorGroup, dedupeInfluencingFactorsByGroup, parseImpactMinutes };
