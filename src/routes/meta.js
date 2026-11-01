import { Router } from 'express';
import { FORMATS, SCORE_SCALE } from '../services/formats.js';
import { publicAiStatus } from '../config.js';

const WEAKNESS_TYPE_LABELS = {
  factual_inaccuracy: 'Factual inaccuracy',
  missing_evidence: 'Missing evidence',
  logical_weakness: 'Logical weakness',
  structural_weakness: 'Structural weakness',
  framework_weakness: 'Framework weakness',
  weighing_weakness: 'Weighing weakness',
  strategic_judgment: 'Strategic judgment',
  clarity: 'Clarity',
};

const CATEGORY_LABELS = {
  critical: 'Critical weakness',
  moderate: 'Moderate weakness',
  minor: 'Minor weakness',
  improvement: 'Potential improvement',
  strength: 'Strong component',
};

export function createMetaRouter({ config }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      app: {
        name: 'Argument Forensics',
        tagline: 'Dissect Arguments. Expose Weaknesses. Strengthen Reasoning.',
        version: '1.0.0',
      },
      formats: FORMATS.map((format) => ({
        id: format.id,
        name: format.name,
        abbreviation: format.abbreviation,
        tagline: format.tagline,
        description: format.description,
        sides: format.sides,
        speechTypes: format.speechTypes,
        focusAreas: format.focusAreas,
        rubric: format.rubric,
        specialTool: {
          key: format.formatSpecific.key,
          label: format.formatSpecific.label,
          description: format.formatSpecific.description,
        },
      })),
      scoreScale: SCORE_SCALE,
      weaknessTypes: WEAKNESS_TYPE_LABELS,
      categories: CATEGORY_LABELS,
      ai: publicAiStatus(config),
      limits: {
        maxSpeechChars: config.ai.maxSpeechChars,
        minSpeechChars: 40,
        maxCases: 200,
        maxUploadBytes: config.upload.maxBytes,
      },
    });
  });

  return router;
}
