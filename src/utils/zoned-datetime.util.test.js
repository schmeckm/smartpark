const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { utcInstantForZonedWallClock, zonedYmdParts, parseHmToMinutes } = require('./zoned-datetime.util');

describe('zoned-datetime', () => {
  it('resolves Europe/Berlin wall clock to UTC', () => {
    const d = utcInstantForZonedWallClock(2026, 5, 16, 9, 0, 0, 'Europe/Berlin');
    assert.ok(d);
    const p = zonedYmdParts(d, 'Europe/Berlin');
    assert.equal(p.y, 2026);
    assert.equal(p.m, 5);
    assert.equal(p.day, 16);
    const hm = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    assert.equal(hm, '09:00');
  });

  it('parseHmToMinutes accepts HH:mm', () => {
    assert.equal(parseHmToMinutes('09:00'), 540);
    assert.equal(parseHmToMinutes('20:00'), 1200);
  });
});
