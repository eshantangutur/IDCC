import { Router } from 'express';
import { badRequest } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { idParam, optionalId } from '../utils/validate.js';
import { latestVerifications, verifyEvidence } from '../services/evidence-service.js';

export function createEvidenceRouter({ db, config, logger, aiLimiter = null }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const roundId = optionalId(req.query.roundId, 'roundId');
    if (!roundId) throw badRequest('Provide roundId.', { field: 'roundId' });

    const owned = await db.get('SELECT id FROM rounds WHERE id = ? AND user_id = ?', roundId, req.user.id);
    if (!owned) throw badRequest('That round does not exist in your workspace.', { field: 'roundId' });

    const rows = await db.all(
      'SELECT * FROM evidence_records WHERE round_id = ? AND user_id = ? ORDER BY position, id',
      roundId,
      req.user.id
    );
    const verifications = await latestVerifications(db, rows.map((row) => row.id));

    res.json({
      evidence: rows.map((row) => ({
        id: row.id,
        roundId: row.round_id,
        speechId: row.speech_id,
        passage: row.passage,
        citation: row.citation,
        author: row.author,
        publishedAt: row.published_at,
        supportedClaim: row.supported_claim,
        speakerUsage: row.speaker_usage,
        supportsClaim: row.supports_claim === null ? null : Boolean(row.supports_claim),
        assessment: row.assessment,
        explanation: row.explanation,
        confidence: row.confidence,
        verification: verifications.get(row.id) ?? null,
      })),
      verificationAvailable: Boolean(config.evidence?.searchUrl),
    });
  });

  const verifyHandler = async (req, res, next) => {
    try {
      const result = await verifyEvidence({
        db,
        config,
        logger,
        userId: req.user.id,
        evidenceId: idParam(req.params.id, 'evidenceId'),
      });
      res.json({ verification: result });
    } catch (error) {
      next(error);
    }
  };

  // Rate limiting for this path is mounted in app.js to avoid counting twice.
  void aiLimiter;
  router.post('/:id/verify', verifyHandler);

  return router;
}
