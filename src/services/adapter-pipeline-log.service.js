const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const { logger } = require('../utils/logger');

const MAX_BYTES = Number(process.env.ADAPTER_PIPELINE_LOG_MAX_BYTES) || 5 * 1024 * 1024;

function resolveLogPath() {
  const p = String(env.adapterPipelineLogPath || 'data/adapter-pipeline.log').trim();
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function maybeRotate(filePath) {
  try {
    const st = fs.statSync(filePath);
    if (st.size < MAX_BYTES) return;
    const rotated = `${filePath}.1`;
    try {
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
    } catch {
      /* ignore */
    }
    fs.renameSync(filePath, rotated);
  } catch {
    /* missing file or race */
  }
}

/**
 * Append one NDJSON line (machine-readable) for adapter pipeline / install issues.
 * Never throws — failures go to the main logger only.
 * @param {object} entry
 * @param {string} [entry.adapterKey]
 * @param {string} entry.source — e.g. adapter_runtime | adapter_scheduler
 * @param {'info'|'warn'|'error'} entry.level
 * @param {string} entry.event — short stable code, e.g. poll_config_invalid
 * @param {string} entry.message
 * @param {unknown} [entry.detail]
 */
function logAdapterPipeline(entry) {
  if (!env.adapterPipelineLogEnabled) return;
  const adapterKey = entry.adapterKey != null ? String(entry.adapterKey) : null;
  const level = entry.level === 'info' || entry.level === 'error' ? entry.level : 'warn';
  const lineObj = {
    ts: new Date().toISOString(),
    adapterKey,
    source: entry.source || 'adapter',
    level,
    event: String(entry.event || 'unknown'),
    message: String(entry.message || ''),
  };
  if (entry.detail !== undefined) lineObj.detail = entry.detail;
  try {
    const filePath = resolveLogPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    maybeRotate(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(lineObj)}\n`, 'utf8');
  } catch (e) {
    logger.warn({ err: e.message }, 'adapter-pipeline-log: append failed');
  }
  if (level === 'error' || level === 'warn') {
    logger[level]({ adapterKey, event: lineObj.event, detail: lineObj.detail }, lineObj.message);
  }
}

const TAIL_READ_BYTES = Math.min(Number(process.env.ADAPTER_PIPELINE_LOG_TAIL_BYTES) || 2 * 1024 * 1024, 8 * 1024 * 1024);

/**
 * Read the tail of the pipeline log for the admin UI (newest entries first).
 * @param {{ adapterKey?: string | null; limit?: number }} opts
 */
function readRecentAdapterPipelineLog(opts = {}) {
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200));
  const adapterKey =
    opts.adapterKey != null && String(opts.adapterKey).trim() ? String(opts.adapterKey).trim().toLowerCase() : null;
  const logPath = resolveLogPath();
  const base = {
    logPath,
    loggingEnabled: env.adapterPipelineLogEnabled,
    fileExists: false,
    truncatedTail: false,
    entries: [],
  };
  if (!env.adapterPipelineLogEnabled) {
    return { ...base, message: 'Pipeline file logging disabled (ADAPTER_PIPELINE_LOG_ENABLED=false)' };
  }
  try {
    if (!fs.existsSync(logPath)) {
      return base;
    }
    base.fileExists = true;
    const st = fs.statSync(logPath);
    const readLen = Math.min(TAIL_READ_BYTES, st.size);
    const start = st.size - readLen;
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, start);
    fs.closeSync(fd);
    base.truncatedTail = st.size > readLen;
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    const parsed = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        parsed.push(JSON.parse(t));
      } catch {
        /* partial line when tail truncated */
      }
    }
    let filtered = parsed;
    if (adapterKey) {
      filtered = parsed.filter((e) => String(e.adapterKey || '').toLowerCase() === adapterKey);
    }
    const entries = filtered.slice(-limit).reverse();
    return { ...base, entries, totalParsedInTail: parsed.length };
  } catch (e) {
    logger.warn({ err: e.message, logPath }, 'adapter-pipeline-log: read failed');
    return { ...base, fileExists: base.fileExists, readError: e.message };
  }
}

module.exports = { logAdapterPipeline, resolveLogPath, readRecentAdapterPipelineLog };
