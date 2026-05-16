'use strict';

const { DashboardWidgetInstance } = require('../../../models');
const { AppError } = require('../../../utils/app-error');
const widgetRegistry = require('./widget-registry.service');
const dataSourceRegistry = require('./widget-data-source-registry.service');
const { resolveData } = require('./widget-data-resolver.service');

class WidgetInstanceService {
  /**
   * @param {{ auditLogService?: import('../../../services/audit-log.service').AuditLogService }} [deps]
   */
  constructor(deps = {}) {
    this.auditLogService = deps.auditLogService || null;
  }

  async list({ limit = 100, offset = 0 } = {}) {
    const rows = await DashboardWidgetInstance.findAll({
      limit: Math.min(200, Math.max(1, Number(limit) || 100)),
      offset: Math.max(0, Number(offset) || 0),
      order: [['updatedAt', 'DESC']],
    });
    return rows.map((r) => (r.toJSON ? r.toJSON() : r));
  }

  async getById(id) {
    const row = await DashboardWidgetInstance.findByPk(id);
    if (!row) throw new AppError('Widget instance not found', 404, { code: 'NOT_FOUND' });
    return row.toJSON ? row.toJSON() : row;
  }

  async create(body, { userId = null, email = null } = {}) {
    const widget = await widgetRegistry.assertWidgetEnabled(body.widgetKey);
    await dataSourceRegistry.assertDataSourceEnabled(body.dataSourceKey ?? null);
    const widgetConfig = body.widgetConfig ?? {};
    widgetRegistry.validateConfigAgainstSchema(widget.configSchema, widgetConfig);

    const actor = email || (userId ? String(userId) : null);
    const row = await DashboardWidgetInstance.create({
      widgetKey: body.widgetKey,
      title: body.title ?? null,
      description: body.description ?? null,
      widgetConfig,
      dataSourceKey: body.dataSourceKey ?? null,
      enabled: body.enabled !== false,
      createdBy: actor,
      updatedBy: actor,
    });
    const plain = row.toJSON ? row.toJSON() : row;
    try {
      await this.auditLogService?.log({
        action: 'widget_instance.created',
        entityType: 'DashboardWidgetInstance',
        entityId: plain.id,
        newValue: { widgetKey: plain.widgetKey, title: plain.title },
        userId,
      });
    } catch {
      /* audit must not block widget mutations */
    }
    return plain;
  }

  async update(id, body, { userId = null, email = null } = {}) {
    const row = await DashboardWidgetInstance.findByPk(id);
    if (!row) throw new AppError('Widget instance not found', 404, { code: 'NOT_FOUND' });
    const before = row.toJSON ? row.toJSON() : row;

    const widgetKey = body.widgetKey != null ? body.widgetKey : before.widgetKey;
    const widget = await widgetRegistry.assertWidgetEnabled(widgetKey);
    const dataSourceKey = body.dataSourceKey !== undefined ? body.dataSourceKey : before.dataSourceKey;
    await dataSourceRegistry.assertDataSourceEnabled(dataSourceKey ?? null);

    const widgetConfig = body.widgetConfig !== undefined ? body.widgetConfig : before.widgetConfig;
    widgetRegistry.validateConfigAgainstSchema(widget.configSchema, widgetConfig);

    const actor = email || (userId ? String(userId) : null);
    /** @type {Record<string, unknown>} */
    const patch = { updatedBy: actor };
    if (body.widgetKey != null) patch.widgetKey = body.widgetKey;
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.widgetConfig !== undefined) patch.widgetConfig = widgetConfig;
    if (body.dataSourceKey !== undefined) patch.dataSourceKey = dataSourceKey;
    if (body.enabled !== undefined) patch.enabled = body.enabled === true;
    await row.update(patch);
    const after = row.toJSON ? row.toJSON() : row;
    try {
      await this.auditLogService?.log({
        action: 'widget_instance.updated',
        entityType: 'DashboardWidgetInstance',
        entityId: id,
        oldValue: { widgetKey: before.widgetKey, title: before.title },
        newValue: { widgetKey: after.widgetKey, title: after.title },
        userId,
      });
    } catch {
      /* audit must not block widget mutations */
    }
    return after;
  }

  async deleteById(id, { userId = null } = {}) {
    const row = await DashboardWidgetInstance.findByPk(id);
    if (!row) throw new AppError('Widget instance not found', 404, { code: 'NOT_FOUND' });
    const before = row.toJSON ? row.toJSON() : row;
    await row.destroy();
    try {
      await this.auditLogService?.log({
        action: 'widget_instance.deleted',
        entityType: 'DashboardWidgetInstance',
        entityId: id,
        oldValue: { widgetKey: before.widgetKey, title: before.title },
        userId,
      });
    } catch {
      /* audit must not block widget mutations */
    }
  }

  /**
   * @param {string} id
   * @returns {Promise<{ valid: boolean, errors: string[], widget: object, dataSource: object|null, previewData?: unknown }>}
   */
  async validateInstance(id) {
    const instance = await this.getById(id);
    const errors = [];
    let widget = null;
    let dataSource = null;
    let previewData = null;

    try {
      widget = await widgetRegistry.assertWidgetEnabled(instance.widgetKey);
    } catch (e) {
      errors.push(e.message || 'Invalid widget');
    }

    try {
      if (instance.dataSourceKey) {
        dataSource = await dataSourceRegistry.assertDataSourceEnabled(instance.dataSourceKey);
      }
      widgetRegistry.validateConfigAgainstSchema(widget?.configSchema, instance.widgetConfig);
    } catch (e) {
      errors.push(e.message || 'Invalid configuration');
    }

    if (errors.length === 0 && instance.dataSourceKey) {
      try {
        previewData = await resolveData(instance.dataSourceKey, instance.widgetConfig || {});
      } catch (e) {
        errors.push(e.message || 'Data source resolution failed');
      }
    }

    const valid = errors.length === 0;
    try {
      await this.auditLogService?.log({
        action: 'widget_instance.validated',
        entityType: 'DashboardWidgetInstance',
        entityId: id,
        newValue: { valid, errorCount: errors.length },
        userId: null,
      });
    } catch {
      /* audit must not block widget mutations */
    }

    return { valid, errors, widget, dataSource, previewData };
  }

  async resolveInstanceData(id) {
    const instance = await this.getById(id);
    if (!instance.enabled) {
      throw new AppError('Widget instance is disabled', 422, { code: 'INSTANCE_DISABLED' });
    }
    await widgetRegistry.assertWidgetEnabled(instance.widgetKey);
    if (!instance.dataSourceKey) {
      return { instance, data: null };
    }
    await dataSourceRegistry.assertDataSourceEnabled(instance.dataSourceKey);
    const data = await resolveData(instance.dataSourceKey, instance.widgetConfig || {});
    const widget = await widgetRegistry.getByKey(instance.widgetKey);
    return { instance, widget, data };
  }
}

module.exports = { WidgetInstanceService };
