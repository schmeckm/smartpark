'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../config/addon-board');
const { getPlatformSettingsService } = require('./platform-settings.service');

/** @type {Record<string, unknown> | null} */
let thresholdsCache = null;
/** @type {Map<string, Record<string, unknown>> | null} */
let templatesCache = null;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function getAddonBoardThresholds() {
  if (!thresholdsCache) thresholdsCache = readJson('thresholds-default.json');
  return thresholdsCache;
}

/**
 * JSON thresholds + optional DB override `ADDON_BOARD_FORECAST_CRITICAL_MINUTES` (15–180).
 * @param {string} [parkId] reserved for future per-park JSON overrides
 */
async function resolveAddonBoardThresholds(parkId) {
  void parkId;
  const base = { ...getAddonBoardThresholds() };
  let fc = Number(base.forecastCriticalAtMinutes);
  if (!Number.isFinite(fc)) fc = 55;
  fc = Math.min(180, Math.max(15, Math.round(fc)));
  try {
    const ps = getPlatformSettingsService();
    const v = await ps.getNumber('ADDON_BOARD_FORECAST_CRITICAL_MINUTES', fc);
    if (Number.isFinite(v)) fc = Math.min(180, Math.max(15, Math.round(v)));
  } catch {
    /* ignore */
  }
  base.forecastCriticalAtMinutes = fc;
  return base;
}

function loadTemplatesMap() {
  if (templatesCache) return templatesCache;
  const dir = path.join(ROOT, 'templates');
  if (!fs.existsSync(dir)) {
    templatesCache = new Map();
    return templatesCache;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const map = new Map();
  for (const f of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const id = doc.boardId != null ? String(doc.boardId) : f.replace(/\.json$/i, '');
    map.set(id, doc);
  }
  templatesCache = map;
  return map;
}

function listAddonBoardTemplateIds() {
  return [...loadTemplatesMap().keys()].sort();
}

/** @param {string} boardId */
function getAddonBoardTemplate(boardId) {
  return loadTemplatesMap().get(String(boardId)) || null;
}

/**
 * @param {{ roles?: string[] }} widget
 * @param {string[]} roleCodes
 */
function widgetVisibleForRoles(widget, roleCodes) {
  const roles = widget.roles || widget.visibilityRoles;
  if (!roles || !roles.length) return true;
  const set = new Set(roleCodes.map((r) => String(r)));
  return roles.some((r) => set.has(String(r)));
}

/**
 * @param {string} boardId
 * @param {string[]} roleCodes
 */
function getAddonBoardEffectiveLayout(boardId, roleCodes) {
  const template = getAddonBoardTemplate(boardId);
  if (!template) return null;
  const rawWidgets = Array.isArray(template.widgets) ? template.widgets : [];
  const widgets = rawWidgets.filter((w) => widgetVisibleForRoles(w, roleCodes));
  return {
    boardId: template.boardId != null ? String(template.boardId) : String(boardId),
    label: template.label != null ? String(template.label) : null,
    widgets,
    template,
  };
}

module.exports = {
  getAddonBoardThresholds,
  resolveAddonBoardThresholds,
  listAddonBoardTemplateIds,
  getAddonBoardTemplate,
  getAddonBoardEffectiveLayout,
};
