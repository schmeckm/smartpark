const { AppError } = require('../../../utils/app-error');
const { ProviderAdapterRegistryService } = require('../../../services/provider-adapter-registry.service');
const { AdapterRunLogRepository } = require('../../../repositories/adapter-run-log.repository');
const { readRecentAdapterPipelineLog } = require('./adapter-pipeline-log.service');
const { matchesCron } = require('./adapter-installed-scheduler.service');
const { AdapterInventoryService } = require('./adapter-inventory.service');
const { AdapterRuntimeService } = require('./adapter-runtime.service');
const { DEFAULT_INSTALL_OUTPUT_PROFILES } = require('./adapter-output-profile-names');
const { ensureContextParkSlug } = require('../../../utils/adapter-install-config-merge');

const THEMEPARKS_KEYS = new Set(['themeparks_wiki', 'themeparks-wiki', 'themeparkswiki']);

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcHourKey(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}T${p(x.getUTCHours())}:00:00.000Z`;
}

function computeNextCronIso(cronExpr, from = new Date()) {
  const cron = String(cronExpr || '').trim();
  if (!cron) return null;
  const start = new Date(from);
  start.setSeconds(0, 0);
  for (let i = 0; i < 10080; i += 1) {
    const probe = new Date(start.getTime() + i * 60 * 1000);
    if (matchesCron(cron, probe)) return probe.toISOString();
  }
  return null;
}

function mapPipelineLevel(l) {
  const x = String(l || '').toLowerCase();
  if (x === 'error') return 'ERROR';
  if (x === 'warn' || x === 'warning') return 'WARN';
  if (x === 'info') return 'INFO';
  return 'INFO';
}

function buildEventStream(pipelineEntries, runRows) {
  const out = [];
  for (const e of pipelineEntries || []) {
    out.push({
      ts: e.ts,
      adapterKey: e.adapterKey,
      level: mapPipelineLevel(e.level),
      message: e.message || e.event || '',
    });
  }
  for (const r of runRows || []) {
    const row = r.toJSON ? r.toJSON() : r;
    const ts =
      row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString();
    let level = 'INFO';
    if (row.status === 'SUCCESS') level = 'SUCCESS';
    else if (row.status === 'PARTIAL') level = 'WARN';
    else if (row.status === 'FAILED') level = 'ERROR';
    out.push({
      ts,
      adapterKey: row.adapterKey,
      level,
      message: `Run ${row.status}: observations=${row.observationCount ?? 0} valid=${row.validCount ?? 0}`,
    });
  }
  out.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return out.slice(0, 100);
}

function aggregateHourlyAvg(points) {
  const sums = new Map();
  const counts = new Map();
  for (const { t, v } of points) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const k = utcHourKey(t);
    sums.set(k, (sums.get(k) || 0) + v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...sums.keys()]
    .sort()
    .map((hour) => ({
      hour,
      avgMs: Math.round(sums.get(hour) / counts.get(hour)),
    }));
}

function aggregateHourlySum(points) {
  const sums = new Map();
  for (const { t, v } of points) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const k = utcHourKey(t);
    sums.set(k, (sums.get(k) || 0) + n);
  }
  return [...sums.keys()]
    .sort()
    .map((hour) => ({ hour, total: sums.get(hour) }));
}

function groupRunsByAdapter(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const row = r.toJSON ? r.toJSON() : r;
    const k = row.adapterKey;
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

function deriveOpsStatus({ installStatus, enabled, active, lastStatus, hadRecentRun }) {
  const st = String(installStatus || 'ACTIVE').toUpperCase();
  if (!enabled || st === 'DISABLED' || st === 'INSTALLED') return 'PAUSED';
  if (st === 'PAUSED') return 'PAUSED';
  if (!active) return 'PAUSED';
  if (lastStatus === 'FAILED') return 'FAILED';
  if (lastStatus === 'PARTIAL') return 'WARNING';
  if (!hadRecentRun && lastStatus == null) return 'WARNING';
  return 'HEALTHY';
}

class AdapterOperationsService {
  constructor() {
    this.registry = new ProviderAdapterRegistryService();
    this.runLogs = new AdapterRunLogRepository();
    this.inventory = new AdapterInventoryService();
    this.runtime = new AdapterRuntimeService();
  }

  async getHealth() {
    const dash = await this.getDashboard();
    return dash.kpis;
  }

  async getDashboard() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sinceDay = startOfUtcDay();

    const [installed, pipeline, runs24hRaw, runsToday, hourlyRuns, hourlyErrors] = await Promise.all([
      this.registry.listInstalledAdapterPackages(),
      Promise.resolve(readRecentAdapterPipelineLog({ limit: 400 })),
      this.runLogs.findRecent({ since: since24h, limit: 2000 }),
      this.runLogs.countSince(sinceDay),
      this.runLogs.hourlyBuckets24h('runs'),
      this.runLogs.hourlyBuckets24h('errors'),
    ]);

    const runs24h = (runs24hRaw || []).map((x) => (x.toJSON ? x.toJSON() : x));
    const runsByAdapter = groupRunsByAdapter(runs24h);

    const todayIso = sinceDay.toISOString().slice(0, 10);
    let mqttPublishErrorsToday = 0;
    for (const e of pipeline.entries || []) {
      if (!e.ts || e.ts.slice(0, 10) !== todayIso) continue;
      const d = e.detail;
      if (d && typeof d === 'object' && Array.isArray(d.mqttFailures) && d.mqttFailures.length) {
        mqttPublishErrorsToday += 1;
      }
    }

    const adapterKeys = (installed || []).map((r) => r.adapterKey).filter(Boolean);
    const latestByKey = await this.runLogs.findLatestOnePerAdapter(adapterKeys);

    const avgDurToday = await this.runLogs.avgDurationMsSince(sinceDay);

    const sortedAsc = [...runs24h].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const runtimeTrend = aggregateHourlyAvg(
      sortedAsc.map((r) => ({ t: r.createdAt, v: r.summary?.durationMs }))
    );
    const messagesTrend = aggregateHourlySum(sortedAsc.map((r) => ({ t: r.createdAt, v: r.observationCount || 0 })));

    let lastSchedulerRun = null;
    for (const e of pipeline.entries || []) {
      if (e.source === 'adapter_scheduler') {
        lastSchedulerRun = e.ts;
        break;
      }
    }

    const totalAdapters = installed.length;
    let activeAdapters = 0;
    let healthyAdapters = 0;
    let warningAdapters = 0;
    let failedAdapters = 0;
    let pausedAdapters = 0;

    const adapters = [];

    for (const row of installed) {
      const plain = row.toJSON ? row.toJSON() : row;
      const key = plain.adapterKey;
      const install = plain.metadata?.install && typeof plain.metadata.install === 'object' ? plain.metadata.install : {};
      const cron = install.scheduleCron != null ? String(install.scheduleCron).trim() : '';
      const installStatus = plain.status || 'ACTIVE';
      const enabled = plain.enabled !== false;
      const stUp = String(installStatus || '').toUpperCase();
      const active = enabled && stUp === 'ACTIVE';

      if (active) activeAdapters += 1;

      const lastModel = latestByKey[key];
      const lastRunRow = lastModel?.toJSON ? lastModel.toJSON() : lastModel;
      const lastRunIso = lastRunRow?.createdAt ? new Date(lastRunRow.createdAt).toISOString() : null;
      const lastStatus = lastRunRow?.status ?? null;
      const recentForAdapter = runsByAdapter.get(key) || [];
      const hadRecentRun = recentForAdapter.length > 0;

      const opsStatus = deriveOpsStatus({
        installStatus: stUp,
        enabled,
        active,
        lastStatus,
        hadRecentRun,
      });

      if (opsStatus === 'PAUSED') pausedAdapters += 1;
      else if (opsStatus === 'FAILED') failedAdapters += 1;
      else if (opsStatus === 'WARNING') warningAdapters += 1;
      else healthyAdapters += 1;

      let runsOk = 0;
      let msgSum = 0;
      let errSum = 0;
      for (const rr of recentForAdapter) {
        msgSum += Number(rr.observationCount) || 0;
        errSum += Number(rr.invalidCount) || 0;
        if (String(rr.status).toUpperCase() === 'SUCCESS') runsOk += 1;
      }
      const runCount24h = recentForAdapter.length;
      const successRate = runCount24h ? Math.round((runsOk / runCount24h) * 1000) / 10 : null;

      const nextRun = active && cron ? computeNextCronIso(cron) : null;
      const provider =
        (install.contextJson && typeof install.contextJson === 'object' && install.contextJson.provider) ||
        plain.adapterType ||
        null;

      adapters.push({
        adapterKey: key,
        name: plain.name || key,
        adapterType: plain.adapterType || null,
        provider,
        status: opsStatus,
        installStatus: stUp,
        active,
        enabled,
        lastRun: lastRunIso,
        nextRun,
        runtimeMs: lastRunRow?.summary?.durationMs ?? null,
        messagesProcessed: msgSum,
        errorsCount: errSum,
        successRate,
        scheduleCron: cron || null,
        emitMqtt: install.emitEnabled === true,
        ingestCanonical: install.ingestCanonicalEnabled === true,
        parkSlug:
          install.contextJson && typeof install.contextJson === 'object'
            ? install.contextJson.parkSlug || null
            : null,
      });
    }

    const nextScheduledRun = adapters
      .map((a) => a.nextRun)
      .filter(Boolean)
      .sort()[0];

    const kpis = {
      totalAdapters,
      activeAdapters,
      healthyAdapters,
      warningAdapters,
      failedAdapters,
      pausedAdapters,
      runsToday,
      mqttPublishErrorsToday,
      avgRuntimeSecToday: avgDurToday != null ? Math.round((avgDurToday / 1000) * 10) / 10 : null,
      lastSchedulerRun,
      nextScheduledRun: nextScheduledRun || null,
    };

    const events = buildEventStream(pipeline.entries || [], runs24h.slice(0, 120));

    return {
      kpis,
      adapters,
      charts: {
        runsPerHour: hourlyRuns,
        errorsPerHour: hourlyErrors,
        runtimeTrend,
        messagesTrend,
      },
      events,
      pipeline: {
        logPath: pipeline.logPath,
        loggingEnabled: pipeline.loggingEnabled,
        fileExists: pipeline.fileExists,
      },
    };
  }

  async listRuns(query) {
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
    const adapterKey = query.adapterKey && String(query.adapterKey).trim() ? String(query.adapterKey).trim() : null;
    const rows = await this.runLogs.findRecent({
      ...(adapterKey ? { adapterKey } : {}),
      limit,
    });
    return rows.map((r) => {
      const j = r.toJSON ? r.toJSON() : r;
      return {
        id: j.id,
        adapterKey: j.adapterKey,
        status: j.status,
        observationCount: j.observationCount,
        validCount: j.validCount,
        invalidCount: j.invalidCount,
        summary: j.summary,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
      };
    });
  }

  async getAdapterStatus(adapterKeyRaw) {
    const adapterKey = String(adapterKeyRaw || '').trim();
    if (!adapterKey) throw new AppError('adapterKey required', 400, { code: 'INVALID' });

    const row = await this.registry.getInstalledAdapterRecord(adapterKey);
    if (!row) throw new AppError('Installed adapter not found', 404, { code: 'NOT_FOUND' });

    const plain = row.toJSON ? row.toJSON() : row;
    const key = plain.adapterKey;
    const install = plain.metadata?.install && typeof plain.metadata.install === 'object' ? plain.metadata.install : {};

    const [runs, avgRuntimeMs24h] = await Promise.all([
      this.runLogs.findRecent({ adapterKey: key, limit: 10 }),
      this.runLogs.avgDurationMsSince(new Date(Date.now() - 24 * 60 * 60 * 1000), key),
    ]);

    const runJson = runs.map((r) => {
      const j = r.toJSON ? r.toJSON() : r;
      return {
        id: j.id,
        status: j.status,
        observationCount: j.observationCount,
        validCount: j.validCount,
        invalidCount: j.invalidCount,
        durationMs: j.summary?.durationMs ?? null,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
      };
    });

    const lastErrRow = runJson.find((x) => x.errorMessage) || null;

    let themeParks = null;
    if (THEMEPARKS_KEYS.has(adapterKey.toLowerCase()) || THEMEPARKS_KEYS.has(key.toLowerCase())) {
      themeParks = await this.inventory.getThemeParksWikiOpsDetail();
      const lastPoll = runJson[0];
      if (lastPoll) {
        themeParks = {
          ...themeParks,
          lastLiveObservationsAt: lastPoll.createdAt,
          lastLiveObservationCount: lastPoll.observationCount,
        };
      }
    }

    const configSummary = {
      keys: install.configJson && typeof install.configJson === 'object' ? Object.keys(install.configJson) : [],
      outputProfiles: Array.isArray(install.outputProfiles) ? install.outputProfiles : [],
      emitEnabled: install.emitEnabled === true,
      ingestCanonicalEnabled: install.ingestCanonicalEnabled === true,
    };

    const ctx = install.contextJson && typeof install.contextJson === 'object' ? install.contextJson : {};

    return {
      adapterKey: key,
      name: plain.name,
      adapterType: plain.adapterType,
      enabled: plain.enabled !== false,
      installStatus: String(plain.status || 'ACTIVE').toUpperCase(),
      configSummary,
      selectedPark: ctx.parkSlug || ctx.externalParkId || null,
      cronSchedule: install.scheduleCron || null,
      last10Runs: runJson,
      avgRuntimeMs24h,
      outputs: {
        mqtt: install.emitEnabled === true,
        canonical: install.ingestCanonicalEnabled === true,
      },
      lastError: lastErrRow?.errorMessage || null,
      themeParks,
    };
  }

  async runAdapterNow(adapterKeyRaw) {
    const adapterKey = String(adapterKeyRaw || '').trim();
    const row = await this.registry.getInstalledAdapterRecord(adapterKey);
    if (!row) throw new AppError('Installed adapter not found', 404, { code: 'NOT_FOUND' });

    const plain = row.toJSON ? row.toJSON() : row;
    const key = plain.adapterKey;
    const install = plain.metadata?.install && typeof plain.metadata.install === 'object' ? plain.metadata.install : {};

    const config = install.configJson && typeof install.configJson === 'object' ? install.configJson : {};
    let context = ensureContextParkSlug(
      install.contextJson && typeof install.contextJson === 'object' ? install.contextJson : {},
      config
    );
    const profiles = Array.isArray(install.outputProfiles) && install.outputProfiles.length
      ? install.outputProfiles
      : [...DEFAULT_INSTALL_OUTPUT_PROFILES];
    const emitMqtt = install.emitEnabled === true;
    const ingestCanonical = install.ingestCanonicalEnabled === true;

    if (!String(context.parkSlug || '').trim()) {
      throw new AppError(
        'Set parkSlug (or sparkplugGroupId) in install contextJson, or parkSlug / sparkplugGroupId in configJson',
        400,
        { code: 'MISSING_CONTEXT' }
      );
    }

    return this.runtime.runAdapter({
      adapterKey: key,
      mode: 'poll',
      config,
      context,
      profiles,
      emitOptions: {
        emitMqtt,
        ingestCanonical,
        autoApply: true,
      },
    });
  }

  async pauseAdapter(adapterKeyRaw) {
    const adapterKey = String(adapterKeyRaw || '').trim();
    return this.registry.patchInstalledAdapterPackage(adapterKey, { status: 'PAUSED' });
  }

  async activateAdapter(adapterKeyRaw) {
    const adapterKey = String(adapterKeyRaw || '').trim();
    return this.registry.patchInstalledAdapterPackage(adapterKey, { status: 'ACTIVE', enabled: true });
  }

  async disableAdapter(adapterKeyRaw) {
    const adapterKey = String(adapterKeyRaw || '').trim();
    return this.registry.patchInstalledAdapterPackage(adapterKey, { enabled: false, status: 'DISABLED' });
  }
}

module.exports = { AdapterOperationsService };
