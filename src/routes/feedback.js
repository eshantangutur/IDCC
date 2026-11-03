import { Router } from 'express';
import { badRequest, notFound } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { enumValue, idParam, optionalId, optionalString } from '../utils/validate.js';

const RATINGS = ['accurate', 'partially_accurate', 'inaccurate'];
const TARGET_TYPES = ['analysis_finding', 'round_finding', 'round_argument'];

/**
 * Resolves a feedback target to the owner of the row so a user can never rate
 * another account's finding by guessing an id.
 */
async function resolveTarget(db, userId, targetType, targetId) {
  if (targetType === 'analysis_finding') {
    const row = await db.get(
      `SELECT f.id, f.analysis_id, a.speech_id, a.result_json
       FROM analysis_findings f JOIN analyses a ON a.id = f.analysis_id
       WHERE f.id = ? AND a.user_id = ?`,
      targetId,
      userId
    );
    if (!row) throw notFound('That finding does not exist in your workspace.');
    return { analysisId: row.analysis_id, roundId: null, speechId: row.speech_id };
  }

  if (targetType === 'round_finding') {
    const row = await db.get(
      'SELECT id, round_id FROM round_findings WHERE id = ? AND user_id = ?',
      targetId,
      userId
    );
    if (!row) throw notFound('That finding does not exist in your round.');
    return { analysisId: null, roundId: row.round_id, speechId: null };
  }

  const row = await db.get(
    'SELECT id, round_id, introduced_speech_id FROM round_arguments WHERE id = ? AND user_id = ?',
    targetId,
    userId
  );
  if (!row) throw notFound('That argument does not exist in your round.');
  return { analysisId: null, roundId: row.round_id, speechId: row.introduced_speech_id };
}

export function createFeedbackRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const targetType = enumValue(req.body?.targetType, TARGET_TYPES, 'targetType');
    const targetId = idParam(req.body?.targetId, 'targetId');
    const rating = enumValue(req.body?.rating, RATINGS, 'rating');
    const comment = optionalString(req.body?.comment, 'Comment', { max: 2000 });
    const suggestedCorrection = optionalString(req.body?.suggestedCorrection, 'Correction', { max: 4000 });

    const target = await resolveTarget(db, req.user.id, targetType, targetId);

    await db.run(
      `INSERT INTO finding_feedback
        (user_id, target_type, target_id, analysis_id, round_id, speech_id, rating, comment, suggested_correction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, target_type, target_id) DO UPDATE SET
         rating = excluded.rating,
         comment = excluded.comment,
         suggested_correction = excluded.suggested_correction,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      req.user.id,
      targetType,
      targetId,
      target.analysisId,
      target.roundId,
      target.speechId,
      rating,
      comment,
      suggestedCorrection
    );

    const stored = await db.get(
      `SELECT * FROM finding_feedback WHERE user_id = ? AND target_type = ? AND target_id = ?`,
      req.user.id,
      targetType,
      targetId
    );

    res.status(201).json({
      feedback: {
        id: stored.id,
        targetType: stored.target_type,
        targetId: stored.target_id,
        rating: stored.rating,
        comment: stored.comment,
        suggestedCorrection: stored.suggested_correction,
        createdAt: stored.created_at,
        updatedAt: stored.updated_at,
      },
    });
  });

  router.get('/', async (req, res) => {
    const roundId = optionalId(req.query.roundId, 'roundId');
    const analysisId = optionalId(req.query.analysisId, 'analysisId');
    if (!roundId && !analysisId) {
      throw badRequest('Provide roundId or analysisId.', { field: 'roundId' });
    }
    const rows = await db.all(
      `SELECT * FROM finding_feedback
       WHERE user_id = ? AND (${roundId ? 'round_id = ?' : 'analysis_id = ?'})
       ORDER BY id DESC`,
      req.user.id,
      roundId || analysisId
    );
    res.json({
      feedback: rows.map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        rating: row.rating,
        comment: row.comment,
        suggestedCorrection: row.suggested_correction,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  });

  /**
   * Human corrections are stored separately from the AI finding. The original
   * AI value is never overwritten.
   */
  router.post('/annotations', async (req, res) => {
    const targetType = enumValue(req.body?.targetType, TARGET_TYPES, 'targetType');
    const targetId = idParam(req.body?.targetId, 'targetId');
    const humanValue = optionalString(req.body?.humanValue, 'Correction', { max: 4000 });
    if (!humanValue) throw badRequest('Write the correction you want to store.', { field: 'humanValue' });
    const note = optionalString(req.body?.note, 'Note', { max: 2000 });
    const aiValue = optionalString(req.body?.aiValue, 'AI value', { max: 4000 });

    const target = await resolveTarget(db, req.user.id, targetType, targetId);

    const result = await db.run(
      `INSERT INTO human_annotations
        (user_id, target_type, target_id, analysis_id, round_id, ai_value, human_value, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id,
      targetType,
      targetId,
      target.analysisId,
      target.roundId,
      aiValue,
      humanValue,
      note
    );

    res.status(201).json({ annotationId: result.lastInsertRowid });
  });

  router.get('/annotations', async (req, res) => {
    const roundId = optionalId(req.query.roundId, 'roundId');
    const analysisId = optionalId(req.query.analysisId, 'analysisId');
    if (!roundId && !analysisId) {
      throw badRequest('Provide roundId or analysisId.', { field: 'roundId' });
    }
    const rows = await db.all(
      `SELECT * FROM human_annotations
       WHERE user_id = ? AND (${roundId ? 'round_id = ?' : 'analysis_id = ?'})
       ORDER BY id DESC LIMIT 200`,
      req.user.id,
      roundId || analysisId
    );
    res.json({
      annotations: rows.map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        aiValue: row.ai_value,
        humanValue: row.human_value,
        note: row.note,
        createdAt: row.created_at,
      })),
    });
  });

  return router;
}
