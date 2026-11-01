import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { enumValue, optionalId, optionalString, requiredString } from '../utils/validate.js';
import { FORMAT_IDS, getFormat } from '../services/formats.js';

export function createAnalyzeRouter({ config, analysisService }) {
  const router = Router();

  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const format = enumValue(req.body?.format, FORMAT_IDS, 'Format');
    const formatSpec = getFormat(format);
    const resolution = requiredString(req.body?.resolution, 'Resolution', { min: 5, max: 500 });
    const side = enumValue(req.body?.side, formatSpec.sides.map((entry) => entry.id), 'Side');
    const speechType = enumValue(req.body?.speechType, formatSpec.speechTypes, 'Speech type');
    const content = requiredString(req.body?.content, 'Speech text', {
      min: 40,
      max: config.ai.maxSpeechChars,
    });
    const caseId = optionalId(req.body?.caseId, 'caseId');
    const speechId = optionalId(req.body?.speechId, 'speechId');
    const title = optionalString(req.body?.title, 'Title', { max: 200 });

    const outcome = await analysisService.run({
      userId: req.user.id,
      formatSpec,
      resolution,
      side,
      speechType,
      content,
      caseId,
      speechId,
      title,
    });

    res.status(201).json({
      analysisId: outcome.analysisId,
      speechId: outcome.speechId,
      speechVersionId: outcome.speechVersionId,
      version: outcome.version,
      versionCreated: outcome.versionCreated,
      mode: outcome.mode,
      isDemo: outcome.mode === 'demo',
      provider: outcome.provider,
      model: outcome.model,
      latencyMs: outcome.latencyMs,
      attempts: outcome.attempts,
      demoReason: outcome.demoReason,
      comparison: outcome.comparison,
      counts: outcome.analysis.counts,
      summary: outcome.analysis.summary,
      redirect: `/report.html?id=${outcome.analysisId}`,
    });
  });

  return router;
}
