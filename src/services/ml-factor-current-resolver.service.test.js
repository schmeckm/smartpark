'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MlFactorCurrentResolverService,
  calculateWeekendCurrent,
  calculateSummerCurrentFromMonth,
  calculateHolidayCurrent,
  calculateSchoolBreakCurrent,
  calculateRainCurrentFromMm,
  pickEffectiveCurrent,
  clampCurrent,
  weekendFromTimeZone,
  monthFromTimeZone,
} = require('./ml-factor-current-resolver.service');

test('WEEKEND_UPLIFT: weekend vs weekday', () => {
  assert.equal(calculateWeekendCurrent(true), 1.0);
  assert.equal(calculateWeekendCurrent(false), 0.0);
});

test('weekendFromTimeZone: Saturday in Europe/Berlin', () => {
  const d = new Date('2026-06-06T22:00:00.000Z');
  assert.equal(weekendFromTimeZone(d, 'Europe/Berlin'), true);
});

test('weekendFromTimeZone: Monday in Europe/Berlin', () => {
  const d = new Date('2026-06-08T10:00:00.000Z');
  assert.equal(weekendFromTimeZone(d, 'Europe/Berlin'), false);
});

test('SUMMER_SEASON_FACTOR: June–Aug full, May/Sep shoulder, winter off', () => {
  assert.equal(calculateSummerCurrentFromMonth(7), 1.0);
  assert.equal(calculateSummerCurrentFromMonth(5), 0.5);
  assert.equal(calculateSummerCurrentFromMonth(9), 0.5);
  assert.equal(calculateSummerCurrentFromMonth(1), 0);
  assert.equal(calculateSummerCurrentFromMonth(12), 0);
});

test('monthFromTimeZone July in UTC', () => {
  const d = new Date('2026-07-15T12:00:00.000Z');
  assert.equal(monthFromTimeZone(d, 'UTC'), 7);
});

test('HOLIDAY_PRESSURE: holiday true/false', () => {
  assert.equal(calculateHolidayCurrent(true), 1.0);
  assert.equal(calculateHolidayCurrent(false), 0.0);
});

test('SCHOOL_BREAK_PRESSURE: break true/false', () => {
  assert.equal(calculateSchoolBreakCurrent(true), 1.0);
  assert.equal(calculateSchoolBreakCurrent(false), 0.0);
});

test('RAIN_DEMAND_SHIFT: rain mm normalization', () => {
  assert.equal(calculateRainCurrentFromMm(0), 0);
  assert.equal(calculateRainCurrentFromMm(0.05), 0);
  assert.equal(calculateRainCurrentFromMm(1), 0.3);
  assert.equal(calculateRainCurrentFromMm(4), 0.7);
  assert.equal(calculateRainCurrentFromMm(10), 1.0);
});

test('pickEffectiveCurrent: L2 current wins over calculated', () => {
  const r = pickEffectiveCurrent({
    calculatedCurrent: 0,
    l1GlobalPlain: { currentValue: 1, sourceType: 'MANUAL' },
    parkFactorPlain: { currentValue: 0.9, sourceType: 'MANUAL' },
  });
  assert.equal(r.current, 0.9);
  assert.equal(r.currentSource, 'L2_MANUAL');
  assert.equal(r.calculatedCurrent, 0);
  assert.equal(r.manualCurrentOverride, 0.9);
});

test('pickEffectiveCurrent: L1 API beats calculated when no L2', () => {
  const r = pickEffectiveCurrent({
    calculatedCurrent: 0.5,
    l1GlobalPlain: { currentValue: 0.8, sourceType: 'API' },
    parkFactorPlain: null,
  });
  assert.equal(r.current, 0.8);
  assert.equal(r.currentSource, 'API');
  assert.equal(r.calculatedCurrent, 0.5);
  assert.equal(r.l1ApiCurrent, 0.8);
});

test('pickEffectiveCurrent: calculated when L1 not API and no L2', () => {
  const r = pickEffectiveCurrent({
    calculatedCurrent: 1,
    l1GlobalPlain: { currentValue: 0.2, sourceType: 'MANUAL' },
    parkFactorPlain: {},
  });
  assert.equal(r.current, 1);
  assert.equal(r.currentSource, 'CALCULATED');
});

test('pickEffectiveCurrent: fallback to L1 current when no calculated', () => {
  const r = pickEffectiveCurrent({
    calculatedCurrent: null,
    l1GlobalPlain: { currentValue: 0.75, sourceType: 'MANUAL' },
    parkFactorPlain: {},
  });
  assert.equal(r.current, 0.75);
  assert.equal(r.currentSource, 'L1_CURRENT');
});

test('pickEffectiveCurrent: fallback to L1 default when no current', () => {
  const r = pickEffectiveCurrent({
    calculatedCurrent: null,
    l1GlobalPlain: { defaultValue: 0.6, sourceType: 'MANUAL' },
    parkFactorPlain: {},
  });
  assert.equal(r.current, 0.6);
  assert.equal(r.currentSource, 'L1_DEFAULT');
});

test('clampCurrent: negatives and above cap', () => {
  assert.equal(clampCurrent(-1), 0);
  assert.equal(clampCurrent(2), 1.5);
  assert.equal(clampCurrent(0.5), 0.5);
});

test('resolveCurrentsForMerge: no internalParkId skips DB and returns empty map', async () => {
  const svc = new MlFactorCurrentResolverService();
  const gBy = new Map([
    [
      'WEEKEND_UPLIFT',
      {
        factorCode: 'WEEKEND_UPLIFT',
        currentValue: '1',
        sourceType: 'MANUAL',
        defaultValue: 1,
      },
    ],
  ]);
  const out = await svc.resolveCurrentsForMerge({
    internalParkId: null,
    timestamp: new Date('2026-07-01T12:00:00Z'),
    parkSnap: { is_weekend: true },
    gBy,
    pBy: new Map(),
  });
  assert.equal(out.size, 0);
});
