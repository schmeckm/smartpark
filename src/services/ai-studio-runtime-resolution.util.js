'use strict';

/**
 * Pure helpers for ML Studio runtime resolution explanations (tests + service).
 * Mirrors {@link AiStudioService.predict} order: entity → category → park → rules_fallback.
 */

function summarizeRow(plain) {
  if (!plain) return null;
  return {
    id: plain.id,
    modelScope: plain.modelScope,
    entityType: plain.entityType,
    entityId: plain.entityId ?? null,
    targetVariable: plain.targetVariable,
    version: plain.version,
    algorithm: plain.algorithm,
    activeFlag: !!plain.activeFlag,
    archivedAt: plain.archivedAt ?? null,
    mae: plain.mae ?? null,
    r2: plain.r2 ?? null,
  };
}

function activeRow(rows) {
  return rows.find((r) => r.activeFlag && !r.archivedAt) || null;
}

function bestMaeRow(rows) {
  const ok = rows.filter((r) => !r.archivedAt && r.mae != null && Number.isFinite(Number(r.mae)));
  if (!ok.length) return null;
  return [...ok].sort((a, b) => Number(a.mae) - Number(b.mae))[0];
}

/**
 * @param {object} args
 * @param {string|null} args.canonicalEntityId
 * @param {string} args.entityType
 * @param {import('./ai-studio.service').StudioPlainRow[]} args.entityCandidates plain rows
 * @param {import('./ai-studio.service').StudioPlainRow[]} args.categoryCandidates
 * @param {import('./ai-studio.service').StudioPlainRow[]} args.parkCandidates
 */
function buildStudioResolutionExplanation({ canonicalEntityId, entityType, entityCandidates, categoryCandidates, parkCandidates }) {
  /** @type {{ level: string, activeModel: ReturnType<summarizeRow>, bestMaeModel: ReturnType<summarizeRow>, candidateCount: number, reason: string }[]} */
  const levels = [];

  const pushLevel = (level, rows, skipReason) => {
    const act = activeRow(rows);
    const best = bestMaeRow(rows);
    let reason = skipReason;
    if (!skipReason) {
      if (!rows.length) {
        reason = 'No non-archived models in this scope.';
      } else if (act) {
        reason = 'Active deployment (activeFlag=true) found in this scope; Studio predict uses this model.';
      } else if (best) {
        reason =
          'There are candidate(s) in this scope, but none are active. Studio runtime ignores best-MAE candidates until you activate one.';
      } else {
        reason = 'No active model and no rows with MAE for comparison in this scope.';
      }
    }
    levels.push({
      level,
      activeModel: summarizeRow(act),
      bestMaeModel: summarizeRow(best),
      candidateCount: rows.filter((r) => !r.archivedAt).length,
      reason: reason || '',
    });
  };

  if (canonicalEntityId && entityType !== 'WHOLE_PARK') {
    pushLevel('entity', entityCandidates, null);
  } else {
    pushLevel('entity', [], 'Skipped: no specific entity resolved for this entity type / missing entityId.');
  }

  if (entityType !== 'WHOLE_PARK') {
    pushLevel('category', categoryCandidates, null);
  } else {
    pushLevel('category', [], 'Skipped: WHOLE_PARK target uses park-level models, not category scope.');
  }

  pushLevel('park', parkCandidates, null);

  let finalLevel = 'rules_fallback';
  let finalModel = null;
  let finalReason =
    'No active model at entity, category, or park scope. Studio predict uses heuristic rules_fallback for this target.';

  const entityAct = activeRow(entityCandidates);
  const catAct = activeRow(categoryCandidates);
  const parkAct = activeRow(parkCandidates);

  if (canonicalEntityId && entityType !== 'WHOLE_PARK' && entityAct) {
    finalLevel = 'entity';
    finalModel = summarizeRow(entityAct);
    finalReason = 'Entity scope wins first in prediction order (active model).';
  } else if (entityType !== 'WHOLE_PARK' && catAct) {
    finalLevel = 'category';
    finalModel = summarizeRow(catAct);
    finalReason = 'Category scope used: no active entity model; active category model selected.';
  } else if (parkAct) {
    finalLevel = 'park';
    finalModel = summarizeRow(parkAct);
    finalReason = 'Park scope used: no active entity/category model; active whole-park model selected.';
  }

  return {
    levels,
    final: {
      level: finalLevel,
      model: finalModel,
      reason: finalReason,
    },
    help: {
      bestVsActive:
        'Best model means best evaluation metrics. Active model means used at runtime.',
      productionNote:
        'Production ride wait ML uses ml_model_registry Ridge payloads separately; it is not selected from AI Studio models.',
    },
  };
}

module.exports = {
  buildStudioResolutionExplanation,
  summarizeRow,
  activeRow,
  bestMaeRow,
};
