const express = require('express');
const { parksRouter } = require('./parks.routes');
const { unsRouter } = require('./uns.routes');
const { devicesRouter } = require('./devices.routes');
const { mqttRouter } = require('./mqtt.routes');
const { dashboardRouter } = require('./dashboard.routes');
const { forecastRouter } = require('./forecast.routes');

const api = express.Router();

api.use('/parks', parksRouter);
api.use('/parks/:parkId/uns', unsRouter);
api.use('/parks/:parkId/devices', devicesRouter);
api.use('/parks/:parkId/dashboard', dashboardRouter);
api.use('/parks/:parkId/forecast', forecastRouter);
api.use('/mqtt', mqttRouter);

module.exports = { apiRouter: api };
