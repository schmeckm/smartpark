const { asyncHandler } = require('../../utils/async-handler');
const { AppError } = require('../../utils/app-error');
const { OperationalContextService } = require('../../services/operational-context.service');

const operationalContextService = new OperationalContextService();

const listParks = asyncHandler(async (_req, res) => {
  const { Park } = require('../../models');
  const data = await Park.findAll({ order: [['name', 'ASC']] });
  res.json({ success: true, data });
});

/** Platform `park_zones` for a park (UUID) — used by master-data asset `zone_id` assignment. */
const listParkZones = asyncHandler(async (req, res) => {
  const { Park, ParkZone } = require('../../models');
  const park = await Park.findByPk(req.params.parkId);
  if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });
  const rows = await ParkZone.findAll({
    where: { parkId: park.id },
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
    attributes: ['id', 'parkId', 'name', 'slug', 'parentZoneId', 'sortOrder', 'externalEntityId'],
  });
  res.json({ success: true, data: rows });
});

const getOperationalContext = asyncHandler(async (req, res) => {
  const { parkId } = req.params;
  const at = req.query.at ?? undefined;
  const data = await operationalContextService.getOperationalContext(parkId, { at });
  res.json({ success: true, data });
});

const patchParkLevel0 = asyncHandler(async (req, res) => {
  const { Park } = require('../../models');
  const body = req.validated || req.body;
  const park = await Park.findByPk(req.params.parkId);
  if (!park) throw new AppError('Park not found', 404, { code: 'NOT_FOUND' });

  const patch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.slug !== undefined) patch.slug = body.slug;
  if (body.timezone !== undefined) patch.timezone = body.timezone || null;
  if (body.latitude !== undefined) patch.latitude = body.latitude;
  if (body.longitude !== undefined) patch.longitude = body.longitude;
  if (body.level0 !== undefined || body.sparkplug !== undefined) {
    const current = park.masterProfile && typeof park.masterProfile === 'object' ? park.masterProfile : {};
    const next = { ...current };
    if (body.level0 !== undefined) next.level0 = body.level0 || {};
    if (body.sparkplug !== undefined) next.sparkplug = body.sparkplug || {};
    patch.masterProfile = next;
  }

  await park.update(patch);
  res.json({ success: true, data: park });
});

module.exports = { listParks, listParkZones, getOperationalContext, patchParkLevel0 };
