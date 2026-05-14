const { logger } = require('../utils/logger');
const { getPlatformSettingsService } = require('./platform-settings.service');
const { msUntilNextUtcWallMultipleMinutes } = require('../utils/utc-schedule-align.util');

const { ZoneCrowdSamplingService } = require('./zone-crowd-sampling.service');

const { AiForecastService } = require('./ai-forecast.service');

const { AiRecommendationScoringService } = require('./ai-recommendation-scoring.service');

const { AiFeatureStoreService } = require('./ai-feature-store.service');

const { emitAiForecastUpdated } = require('../sockets');

const { AiPipelineRun } = require('../models');



class AiOrchestratorService {

  constructor() {

    this.sampling = new ZoneCrowdSamplingService();

    this.forecast = new AiForecastService();

    this.scoring = new AiRecommendationScoringService();

    this.featureStore = new AiFeatureStoreService();

  }



  /**

   * On-demand or scheduled: sample zones, persist forecasts, rescore open recommendations, notify clients.

   */

  async runFullPipeline() {

    const startedAt = new Date();

    let runRow = null;

    try {

      runRow = await AiPipelineRun.create({

        startedAt,

        status: 'running',

        parkSnapshotsWritten: 0,

        rideSnapshotsWritten: 0,

        labelsWritten: 0,

        featureStoreError: null,

        scoringError: null,

      });

    } catch (e) {

      logger.warn({ err: e?.message || String(e) }, 'ai_pipeline_runs insert failed');

    }



    let featureStoreError = null;

    let scoringError = null;

    let pipelineFatal = null;

    let pipelineFatalErr = null;

    let sampleResult = { count: 0 };

    let forecastResult = { count: 0 };

    let snapshotResult = { parkSnapshots: 0, rideSnapshots: 0 };

    let labelResult = { labelsWritten: 0 };

    let scoringResult = { scored: 0 };

    let totalDurationMs = 0;



    try {

      sampleResult = await this.sampling.sampleAllZones();

      forecastResult = await this.forecast.refreshZoneCrowdForecasts();

      try {

        snapshotResult = await this.featureStore.buildSnapshots();

        labelResult = await this.featureStore.buildLabels({ horizons: [15, 60] });

      } catch (e) {

        featureStoreError = e?.message || String(e);

        logger.warn({ err: featureStoreError }, 'feature store update after forecast failed');

      }

      try {

        scoringResult = await this.scoring.scoreAllOpen({ emitSocket: true });

      } catch (e) {

        scoringError = e?.message || String(e);

        logger.warn({ err: scoringError }, 'recommendation scoring after forecast failed');

      }

    } catch (e) {

      pipelineFatalErr = e;

      pipelineFatal = e?.message || String(e);

      featureStoreError = featureStoreError || pipelineFatal;

      logger.warn({ err: pipelineFatal }, 'ai pipeline failed before full completion');

    } finally {

      const finishedAt = new Date();

      totalDurationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

      let status = 'success';

      if (pipelineFatal) status = 'failed';

      else if (featureStoreError || scoringError) status = 'partial';

      if (runRow) {

        try {

          await runRow.update({

            finishedAt,

            durationMs: totalDurationMs,

            status,

            parkSnapshotsWritten: snapshotResult.parkSnapshots,

            rideSnapshotsWritten: snapshotResult.rideSnapshots,

            labelsWritten: labelResult.labelsWritten,

            featureStoreError: featureStoreError || null,

            scoringError: scoringError || null,

          });

        } catch (e) {

          logger.warn({ err: e?.message || String(e) }, 'ai_pipeline_runs finalize failed');

        }

      }

    }



    const payload = {

      sampledZones: sampleResult.count,

      forecastsCreated: forecastResult.count,

      parkSnapshotsWritten: snapshotResult.parkSnapshots,

      rideSnapshotsWritten: snapshotResult.rideSnapshots,

      labelsWritten: labelResult.labelsWritten,

      recommendationsScored: scoringResult.scored,

      durationMs: totalDurationMs,

      featureStoreError: featureStoreError || undefined,

      scoringError: scoringError || undefined,

      generatedAt: new Date().toISOString(),

    };

    logger.info(

      {

        durationMs: totalDurationMs,

        parkSnapshotsWritten: payload.parkSnapshotsWritten,

        rideSnapshotsWritten: payload.rideSnapshotsWritten,

        featureStoreError: payload.featureStoreError,

        scoringError: payload.scoringError,

      },

      'ai.full_pipeline.tick'

    );

    emitAiForecastUpdated(payload);

    if (pipelineFatalErr) throw pipelineFatalErr;

    return payload;

  }



  async scoreOpenRecommendations() {

    return this.scoring.scoreAllOpen({ emitSocket: true });

  }



  async scoreRecommendation(recommendationId) {

    return this.scoring.scoreRecommendationById(recommendationId, { emitSocket: true });

  }



  /**

   * @returns {() => void} disposer to stop the timer

   */

  /**
   * Reads enable/interval from PlatformSettingsService (DB → ENV → default) on each tick.
   * @returns {Promise<() => void>}
   */
  async startIfEnabled() {
    const ps = getPlatformSettingsService();
    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;

    const schedule = (ms) => {
      if (cancelled) return;
      timer = setTimeout(() => void runCycle(), ms);
    };

    const runCycle = async () => {
      if (cancelled) return;
      try {
        const enabled = await ps.getBoolean('AI_SAMPLING_ENABLED', true);
        if (!enabled) {
          schedule(10_000);
          return;
        }
        await this.runFullPipeline();
        const intervalSec = await ps.getNumber('AI_SAMPLING_INTERVAL_SECONDS', 300);
        const align5m = await ps.getBoolean('AI_SAMPLING_ALIGN_TO_5M_UTC', true);
        const nextMs = align5m
          ? msUntilNextUtcWallMultipleMinutes(5, new Date(), 2000)
          : intervalSec * 1000;
        schedule(Math.max(30_000, nextMs));
      } catch (e) {
        logger.warn({ err: e?.message || String(e) }, 'ai orchestrator tick failed');
        schedule(60_000);
      }
    };

    const initiallyOn = await ps.getBoolean('AI_SAMPLING_ENABLED', true);
    if (!initiallyOn) {
      return () => {};
    }
    schedule(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

}



module.exports = { AiOrchestratorService };

