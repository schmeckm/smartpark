'use strict';

/**
 * Phase C3.1 — extracted from `IntegrationOrchestratorService`.
 *
 * Owns the user-managed manual UNS node list persisted under the
 * `uns.manualNodes` setting. The orchestrator continues to expose the
 * three legacy methods (`listManualUnsNodes`, `addManualUnsNode`,
 * `removeManualUnsNode`); they now delegate here. No behavior change.
 *
 * The service is intentionally **stateless wrt selected park**: callers
 * pass `{ provider, externalParkId }` explicitly so the service can be
 * unit-tested without a settings snapshot. The orchestrator resolves
 * the selected park before delegating.
 *
 * Lock-in covered by:
 *   - `manual-uns-node.service.test.js` (this commit)
 *   - `integration-orchestrator.service.contract.test.js` (Phase C3.0)
 */

const { randomUUID } = require('node:crypto');
const { AppSettingRepository } = require('../../../repositories/app-setting.repository');
const { slugifyName } = require('../../../utils/slugify.util');
const { resolveThemeParksPublicationDomain } = require('../../uns/theme-parks-entity-domain.service');

const SETTING_KEY = 'uns.manualNodes';

/**
 * @typedef {object} ParkScope
 * @property {string} provider
 * @property {string} externalParkId
 *
 * @typedef {object} ManualNodeInput
 * @property {string} [domain]
 * @property {string} [assetSlug]
 * @property {string} [assetName]
 * @property {string} [metric]
 * @property {string} [entityType]
 *
 * @typedef {object} ManualNodeRow
 * @property {string} id
 * @property {string} provider
 * @property {string} externalParkId
 * @property {string} domain
 * @property {string} assetSlug
 * @property {string} metric
 * @property {string} assetName
 * @property {string|null} entityType
 * @property {'MANUAL'} source
 * @property {string} createdAt
 */

class ManualUnsNodeService {
  /**
   * @param {{ settingRepository?: { getValue: Function, upsertValue: Function } }} [deps]
   */
  constructor(deps = {}) {
    this.settingRepository = deps.settingRepository || new AppSettingRepository();
  }

  /**
   * Return all manual UNS nodes scoped to the given park.
   * @param {ParkScope} scope
   * @returns {Promise<ManualNodeRow[]>}
   */
  async list(scope) {
    const all = await this.settingRepository.getValue(SETTING_KEY, []);
    if (!Array.isArray(all)) return [];
    return all.filter(
      (r) => r?.provider === scope.provider && r?.externalParkId === scope.externalParkId
    );
  }

  /**
   * Append a manual UNS node row for the given park. Returns the new row.
   * @param {ParkScope & { input: ManualNodeInput }} args
   * @returns {Promise<ManualNodeRow>}
   */
  async add({ provider, externalParkId, input }) {
    const all = await this.settingRepository.getValue(SETTING_KEY, []);
    const rows = Array.isArray(all) ? all : [];
    const entityType =
      input.entityType != null && String(input.entityType).trim() !== ''
        ? String(input.entityType).trim().toUpperCase()
        : null;
    const row = {
      id: randomUUID(),
      provider,
      externalParkId,
      domain:
        input.domain != null && String(input.domain).trim() !== ''
          ? slugifyName(input.domain)
          : resolveThemeParksPublicationDomain(null, entityType),
      assetSlug: slugifyName(input.assetSlug || input.assetName),
      metric: slugifyName(input.metric),
      assetName: input.assetName || input.assetSlug,
      entityType,
      source: 'MANUAL',
      createdAt: new Date().toISOString(),
    };
    rows.push(row);
    await this.settingRepository.upsertValue(SETTING_KEY, rows);
    return row;
  }

  /**
   * Remove a manual UNS node row by id, scoped to the given park.
   * Returns `true` if a row was removed, `false` otherwise.
   * @param {ParkScope & { id: string }} args
   * @returns {Promise<boolean>}
   */
  async remove({ provider, externalParkId, id }) {
    const all = await this.settingRepository.getValue(SETTING_KEY, []);
    const rows = Array.isArray(all) ? all : [];
    const next = rows.filter(
      (r) => !(r?.id === id && r?.provider === provider && r?.externalParkId === externalParkId)
    );
    await this.settingRepository.upsertValue(SETTING_KEY, next);
    return rows.length !== next.length;
  }
}

module.exports = { ManualUnsNodeService, MANUAL_UNS_NODES_SETTING_KEY: SETTING_KEY };
