const { asyncHandler } = require('../../utils/async-handler');
const { OperationalContextService } = require('../../services/operational-context.service');

const operationalContextService = new OperationalContextService();

const listParks = asyncHandler(async (_req, res) => {
  const { Park } = require('../../models');
  const data = await Park.findAll({ order: [['name', 'ASC']] });
  res.json({ success: true, data });
});

const getOperationalContext = asyncHandler(async (req, res) => {
  const { parkId } = req.params;
  const at = req.query.at != null ? req.query.at : undefined;
  const data = await operationalContextService.getOperationalContext(parkId, { at });
  res.json({ success: true, data });
});

module.exports = { listParks, getOperationalContext };
