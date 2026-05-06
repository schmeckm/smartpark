const { parse: parseSync } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { Staff, Zone, Ride } = require('../models');
const { emitZoneUpdated } = require('../sockets');

const zoneInc = {
  include: [
    { model: Ride, as: 'rides', required: false },
    { model: Staff, as: 'staffMembers', required: false },
  ],
};

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Array<Record<string, string>>} rows
 */
function rowsFromFile(buffer, originalName) {
  const name = (originalName || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }
  const text = buffer.toString('utf8');
  if (!text.trim()) return [];
  return parseSync(text, { columns: true, skip_empty_lines: true, relax_column_count: true, trim: true });
}

function norm(s) {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

class ImportService {
  /**
   * @param {Buffer} buffer
   * @param {string} name
   */
  async importZones(buffer, name) {
    const raw = rowsFromFile(buffer, name);
    const summary = { total: 0, inserted: 0, updated: 0, errors: [] };
    for (let i = 0; i < raw.length; i += 1) {
      const r = raw[i];
      const row = Object.keys(r).reduce(
        (acc, k) => {
          const key = k.toLowerCase();
          if (key === 'name') acc.name = r[k];
          else if (key === 'type') acc.type = r[k];
          else if (key === 'id') acc.id = r[k];
          else if (key === 'maxcapacity' || key === 'max_capacity') acc.maxCapacity = r[k];
          else if (key === 'status') acc.status = r[k];
          else if (key === 'currentcrowdlevel' || key === 'current_crowd_level') acc.currentCrowdLevel = r[k];
          else if (key === 'forecastcrowdlevel' || key === 'forecast_crowd_level') acc.forecastCrowdLevel = r[k];
          else if (key === 'adjacentzoneids' || key === 'adjacent_zone_ids') acc.adjacentZoneIds = r[k];
          return acc;
        },
        { id: r.id, name: r.name, type: r.type, maxCapacity: r.maxCapacity }
      );
      summary.total += 1;
      if (!row.name) {
        summary.errors.push({ row: i + 1, error: 'name is required' });
        continue;
      }
      if (!row.type) {
        summary.errors.push({ row: i + 1, error: 'type is required' });
        continue;
      }
      if (!row.maxCapacity && !row['max_capacity']) {
        const mc = r.maxCapacity ?? r.max_capacity;
        if (mc == null) {
          summary.errors.push({ row: i + 1, error: 'maxCapacity is required' });
          continue;
        }
        row.maxCapacity = mc;
      }
      const max = Number(row.maxCapacity);
      if (Number.isNaN(max) || max < 1) {
        summary.errors.push({ row: i + 1, error: 'maxCapacity must be a positive number' });
        continue;
      }
      let adj = row.adjacentZoneIds;
      if (typeof adj === 'string' && adj.trim().startsWith('[')) {
        try {
          adj = JSON.parse(adj);
        } catch {
          adj = [];
        }
      } else if (typeof adj === 'string' && adj.includes(';')) {
        adj = adj.split(';').map((s) => s.trim()).filter(Boolean);
      } else {
        adj = Array.isArray(adj) ? adj : [];
      }
      try {
        if (row.id) {
          const ex = await Zone.findByPk(row.id);
          if (ex) {
            await ex.update({
              name: String(row.name),
              type: String(row.type),
              currentCrowdLevel: row.currentCrowdLevel != null ? Number(row.currentCrowdLevel) : ex.currentCrowdLevel,
              forecastCrowdLevel:
                row.forecastCrowdLevel != null ? Number(row.forecastCrowdLevel) : ex.forecastCrowdLevel,
              maxCapacity: max,
              status: row.status || ex.status,
              adjacentZoneIds: Array.isArray(adj) ? adj : ex.adjacentZoneIds,
            });
            summary.updated += 1;
            const full = await Zone.findByPk(ex.id, zoneInc);
            if (full) emitZoneUpdated(full);
          } else {
            const created = await Zone.create({
              id: String(row.id),
              name: String(row.name),
              type: String(row.type),
              currentCrowdLevel: row.currentCrowdLevel != null ? Number(row.currentCrowdLevel) : 0,
              forecastCrowdLevel: row.forecastCrowdLevel != null ? Number(row.forecastCrowdLevel) : 0,
              maxCapacity: max,
              status: row.status || 'ACTIVE',
              adjacentZoneIds: Array.isArray(adj) ? adj : [],
            });
            summary.inserted += 1;
            const full = await Zone.findByPk(created.id, zoneInc);
            if (full) emitZoneUpdated(full);
          }
        } else {
          const existing = await Zone.findOne({ where: { name: String(row.name) } });
          if (existing) {
            await existing.update({
              type: String(row.type),
              currentCrowdLevel: row.currentCrowdLevel != null ? Number(row.currentCrowdLevel) : existing.currentCrowdLevel,
              maxCapacity: max,
              status: row.status || existing.status,
            });
            summary.updated += 1;
            const full = await Zone.findByPk(existing.id, zoneInc);
            if (full) emitZoneUpdated(full);
          } else {
            const created = await Zone.create({
              name: String(row.name),
              type: String(row.type),
              currentCrowdLevel: row.currentCrowdLevel != null ? Number(row.currentCrowdLevel) : 0,
              forecastCrowdLevel: row.forecastCrowdLevel != null ? Number(row.forecastCrowdLevel) : 0,
              maxCapacity: max,
              status: row.status || 'ACTIVE',
              adjacentZoneIds: Array.isArray(adj) ? adj : [],
            });
            summary.inserted += 1;
            const full = await Zone.findByPk(created.id, zoneInc);
            if (full) emitZoneUpdated(full);
          }
        }
      } catch (e) {
        summary.errors.push({ row: i + 1, error: e?.message || String(e) });
      }
    }
    return summary;
  }

  /**
   * @param {Buffer} buffer
   * @param {string} name
   */
  async importRides(buffer, name) {
    const raw = rowsFromFile(buffer, name);
    const summary = { total: 0, inserted: 0, updated: 0, errors: [] };
    for (let i = 0; i < raw.length; i += 1) {
      const r = raw[i];
      summary.total += 1;
      const row = {
        id: r.id,
        name: r.name,
        zoneId: r.zoneId || r.zone_id,
        status: r.status,
        waitTime: r.waitTime != null ? r.waitTime : r.wait_time,
        capacityPerHour: r.capacityPerHour != null ? r.capacityPerHour : r.capacity_per_hour,
        criticality: r.criticality,
      };
      if (!row.name) {
        summary.errors.push({ row: i + 1, error: 'name is required' });
        continue;
      }
      if (!row.zoneId) {
        summary.errors.push({ row: i + 1, error: 'zoneId is required' });
        continue;
      }
      const zone = await Zone.findByPk(String(row.zoneId).trim());
      if (!zone) {
        summary.errors.push({ row: i + 1, error: 'zone not found' });
        continue;
      }
      try {
        if (row.id) {
          const ex = await Ride.findByPk(String(row.id));
          if (ex) {
            await ex.update({
              name: String(row.name),
              zoneId: String(row.zoneId).trim(),
              status: row.status || ex.status,
              waitTime: row.waitTime != null ? Number(row.waitTime) : ex.waitTime,
              capacityPerHour: row.capacityPerHour != null ? Number(row.capacityPerHour) : ex.capacityPerHour,
              criticality: row.criticality != null ? Number(row.criticality) : ex.criticality,
            });
            summary.updated += 1;
            const { ZoneRepository } = require('../repositories/zone.repository');
            const zr = new ZoneRepository();
            const z2 = await zr.findById(String(row.zoneId), { includeRides: true, includeStaff: true });
            if (z2) emitZoneUpdated(z2);
          } else {
            const created = await Ride.create({
              id: String(row.id),
              name: String(row.name),
              zoneId: String(row.zoneId).trim(),
              status: row.status || 'OPEN',
              waitTime: row.waitTime != null ? Number(row.waitTime) : 0,
              capacityPerHour: row.capacityPerHour != null ? Number(row.capacityPerHour) : 0,
              criticality: row.criticality != null ? Number(row.criticality) : 1,
            });
            summary.inserted += 1;
            const { ZoneRepository } = require('../repositories/zone.repository');
            const zr = new ZoneRepository();
            const z2 = await zr.findById(created.zoneId, { includeRides: true, includeStaff: true });
            if (z2) emitZoneUpdated(z2);
          }
        } else {
          const existing = await Ride.findOne({ where: { name: String(row.name) } });
          if (existing) {
            await existing.update({
              zoneId: String(row.zoneId).trim(),
              status: row.status || existing.status,
              waitTime: row.waitTime != null ? Number(row.waitTime) : existing.waitTime,
            });
            summary.updated += 1;
            const { ZoneRepository } = require('../repositories/zone.repository');
            const zr = new ZoneRepository();
            const z2 = await zr.findById(String(row.zoneId), { includeRides: true, includeStaff: true });
            if (z2) emitZoneUpdated(z2);
          } else {
            const created = await Ride.create({
              name: String(row.name),
              zoneId: String(row.zoneId).trim(),
              status: row.status || 'OPEN',
              waitTime: row.waitTime != null ? Number(row.waitTime) : 0,
              capacityPerHour: row.capacityPerHour != null ? Number(row.capacityPerHour) : 0,
              criticality: row.criticality != null ? Number(row.criticality) : 1,
            });
            summary.inserted += 1;
            const { ZoneRepository } = require('../repositories/zone.repository');
            const zr = new ZoneRepository();
            const z2 = await zr.findById(created.zoneId, { includeRides: true, includeStaff: true });
            if (z2) emitZoneUpdated(z2);
          }
        }
      } catch (e) {
        summary.errors.push({ row: i + 1, error: e?.message || String(e) });
      }
    }
    return summary;
  }

  /**
   * @param {Buffer} buffer
   * @param {string} name
   */
  async importStaff(buffer, name) {
    const raw = rowsFromFile(buffer, name);
    const summary = { total: 0, inserted: 0, updated: 0, errors: [] };
    for (let i = 0; i < raw.length; i += 1) {
      const r = raw[i];
      summary.total += 1;
      const row = {
        id: r.id,
        firstName: r.firstName || r.first_name,
        lastName: r.lastName || r.last_name,
        role: r.role,
        currentZoneId: r.currentZoneId != null ? r.currentZoneId : r.current_zone_id,
        available: r.available,
        skillLevel: r.skillLevel != null ? r.skillLevel : r.skill_level,
      };
      if (!row.firstName || !row.lastName) {
        summary.errors.push({ row: i + 1, error: 'first and last name required' });
        continue;
      }
      if (!row.role) {
        summary.errors.push({ row: i + 1, error: 'role is required' });
        continue;
      }
      if (row.currentZoneId) {
        const z = await Zone.findByPk(String(row.currentZoneId).trim());
        if (!z) {
          summary.errors.push({ row: i + 1, error: 'currentZoneId not found' });
          continue;
        }
      }
      const avail = String(row.available || 'true').toLowerCase() === 'false' || row.available === 0 ? false : true;
      const skill = row.skillLevel != null ? Number(row.skillLevel) : 1;
      if (row.id) {
        const ex = await Staff.findByPk(String(row.id));
        try {
          if (ex) {
            await ex.update({
              firstName: String(row.firstName).trim(),
              lastName: String(row.lastName).trim(),
              role: String(row.role).toUpperCase(),
              currentZoneId: row.currentZoneId ? String(row.currentZoneId).trim() : null,
              available: avail,
              skillLevel: Number.isNaN(skill) ? 1 : Math.min(5, Math.max(1, skill)),
            });
            summary.updated += 1;
          } else {
            const created = await Staff.create({
              id: String(row.id),
              firstName: String(row.firstName).trim(),
              lastName: String(row.lastName).trim(),
              role: String(row.role).toUpperCase(),
              currentZoneId: row.currentZoneId ? String(row.currentZoneId).trim() : null,
              available: avail,
              skillLevel: Number.isNaN(skill) ? 1 : Math.min(5, Math.max(1, skill)),
            });
            summary.inserted += 1;
          }
          if (row.currentZoneId) {
            const { ZoneRepository } = require('../repositories/zone.repository');
            const zr = new ZoneRepository();
            const z2 = await zr.findById(String(row.currentZoneId), { includeRides: true, includeStaff: true });
            if (z2) emitZoneUpdated(z2);
          }
        } catch (e) {
          summary.errors.push({ row: i + 1, error: e?.message || String(e) });
        }
        continue;
      }
      const existing = await Staff.findOne({
        where: { firstName: String(row.firstName), lastName: String(row.lastName) },
      });
      try {
        if (existing) {
          await existing.update({
            role: String(row.role).toUpperCase(),
            currentZoneId: row.currentZoneId ? String(row.currentZoneId).trim() : null,
            available: avail,
            skillLevel: Number.isNaN(skill) ? 1 : Math.min(5, Math.max(1, skill)),
          });
          summary.updated += 1;
        } else {
          await Staff.create({
            firstName: String(row.firstName).trim(),
            lastName: String(row.lastName).trim(),
            role: String(row.role).toUpperCase(),
            currentZoneId: row.currentZoneId ? String(row.currentZoneId).trim() : null,
            available: avail,
            skillLevel: Number.isNaN(skill) ? 1 : Math.min(5, Math.max(1, skill)),
          });
          summary.inserted += 1;
        }
        if (row.currentZoneId) {
          const { ZoneRepository } = require('../repositories/zone.repository');
          const zr = new ZoneRepository();
          const z2 = await zr.findById(String(row.currentZoneId), { includeRides: true, includeStaff: true });
          if (z2) emitZoneUpdated(z2);
        }
      } catch (e) {
        summary.errors.push({ row: i + 1, error: e?.message || String(e) });
      }
    }
    return summary;
  }
}

module.exports = { ImportService, rowsFromFile, norm };
