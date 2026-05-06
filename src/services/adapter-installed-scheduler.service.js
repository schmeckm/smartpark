const { logger } = require('../utils/logger');
const { getPlatformSettingsService } = require('./platform-settings.service');
const { logAdapterPipeline } = require('./adapter-pipeline-log.service');
const { ProviderAdapterRegistryService } = require('./provider-adapter-registry.service');
const { AdapterRuntimeService } = require('./adapter-runtime.service');
const { DEFAULT_INSTALL_OUTPUT_PROFILES } = require('./adapter-output-profile-names');
const { ensureContextParkSlug } = require('../utils/adapter-install-config-merge');

function parseIntSafe(s) {
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeDayOfWeek(jsDay) {
  // JS: Sun=0..Sat=6 ; cron supports 0 or 7 as Sunday
  return jsDay === 0 ? [0, 7] : [jsDay];
}

function matchesPart(part, value, min, max) {
  if (part === '*') return true;

  const stepMatch = part.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseIntSafe(stepMatch[1]);
    return step != null && step > 0 ? (value - min) % step === 0 : false;
  }

  const rangeStep = part.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStep) {
    const a = parseIntSafe(rangeStep[1]);
    const b = parseIntSafe(rangeStep[2]);
    const step = parseIntSafe(rangeStep[3]);
    if (a == null || b == null || step == null || step <= 0) return false;
    if (a < min || b > max || a > b) return false;
    return value >= a && value <= b && (value - a) % step === 0;
  }

  const range = part.match(/^(\d+)-(\d+)$/);
  if (range) {
    const a = parseIntSafe(range[1]);
    const b = parseIntSafe(range[2]);
    if (a == null || b == null || a < min || b > max || a > b) return false;
    return value >= a && value <= b;
  }

  const n = parseIntSafe(part);
  return n != null && n >= min && n <= max ? value === n : false;
}

function matchesField(field, value, min, max) {
  const parts = String(field)
    .trim()
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  for (const part of parts) {
    if (matchesPart(part, value, min, max)) return true;
  }
  return false;
}

/**
 * Minimal cron matcher for 5-field expressions:
 * minute hour day-of-month month day-of-week
 */
function matchesCron(expression, now) {
  const fields = String(expression || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (fields.length !== 5) return false;
  const [m, h, dom, mon, dow] = fields;

  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const jsDow = now.getDay();

  if (!matchesField(m, minute, 0, 59)) return false;
  if (!matchesField(h, hour, 0, 23)) return false;
  if (!matchesField(dom, day, 1, 31)) return false;
  if (!matchesField(mon, month, 1, 12)) return false;
  const dows = normalizeDayOfWeek(jsDow);
  return dows.some((v) => matchesField(dow, v, 0, 7));
}

function minuteStamp(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}${mo}${d}${h}${mi}`;
}

class AdapterInstalledSchedulerService {
  constructor() {
    this.registry = new ProviderAdapterRegistryService();
    this.runtime = new AdapterRuntimeService();
    this.lastRunByAdapterMinute = new Map();
  }

  async _runDueAdapter(row, now) {
    const adapterKey = String(row.adapterKey || '').trim();
    if (!adapterKey) return;

    const status = String(row.status || '').toUpperCase();
    if (status !== 'ACTIVE' || row.enabled === false) return;

    const install = row?.metadata?.install;
    const cron = install?.scheduleCron != null ? String(install.scheduleCron).trim() : '';
    if (!cron) return;
    if (!matchesCron(cron, now)) return;

    const minuteKey = `${adapterKey}:${minuteStamp(now)}`;
    if (this.lastRunByAdapterMinute.has(minuteKey)) return;
    this.lastRunByAdapterMinute.set(minuteKey, now.getTime());

    // Keep cache bounded (drop entries older than 3h)
    const cutoff = now.getTime() - 3 * 60 * 60 * 1000;
    for (const [k, ts] of this.lastRunByAdapterMinute.entries()) {
      if (ts < cutoff) this.lastRunByAdapterMinute.delete(k);
    }

    const config = install?.configJson && typeof install.configJson === 'object' ? install.configJson : {};
    let context = ensureContextParkSlug(
      install?.contextJson && typeof install.contextJson === 'object' ? install.contextJson : {},
      config
    );
    const profiles =
      Array.isArray(install?.outputProfiles) && install.outputProfiles.length
        ? install.outputProfiles
        : [...DEFAULT_INSTALL_OUTPUT_PROFILES];
    const emitMqtt = install?.emitEnabled === true;
    const ingestCanonical = install?.ingestCanonicalEnabled === true;
    if (!String(context.parkSlug || '').trim()) {
      logger.warn({ adapterKey }, 'adapter scheduler skipped: context.parkSlug (or sparkplugGroupId) missing');
      logAdapterPipeline({
        adapterKey,
        source: 'adapter_scheduler',
        level: 'warn',
        event: 'schedule_skip_missing_context',
        message: 'Scheduled run skipped: context.parkSlug and sparkplugGroupId missing or empty',
        detail: { scheduleCron: cron },
      });
      return;
    }

    try {
      const res = await this.runtime.runAdapter({
        adapterKey,
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
      logger.info(
        {
          adapterKey,
          scheduleCron: cron,
          emitMqtt,
          success: res?.success === true,
          observations: Array.isArray(res?.observations) ? res.observations.length : 0,
          errors: res?.errors || [],
        },
        'installed adapter scheduler run completed'
      );
      const errList = Array.isArray(res?.errors) ? res.errors : [];
      if (res?.success !== true || errList.length > 0) {
        logAdapterPipeline({
          adapterKey,
          source: 'adapter_scheduler',
          level: 'warn',
          event: 'schedule_run_unsuccessful',
          message: errList.length ? errList.join(' | ') : 'Adapter poll reported success: false',
          detail: {
            scheduleCron: cron,
            emitMqtt,
            ingestCanonical,
            success: res?.success === true,
            errors: errList.slice(0, 20),
            validationErrors: Array.isArray(res?.validationErrors) ? res.validationErrors.slice(0, 8) : [],
          },
        });
      }
    } catch (e) {
      logger.warn({ adapterKey, err: e.message }, 'installed adapter scheduler run failed');
      logAdapterPipeline({
        adapterKey,
        source: 'adapter_scheduler',
        level: 'error',
        event: 'schedule_run_exception',
        message: e.message,
        detail: { scheduleCron: cron },
      });
    }
  }

  /**
   * Master enable flag read from PlatformSettingsService each loop (DB → ENV → default).
   * @returns {Promise<() => void>}
   */
  async start() {
    let cancelled = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const loop = async () => {
      while (!cancelled) {
        try {
          const ps = getPlatformSettingsService();
          if (!(await ps.getBoolean('ADAPTER_SCHEDULER_ENABLED', true))) {
            await sleep(30_000);
            continue;
          }
          const rows = await this.registry.listInstalledAdapterPackages();
          const now = new Date();
          for (const row of rows || []) {
            // eslint-disable-next-line no-await-in-loop
            await this._runDueAdapter(row, now);
          }
        } catch (e) {
          logger.warn({ err: e.message }, 'installed adapter scheduler loop failed');
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(30_000);
      }
    };

    void loop();
    logger.info('installed adapter scheduler started');
    return () => {
      cancelled = true;
    };
  }
}

module.exports = { AdapterInstalledSchedulerService, matchesCron };
