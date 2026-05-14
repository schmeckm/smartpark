'use strict';

const { ParkDemandForecast5m } = require('../../models');
const { DemandPressureService } = require('./demand-pressure.service');
const {
  computeProbabilisticAdditionalDemand,
  mapForecastStatus,
  buildRecommendations,
  computeConfidenceScore,
  buildExplanationJson,
} = require('./attendance-risk-math');

function plainRow(m) {
  if (!m) return null;
  return m.get ? m.get({ plain: true }) : m;
}

class ParkDemandForecastService {
  constructor(deps = {}) {
    this.demandPressure = deps.demandPressureService || new DemandPressureService();
    this.ParkDemandForecast5mModel = deps.ParkDemandForecast5m || ParkDemandForecast5m;
  }

  /**
   * @param {string} parkId
   * @param {object} payload
   * @param {Record<string, boolean>} [payloadFlags] which optional scores were explicitly sent
   */
  async runForecast(parkId, payload, payloadFlags = {}) {
    const planned_demand = Math.max(0, Math.round(Number(payload.plannedDemand) || 0));
    const known_registered_expected = Math.max(0, Math.round(Number(payload.knownRegisteredExpected) || 0));
    const planned_total = planned_demand + known_registered_expected;

    const weather_score = payload.weatherScore != null ? Number(payload.weatherScore) : 0;
    const holiday_score = payload.holidayScore != null ? Number(payload.holidayScore) : 0;
    const event_score = payload.eventScore != null ? Number(payload.eventScore) : 0;
    const parking_pressure_score = payload.parkingPressureScore != null ? Number(payload.parkingPressureScore) : 0;

    const { traffic_pressure_score, corridorSnapshotCount } = await this.demandPressure.computeTrafficPressureForPark(
      parkId
    );

    const external_demand_pressure_score = this.demandPressure.computeExternalDemandPressureFromComponents({
      traffic_pressure_score,
      parking_pressure_score,
      weather_score,
      holiday_score,
      event_score,
    });

    const prob = computeProbabilisticAdditionalDemand(planned_total, external_demand_pressure_score);
    const status = mapForecastStatus(external_demand_pressure_score);
    const recommendations = buildRecommendations(status);
    const confidence_score = computeConfidenceScore({
      corridorSnapshotCount,
      weatherProvided: !!payloadFlags.weatherScore,
      holidayProvided: !!payloadFlags.holidayScore,
      eventProvided: !!payloadFlags.eventScore,
      parkingProvided: !!payloadFlags.parkingPressureScore,
    });

    const explanation_json = buildExplanationJson({
      traffic_pressure_score,
      external_demand_pressure_score,
    });

    const snapshotTs = new Date();

    const row = await this.ParkDemandForecast5mModel.create({
      parkId,
      snapshotTs,
      plannedDemand: planned_demand,
      knownRegisteredExpected: known_registered_expected,
      plannedTotal: planned_total,
      trafficPressureScore: traffic_pressure_score,
      weatherScore: weather_score,
      holidayScore: holiday_score,
      eventScore: event_score,
      parkingPressureScore: parking_pressure_score,
      externalDemandPressureScore: external_demand_pressure_score,
      additionalDemandLow: prob.additional_demand_low,
      additionalDemandMid: prob.additional_demand_mid,
      additionalDemandHigh: prob.additional_demand_high,
      expectedAttendanceLow: prob.expected_attendance_low,
      expectedAttendanceMid: prob.expected_attendance_mid,
      expectedAttendanceHigh: prob.expected_attendance_high,
      status,
      confidenceScore: confidence_score,
      recommendationsJson: recommendations,
      explanationJson: explanation_json,
    });

    return plainRow(row);
  }

  async getLatest(parkId) {
    const row = await this.ParkDemandForecast5mModel.findOne({
      where: { parkId },
      order: [['snapshotTs', 'DESC']],
    });
    return row ? plainRow(row) : null;
  }

  async getHistory(parkId, limit = 96) {
    const rows = await this.ParkDemandForecast5mModel.findAll({
      where: { parkId },
      order: [['snapshotTs', 'DESC']],
      limit,
    });
    return rows.map((r) => plainRow(r));
  }
}

module.exports = { ParkDemandForecastService };
