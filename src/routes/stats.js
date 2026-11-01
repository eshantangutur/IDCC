import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function createStatsRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const userId = req.user.id;

    const [totals, byFormat, byCategory, trend, recent] = await Promise.all([
      db.get(
        `SELECT
          (SELECT COUNT(*) FROM analyses WHERE user_id = ?) AS analyses,
          (SELECT COUNT(*) FROM debate_cases WHERE user_id = ?) AS cases,
          (SELECT COUNT(*) FROM speeches WHERE user_id = ?) AS speeches,
          (SELECT COUNT(*) FROM analysis_findings f JOIN analyses a ON a.id = f.analysis_id WHERE a.user_id = ?) AS findings,
          (SELECT COUNT(*) FROM analysis_findings f JOIN analyses a ON a.id = f.analysis_id WHERE a.user_id = ? AND f.category = 'critical') AS critical,
          (SELECT COUNT(*) FROM analysis_findings f JOIN analyses a ON a.id = f.analysis_id WHERE a.user_id = ? AND f.category = 'strength') AS strengths
        `,
        userId,
        userId,
        userId,
        userId,
        userId,
        userId
      ),
      db.all(
        'SELECT format, COUNT(*) AS count FROM analyses WHERE user_id = ? GROUP BY format ORDER BY count DESC',
        userId
      ),
      db.all(
        `SELECT f.category, COUNT(*) AS count
         FROM analysis_findings f JOIN analyses a ON a.id = f.analysis_id
         WHERE a.user_id = ?
         GROUP BY f.category`,
        userId
      ),
      db.all(
        `SELECT date(created_at) AS day, COUNT(*) AS count
         FROM analyses
         WHERE user_id = ? AND created_at >= datetime('now', '-30 days')
         GROUP BY day ORDER BY day`,
        userId
      ),
      db.all(
        `SELECT a.id, a.format, a.speech_type, a.resolution, a.created_at, a.mode, s.title AS speech_title
         FROM analyses a LEFT JOIN speeches s ON s.id = a.speech_id
         WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 5`,
        userId
      ),
    ]);

    res.json({
      totals,
      byFormat,
      byCategory,
      trend,
      recent: recent.map((row) => ({
        id: row.id,
        format: row.format,
        speechType: row.speech_type,
        resolution: row.resolution,
        createdAt: row.created_at,
        mode: row.mode,
        speechTitle: row.speech_title,
      })),
    });
  });

  return router;
}
