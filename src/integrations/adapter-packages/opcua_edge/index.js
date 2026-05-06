/**
 * OPC-UA edge adapter — simulate (default) or optional live reads via `node-opcua`.
 * @see README.md
 */

const ADAPTER_KEY = 'opcua_edge';

/**
 * @param {object} [config]
 * @param {object} [context]
 */
function effectiveConfig(config, context) {
  const cfg = config && typeof config === 'object' ? config : {};
  const ctx = context && typeof context === 'object' ? context : {};
  return { ...ctx, ...cfg };
}

function loadOpcuaModule() {
  try {
    // Optional dependency: `npm install node-opcua` for live reads.
    return require('node-opcua');
  } catch {
    return null;
  }
}

function isOpcTcpUrl(s) {
  const t = String(s || '').trim();
  return /^opc\.tcp:\/\//i.test(t);
}

/**
 * @param {unknown} raw
 * @returns {object[]}
 */
function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t) => t && typeof t === 'object');
}

/**
 * @param {object} cfg
 */
async function readLiveOpcValues(cfg) {
  const opcua = loadOpcuaModule();
  if (!opcua) {
    throw new Error('node-opcua is not installed; run: npm install node-opcua');
  }
  const { OPCUAClient, AttributeIds } = opcua;
  const endpointUrl = String(cfg.endpointUrl || '').trim();
  const tags = normalizeTags(cfg.subscriptionTags);
  const nodeIds = tags.map((t) => String(t.nodeId || '').trim()).filter(Boolean);
  if (!nodeIds.length) throw new Error('No nodeId values in subscriptionTags');

  const mode = String(cfg.securityMode || 'None');
  if (mode !== 'None') {
    throw new Error(`securityMode "${mode}" requires certificate setup; use None for lab PLCs or extend this adapter.`);
  }

  const client = OPCUAClient.create({
    applicationName: 'SmartParkOpcuaEdge',
    connectionStrategy: { maxRetry: 1, initialDelay: 200, maxDelay: 2000 },
  });

  await client.connect(endpointUrl);
  try {
    const session = await client.createSession();
    try {
      const out = [];
      for (const nodeId of nodeIds) {
        const dataValue = await session.read({
          nodeId,
          attributeId: AttributeIds.Value,
        });
        const value = dataValue.value && Object.prototype.hasOwnProperty.call(dataValue.value, 'value')
          ? dataValue.value.value
          : null;
        const sc = dataValue.statusCode;
        const ok =
          sc &&
          (typeof sc.isGood === 'function'
            ? sc.isGood()
            : sc === opcua.StatusCodes?.Good || sc?.value === 0);
        out.push({ value, quality: ok ? 'GOOD' : 'BAD' });
      }
      return out;
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}

/**
 * @param {object} tag
 * @param {object} cfg
 */
function mockValueForTag(tag, cfg) {
  if (Object.prototype.hasOwnProperty.call(tag, 'mockValue')) return tag.mockValue;
  const mocks = cfg.mockValues && typeof cfg.mockValues === 'object' ? cfg.mockValues : {};
  const id = String(tag.nodeId || '');
  if (id && Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
  return null;
}

/**
 * @param {object} tag
 * @param {unknown} value
 */
function inferEventType(tag, value) {
  if (typeof tag.eventType === 'string' && tag.eventType.trim()) return tag.eventType.trim();
  if (typeof value === 'number') return 'QUEUE_TIME_OBSERVED';
  if (value === null || value === undefined) return 'STATUS_OBSERVED';
  return 'PLC_VALUE_OBSERVED';
}

/**
 * @param {object} tag
 * @param {unknown} value
 * @param {string} quality
 */
function toObservation(tag, value, quality) {
  const domain = String(tag.domain || 'controls').trim() || 'controls';
  const assetSlug = String(tag.assetSlug || 'device').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_') || 'device';
  const metric = String(tag.metric || 'plc_value').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_') || 'plc_value';
  const unit = tag.unit != null && String(tag.unit).trim() !== '' ? String(tag.unit).trim() : null;
  return {
    eventType: inferEventType(tag, value),
    domain,
    assetSlug,
    metric,
    value,
    unit,
    eventTime: new Date().toISOString(),
    quality,
    confidence: quality === 'GOOD' ? 1 : null,
    source: ADAPTER_KEY,
    externalEntityId: String(tag.nodeId || ''),
    rawPayload: { nodeId: tag.nodeId },
    metadata: { adapterKey: ADAPTER_KEY },
  };
}

async function validateConfig(config, _context) {
  const cfg = effectiveConfig(config, _context);
  const errors = [];

  const endpointUrl = cfg.endpointUrl != null ? String(cfg.endpointUrl).trim() : '';
  if (!endpointUrl) errors.push('endpointUrl is required');
  else if (!isOpcTcpUrl(endpointUrl)) errors.push('endpointUrl must start with opc.tcp://');

  const tags = normalizeTags(cfg.subscriptionTags);
  if (!tags.length) errors.push('subscriptionTags must be a non-empty array');

  for (let i = 0; i < tags.length; i += 1) {
    const t = tags[i];
    if (!String(t.nodeId || '').trim()) errors.push(`subscriptionTags[${i}].nodeId is required`);
    if (!String(t.domain || '').trim()) errors.push(`subscriptionTags[${i}].domain is required`);
    if (!String(t.assetSlug || '').trim()) errors.push(`subscriptionTags[${i}].assetSlug is required`);
    if (!String(t.metric || '').trim()) errors.push(`subscriptionTags[${i}].metric is required`);
  }

  const live = cfg.live === true;
  if (live) {
    if (!loadOpcuaModule()) {
      errors.push('live mode requires the optional dependency: npm install node-opcua');
    }
    const sm = String(cfg.securityMode || 'None');
    if (sm !== 'None') {
      errors.push('live mode currently supports securityMode "None" only (extend for Sign/SignAndEncrypt + certs)');
    }
  }

  return { valid: errors.length === 0, errors };
}

async function discover(config, context) {
  const cfg = effectiveConfig(config, context);
  const tags = normalizeTags(cfg.subscriptionTags);
  return tags.map((t) => ({
    id: String(t.nodeId || ''),
    name: `${t.domain || ''}/${t.assetSlug || ''}/${t.metric || ''}`.replace(/^\/+|\/+$/g, '') || String(t.nodeId),
    entityType: String(t.domain || 'OTHER'),
  }));
}

async function poll(config, context) {
  const cfg = effectiveConfig(config, context);
  const tags = normalizeTags(cfg.subscriptionTags);
  const live = cfg.live === true;

  let values = [];
  if (live) {
    values = await readLiveOpcValues(cfg);
  } else {
    values = tags.map((t) => {
      const v = mockValueForTag(t, cfg);
      const quality = v != null && v !== '' ? 'GOOD' : 'BAD';
      return { value: v, quality };
    });
  }

  const observations = [];
  for (let i = 0; i < tags.length; i += 1) {
    const row = values[i] || { value: null, quality: 'BAD' };
    observations.push(toObservation(tags[i], row.value, row.quality));
  }

  return {
    observations,
    debug: {
      adapterKey: ADAPTER_KEY,
      live,
      tagCount: tags.length,
      endpointUrl: String(cfg.endpointUrl || '').trim() || null,
    },
  };
}

async function health(config, context) {
  const v = await validateConfig(config, context);
  if (!v.valid) {
    return { ok: false, message: v.errors.join('; ') };
  }
  const cfg = effectiveConfig(config, context);
  if (cfg.live !== true) {
    return { ok: true, message: 'simulate mode: OPC server not contacted' };
  }
  try {
    await readLiveOpcValues(cfg);
    return { ok: true, message: 'OPC-UA session read succeeded' };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
}

module.exports = { validateConfig, discover, poll, health };
