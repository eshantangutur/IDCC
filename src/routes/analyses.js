import { Router } from 'express';
import { notFound } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { optionalId, optionalString, enumValue } from '../utils/validate.js';
import { FORMAT_IDS } from '../services/formats.js';
import { loadAnalysis } from '../services/analysis-service.js';
import { escapeLike } from './cases.js';

export function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function createAnalysesRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const format = req.query.format ? enumValue(String(req.query.format), FORMAT_IDS, 'format') : null;
    const query = optionalString(req.query.q, 'Search query', { max: 120 });
    const speechId = optionalId(req.query.speechId, 'speechId');
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '50', 10) || 50, 1), 100);

    const conditions = ['a.user_id = ?'];
    const params = [req.user.id];

    if (format) {
      conditions.push('a.format = ?');
      params.push(format);
    }
    if (speechId) {
      conditions.push('a.speech_id = ?');
      params.push(speechId);
    }
    if (query) {
      const like = `%${escapeLike(query)}%`;
      conditions.push("(a.resolution LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }

    const rows = db.all(
      `SELECT a.id, a.speech_id, a.case_id, a.format, a.side, a.speech_type, a.resolution,
              a.created_at, a.mode, a.is_demo, a.result_json, a.speech_version_id,
              s.title AS speech_title, v.version AS speech_version
       FROM analyses a
       LEFT JOIN speeches s ON s.id = a.speech_id
       LEFT JOIN speech_versions v ON v.id = a.speech_version_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.id DESC
       LIMIT ?`,
      ...params,
      limit
    );

    res.json({
      analyses: rows.map((row) => {
        const result = safeParse(row.result_json, {});
        return {
          id: row.id,
          speechId: row.speech_id,
          speechTitle: row.speech_title,
          speechVersion: row.speech_version,
          caseId: row.case_id,
          format: row.format,
          side: row.side,
          speechType: row.speech_type,
          resolution: row.resolution,
          createdAt: row.created_at,
          mode: row.mode,
          isDemo: Boolean(row.is_demo),
          summary: result.summary?.overview ?? null,
          counts: result.counts ?? null,
        };
      }),
    });
  });

  router.get('/:id', (req, res) => {
    const analysis = loadAnalysis(db, req.user.id, Number(req.params.id));
    res.json({ analysis });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.get('SELECT id FROM analyses WHERE id = ? AND user_id = ?', id, req.user.id);
    if (!row) throw notFound('That analysis does not exist in your workspace.');
    db.run('DELETE FROM analyses WHERE id = ? AND user_id = ?', id, req.user.id);
    res.json({ deleted: true, id });
  });

  return router;
}
