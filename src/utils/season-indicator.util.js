/**
 * Human-readable labels for Feature Store season codes 1–4 (meteorological quarters).
 * Matches `seasonFromMonth` in ai-snapshot-x-context.service.js.
 * @param {number|null|undefined} seasonCode
 * @returns {{ code: number|null, labelDe: string|null, labelEn: string|null }}
 */
function seasonIndicatorFromCode(seasonCode) {
  const code = Number(seasonCode);
  if (!Number.isFinite(code) || code < 1 || code > 4) {
    return { code: null, labelDe: null, labelEn: null };
  }
  const labels = {
    1: { labelDe: 'Frühling', labelEn: 'Spring' },
    2: { labelDe: 'Sommer', labelEn: 'Summer' },
    3: { labelDe: 'Herbst', labelEn: 'Autumn' },
    4: { labelDe: 'Winter', labelEn: 'Winter' },
  };
  return { code, ...labels[code] };
}

module.exports = { seasonIndicatorFromCode };
