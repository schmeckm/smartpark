const Joi = require('joi');
const { OEE_REASON_CODES } = require('../../constants/oee-reason-codes');

const uuid = Joi.string().uuid();

const parkIdParam = Joi.object({
  parkId: uuid.required(),
});

const handoverEntryParams = Joi.object({
  parkId: uuid.required(),
  entryId: uuid.required(),
});

const assetIdParam = Joi.object({
  assetId: uuid.required(),
});

const listAssetsQuery = Joi.object({
  parkId: uuid.optional(),
  assetTypeCode: Joi.string().trim().max(32).optional(),
  limit: Joi.number().integer().min(1).max(2000).optional(),
  offset: Joi.number().integer().min(0).optional(),
});

const liveObservationsQuery = Joi.object({
  parkId: uuid.optional(),
  limit: Joi.number().integer().min(1).max(2000).optional(),
  metricCode: Joi.string().trim().max(64).optional(),
});

const rideMasterBody = Joi.object({
  capacityPph: Joi.number().integer().allow(null),
  theoreticalCapacityPph: Joi.number().integer().allow(null),
  dispatchIntervalSec: Joi.number().integer().allow(null),
  cycleTimeSec: Joi.number().integer().allow(null),
  plannedCycleTimeSec: Joi.number().integer().allow(null),
  opcReferenceCycleTimeSec: Joi.number().integer().allow(null),
  maxQueueGuests: Joi.number().integer().allow(null),
  maxSpeedKmh: Joi.number().integer().min(0).max(500).allow(null),
  structureHeightM: Joi.number().allow(null),
  trackLengthM: Joi.number().integer().min(0).allow(null),
  virtualLineEnabled: Joi.boolean().optional(),
  seatsPerCycle: Joi.number().integer().allow(null),
  trainsCount: Joi.number().integer().allow(null),
  rideCategory: Joi.string().trim().max(80).allow(null, ''),
  minStaff: Joi.number().integer().allow(null),
  normalStaff: Joi.number().integer().allow(null),
  peakStaff: Joi.number().integer().allow(null),
  operatorMin: Joi.number().integer().allow(null),
  operatorStandard: Joi.number().integer().allow(null),
  operatorPeak: Joi.number().integer().allow(null),
  weatherSensitive: Joi.boolean().optional(),
  rainSensitive: Joi.boolean().optional(),
  windLimitKmh: Joi.number().allow(null),
  minHeightCm: Joi.number().integer().allow(null),
  maxHeightCm: Joi.number().integer().allow(null),
  thrillLevel: Joi.number().integer().allow(null),
  manufacturer: Joi.string().trim().max(160).allow(null, ''),
  buildYear: Joi.number().integer().min(1800).max(2100).allow(null),
  plcType: Joi.string().trim().max(80).allow(null, ''),
  maintenanceClass: Joi.string().trim().max(16).allow(null, ''),
  targets: Joi.object({
    targetAvailabilityPct: Joi.number().allow(null),
    targetWaitTimeMin: Joi.number().integer().allow(null),
    targetUtilizationPct: Joi.number().allow(null),
    targetOeePct: Joi.number().allow(null),
    revenuePriority: Joi.string().trim().max(32).allow(null, ''),
  }).optional(),
}).min(1);

const enrichTemplateBody = Joi.object({
  templateCode: Joi.string().trim().max(64).default('RIDE_DEFAULT'),
});

const assetOverrideParams = Joi.object({
  assetId: uuid.required(),
  overrideId: uuid.required(),
});

const runtimeOverrideCreateBody = Joi.object({
  payload: Joi.object().required(),
  validFrom: Joi.date().iso().allow(null),
  validTo: Joi.date().iso().allow(null),
  active: Joi.boolean().optional(),
});

const runtimeOverridePatchBody = Joi.object({
  payload: Joi.object().optional(),
  validFrom: Joi.date().iso().allow(null),
  validTo: Joi.date().iso().allow(null),
  active: Joi.boolean().optional(),
}).min(1);

const zoneNormalizationPreviewQuery = Joi.object({
  parkSlug: Joi.string().trim().min(1).max(128).required(),
  type: Joi.string().trim().valid('RESTAURANT', 'SHOW').default('RESTAURANT'),
});

const zoneNormalizationApplyBody = Joi.object({
  parkSlug: Joi.string().trim().min(1).max(128).required(),
  type: Joi.string().trim().valid('RESTAURANT', 'SHOW').default('RESTAURANT'),
  dryRun: Joi.boolean().default(true),
  overrides: Joi.array()
    .items(
      Joi.object({
        assetId: uuid.required(),
        zoneSlug: Joi.string().trim().allow('', null).optional(),
      })
    )
    .optional(),
});

const parkRidesQuery = Joi.object({
  parkId: uuid.optional(),
});

const operationalContextQuery = Joi.object({
  /** ISO-8601 instant; omitted = now */
  at: Joi.string().trim().max(64).optional(),
});

const parkLevel0Body = Joi.object({
  name: Joi.string().trim().max(200).optional(),
  slug: Joi.string().trim().max(128).optional(),
  timezone: Joi.string().trim().max(64).allow(null, '').optional(),
  latitude: Joi.number().min(-90).max(90).allow(null).optional(),
  longitude: Joi.number().min(-180).max(180).allow(null).optional(),
  /**
   * Manual baseline profile for park-wide defaults (L0),
   * e.g. opening hours templates or seasonal assumptions.
   */
  level0: Joi.object({
    openingHoursNotes: Joi.string().max(4000).allow('', null).optional(),
    seasonNotes: Joi.string().max(4000).allow('', null).optional(),
    baselineOpenTime: Joi.string().trim().max(10).allow('', null).optional(),
    baselineCloseTime: Joi.string().trim().max(10).allow('', null).optional(),
    annualOpenFrom: Joi.string().trim().max(10).allow('', null).optional(),
    annualOpenUntil: Joi.string().trim().max(10).allow('', null).optional(),
    keyFacts: Joi.object({
      annualVisitorsTarget: Joi.number().integer().min(0).allow(null).optional(),
      areaHectares: Joi.number().min(0).allow(null).optional(),
      maxDailyCapacity: Joi.number().integer().min(0).allow(null).optional(),
      parkingSpaces: Joi.number().integer().min(0).allow(null).optional(),
      openingYear: Joi.number().integer().min(1800).max(2200).allow(null).optional(),
      operatorName: Joi.string().trim().max(160).allow('', null).optional(),
      emergencyPhone: Joi.string().trim().max(40).allow('', null).optional(),
      websiteUrl: Joi.string().uri().max(500).allow('', null).optional(),
    }).optional(),
  }).optional(),
  /**
   * Sparkplug routing documentation per park (UNS/MQTT): logical edge nodes (gateways).
   * Operational publish paths still come from adapter contextJson / env — this block is the maintained plan of record in MDM.
   */
  sparkplug: Joi.object({
    documentationNotes: Joi.string().max(4000).allow('', null).optional(),
    defaultEdgeNodeId: Joi.string().trim().max(120).allow('', null).optional(),
    edges: Joi.array()
      .items(
        Joi.object({
          id: Joi.string().trim().max(64).required(),
          label: Joi.string().trim().max(160).allow('', null).optional(),
          edgeNodeId: Joi.string().trim().max(120).required(),
          zoneKey: Joi.string().trim().max(80).allow('', null).optional(),
          role: Joi.string().valid('PRIMARY', 'ZONE', 'VIRTUAL_LAB', 'BACKUP', 'OTHER').optional(),
          notes: Joi.string().max(2000).allow('', null).optional(),
        })
      )
      .max(32)
      .optional(),
  }).optional(),
}).min(1);

const downtimeRangeQuery = Joi.object({
  from: Joi.string().trim().required(),
  to: Joi.string().trim().required(),
  limit: Joi.number().integer().min(1).max(500).optional(),
});

const downtimeParetoQuery = Joi.object({
  from: Joi.string().trim().required(),
  to: Joi.string().trim().required(),
  plannedScope: Joi.string().valid('all', 'planned', 'unplanned').optional(),
});

const downtimeEventCreateBody = Joi.object({
  startedAt: Joi.string().trim().required(),
  endedAt: Joi.string().trim().allow(null, '').optional(),
  planned: Joi.boolean().required(),
  reasonCode: Joi.string()
    .valid(...OEE_REASON_CODES)
    .required(),
  notes: Joi.string().max(4000).allow(null, '').optional(),
  source: Joi.string().trim().max(32).optional(),
});

const downtimeEventPatchBody = Joi.object({
  startedAt: Joi.string().trim().optional(),
  endedAt: Joi.string().trim().allow(null, '').optional(),
  planned: Joi.boolean().optional(),
  reasonCode: Joi.string()
    .valid(...OEE_REASON_CODES)
    .optional(),
  notes: Joi.string().max(4000).allow(null, '').optional(),
}).min(1);

const assetEventParams = Joi.object({
  assetId: uuid.required(),
  eventId: uuid.required(),
});

const pdmRuleParams = Joi.object({
  assetId: uuid.required(),
  ruleId: uuid.required(),
});

const pdmRuleCreateBody = Joi.object({
  metricName: Joi.string().trim().max(160).required(),
  label: Joi.string().trim().max(200).allow('', null),
  warnAbove: Joi.number().allow(null),
  criticalAbove: Joi.number().allow(null),
  warnBelow: Joi.number().allow(null),
  criticalBelow: Joi.number().allow(null),
  unit: Joi.string().trim().max(32).allow('', null),
  notes: Joi.string().max(4000).allow('', null),
  enabled: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().min(-99999).max(99999).optional(),
}).custom((v, helpers) => {
  const keys = ['warnAbove', 'criticalAbove', 'warnBelow', 'criticalBelow'];
  const any = keys.some((k) => v[k] !== null && v[k] !== undefined && Number.isFinite(Number(v[k])));
  if (!any) {
    return helpers.error('any.invalid', {
      message: 'At least one numeric threshold (warn/critical above/below) is required',
    });
  }
  return v;
});

const pdmRulePatchBody = Joi.object({
  metricName: Joi.string().trim().max(160).optional(),
  label: Joi.string().trim().max(200).allow('', null).optional(),
  warnAbove: Joi.number().allow(null).optional(),
  criticalAbove: Joi.number().allow(null).optional(),
  warnBelow: Joi.number().allow(null).optional(),
  criticalBelow: Joi.number().allow(null).optional(),
  unit: Joi.string().trim().max(32).allow('', null).optional(),
  notes: Joi.string().max(4000).allow('', null).optional(),
  enabled: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().min(-99999).max(99999).optional(),
}).min(1);

const pdmEvaluationLogsQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
});

const shiftHandoverListQuery = Joi.object({
  from: Joi.string().trim().optional(),
  to: Joi.string().trim().optional(),
  /** Teilstring in notes oder shift_label (ILIKE, ohne %/_ aus Nutzertext) */
  q: Joi.string().trim().max(200).allow('').optional(),
  /** all | park (nur parkweite Übergaben) | asset (linkedAssetId Pflicht) */
  scope: Joi.string().valid('all', 'park', 'asset').optional(),
  linkedAssetId: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
});

const shiftHandoverCreateBody = Joi.object({
  windowFrom: Joi.string().trim().required(),
  windowTo: Joi.string().trim().required(),
  shiftLabel: Joi.string().trim().max(64).allow('', null).optional(),
  notes: Joi.string().max(16000).allow('', null).optional(),
  includeDowntimeSnapshot: Joi.boolean().optional(),
  includeIncidentSnapshot: Joi.boolean().optional(),
  /** Optional: Park-Objekt (UUID); Stillstands-/Vorfalls-Snapshots nur für dieses Asset */
  linkedParkAssetId: Joi.string().uuid().allow(null, '').optional(),
  /** Optional: Aufgabenliste (MVP) */
  followUpTasks: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().trim().max(80).optional(),
        title: Joi.string().trim().max(280).required(),
        ownerUserId: Joi.string().uuid().allow(null).optional(),
        dueAt: Joi.string().trim().max(64).allow(null, '').optional(),
        status: Joi.string().valid('OPEN', 'DONE', 'CANCELLED').optional(),
      })
    )
    .max(100)
    .optional(),
  reminderDelayMin: Joi.number().integer().min(0).max(60 * 24 * 14).optional(),
});

const shiftHandoverAcknowledgeBody = Joi.object({
  note: Joi.string().max(4000).allow('', null).optional(),
});

const shiftHandoverTasksPatchBody = Joi.object({
  tasks: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().trim().max(80).optional(),
        title: Joi.string().trim().max(280).required(),
        ownerUserId: Joi.string().uuid().allow(null).optional(),
        dueAt: Joi.string().trim().max(64).allow(null, '').optional(),
        status: Joi.string().valid('OPEN', 'DONE', 'CANCELLED').optional(),
      })
    )
    .max(100)
    .required(),
});

const shiftHandoverReminderQuery = Joi.object({
  limit: Joi.number().integer().min(1).max(200).optional(),
});

/** Park internal UUID, slug, or external entity id (same resolution as master-data). */
const parkSlugParam = Joi.object({
  parkSlug: Joi.string().trim().min(1).max(128).required(),
});

const geoPressureQuery = Joi.object({
  assetTypeCode: Joi.string().trim().max(32).allow('', null).optional(),
  provider: Joi.string().trim().max(32).optional(),
});

const geoHotspotsQuery = Joi.object({
  assetTypeCode: Joi.string().trim().max(32).allow('', null).optional(),
  limit: Joi.number().integer().min(1).max(50).optional(),
});

const geoPressureSimulateBody = Joi.object({
  overrides: Joi.object()
    .pattern(
      Joi.string().trim().min(1).max(200),
      Joi.object({
        waitMin: Joi.number().min(0).max(400).optional(),
        downtime: Joi.boolean().optional(),
      })
    )
    .optional(),
}).default({});

const geoFlowSimulationQuery = Joi.object({
  mode: Joi.string().valid('synthetic', 'from_log').optional(),
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  guestCount: Joi.number().integer().min(50).max(8000).optional(),
  transitionCount: Joi.number().integer().min(2).max(25).optional(),
  maxHopM: Joi.number().integer().min(120).max(1500).optional(),
  seed: Joi.number().integer().min(0).max(2147483646).optional(),
  assetTypeCode: Joi.string().trim().max(32).allow('', null).optional(),
  topEdges: Joi.number().integer().min(10).max(80).optional(),
});

const geoFlowEventsBatchBody = Joi.object({
  events: Joi.array()
    .items(
      Joi.object({
        caseId: Joi.string().trim().min(1).max(160).required(),
        assetId: uuid.required(),
        occurredAt: Joi.date().iso().required(),
        eventType: Joi.string().trim().max(40).optional(),
        source: Joi.string().trim().max(64).optional(),
        payload: Joi.object().optional(),
      })
    )
    .min(1)
    .max(500)
    .required(),
});

module.exports = {
  parkIdParam,
  handoverEntryParams,
  assetIdParam,
  listAssetsQuery,
  liveObservationsQuery,
  rideMasterBody,
  enrichTemplateBody,
  parkRidesQuery,
  operationalContextQuery,
  parkLevel0Body,
  downtimeRangeQuery,
  downtimeParetoQuery,
  downtimeEventCreateBody,
  downtimeEventPatchBody,
  assetEventParams,
  pdmRuleParams,
  pdmRuleCreateBody,
  pdmRulePatchBody,
  pdmEvaluationLogsQuery,
  shiftHandoverListQuery,
  shiftHandoverCreateBody,
  shiftHandoverAcknowledgeBody,
  shiftHandoverTasksPatchBody,
  shiftHandoverReminderQuery,
  assetOverrideParams,
  runtimeOverrideCreateBody,
  runtimeOverridePatchBody,
  zoneNormalizationPreviewQuery,
  zoneNormalizationApplyBody,
  parkSlugParam,
  geoPressureQuery,
  geoHotspotsQuery,
  geoPressureSimulateBody,
  geoFlowSimulationQuery,
  geoFlowEventsBatchBody,
};
