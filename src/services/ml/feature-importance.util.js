/**
 * Map normalized importances to API "impact" labels.
 * @param {Record<string, number>} importance
 * @param {number} [topN]
 */
function topFactorsFromImportance(importance, topN = 5) {
  const entries = Object.entries(importance || {})
    .filter(([k]) => k && !k.startsWith('_'))
    .map(([feature, w]) => ({ feature, w: Number(w) || 0 }))
    .sort((a, b) => b.w - a.w)
    .slice(0, topN);
  if (!entries.length) return [];
  const max = entries[0].w || 1;
  return entries.map((e, i) => {
    const rel = e.w / max;
    let impact = 'LOW';
    if (i === 0 || rel >= 0.65) impact = 'HIGH';
    else if (rel >= 0.35 || i <= 2) impact = 'MEDIUM';
    return { feature: e.feature, impact };
  });
}

module.exports = { topFactorsFromImportance };
