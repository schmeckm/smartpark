/**
 * Smoke: Add-on Board service (DB) — cache + zones + heatmap + config templates.
 * Run: npm run smoke:addon-board
 */
/* eslint-disable no-console */
require('dotenv').config();
const path = require('node:path');
require(path.join(__dirname, '..', 'src', 'config', 'env'));

const { sequelize, Park, ParkZone } = require(path.join(__dirname, '..', 'src', 'models'));
const { AddonBoardService } = require(path.join(__dirname, '..', 'src', 'services', 'addon-board.service'));
const {
  listAddonBoardTemplateIds,
  getAddonBoardEffectiveLayout,
} = require(path.join(__dirname, '..', 'src', 'services', 'addon-board-config.service'));

async function main() {
  await sequelize.authenticate();
  const park = await Park.findOne({ attributes: ['id'], order: [['name', 'ASC']] });
  if (!park) {
    console.warn('SKIP: no parks');
    process.exit(0);
  }
  const pid = park.id;
  const svc = new AddonBoardService();

  const [s1, s2] = await Promise.all([svc.getParkSummary(pid), svc.getParkSummary(pid)]);
  if (!s1 || !s2 || String(s1.parkId) !== String(pid)) {
    throw new Error('Expected park summary');
  }

  const zones = await svc.listZonesWithRideCounts(pid);
  if (!Array.isArray(zones)) throw new Error('Expected zones array');

  const heat = await svc.getHeatmapLive(pid);
  if (!heat || heat.parkId == null) throw new Error('Expected heatmap envelope');

  const zone = await ParkZone.findOne({ where: { parkId: pid }, attributes: ['id'] });
  if (zone) {
    const zs = await svc.getZoneSummary(pid, zone.id);
    if (zs.error) throw new Error('Zone summary failed');
  }

  const ids = listAddonBoardTemplateIds();
  if (!ids.includes('park-management-default')) {
    throw new Error('Expected default template id');
  }
  const layout = getAddonBoardEffectiveLayout('park-management-default', ['SYSTEM_ADMIN']);
  if (!layout || !Array.isArray(layout.widgets)) throw new Error('Expected layout widgets');

  console.log('OK addon-board smoke', { parkId: String(pid), zones: zones.length, templates: ids.length });
  await sequelize.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
