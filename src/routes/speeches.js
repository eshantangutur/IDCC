import { Router } from 'express';
import { notFound } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { optionalString, requiredString } from '../utils/validate.js';
import { countWords } from '../services/analysis-service.js';

export function createSpeechesRouter({ db, config }) {
  const router = Router();
  router.use(requireAuth);

  async function loadOwnedSpeech(userId, speechId) {
    const row = await db.get('SELECT * FROM speeches WHERE id = ? AND user_id = ?', speechId, userId);
    if (!row) throw notFound('That speech does not exist in your workspace.');
    return row;
  }

  router.get('/:id', async (req, res) => {
    const speech = await loadOwnedSpeech(req.user.id, Number(req.params.id));
    const versions = await db.all(
      'SELECT id, version, label, word_count, created_at FROM speech_versions WHERE speech_id = ? ORDER BY version DESC',
      speech.id
    );
    const analyses = await db.all(
      `SELECT id, created_at, mode, is_demo, format, speech_type, summary
       FROM analyses WHERE speech_id = ? AND user_id = ? ORDER BY id DESC LIMIT 50`,
      speech.id,
      req.user.id
    );
    const caseRow = speech.case_id
      ? await db.get('SELECT id, title, resolution FROM debate_cases WHERE id = ? AND user_id = ?', speech.case_id, req.user.id)
      : null;

    res.json({
      speech: {
        id: speech.id,
        title: speech.title,
        format: speech.format,
        side: speech.side,
        speechType: speech.speech_type,
        resolution: speech.resolution,
        latestVersion: speech.latest_version,
        caseId: speech.case_id,
        createdAt: speech.created_at,
        updatedAt: speech.updated_at,
        case: caseRow ? { id: caseRow.id, title: caseRow.title, resolution: caseRow.resolution } : null,
      },
      versions: versions.map((row) => ({
        id: row.id,
        version: row.version,
        label: row.label,
        wordCount: row.word_count,
        createdAt: row.created_at,
      })),
      analyses: analyses.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        mode: row.mode,
        isDemo: Boolean(row.is_demo),
        format: row.format,
        speechType: row.speech_type,
        summary: row.summary,
      })),
    });
  });

  router.get('/:id/versions', async (req, res) => {
    const speech = await loadOwnedSpeech(req.user.id, Number(req.params.id));
    const includeContent = req.query.include === 'content';
    const rows = await db.all(
      'SELECT id, version, label, word_count, content, created_at FROM speech_versions WHERE speech_id = ? ORDER BY version DESC',
      speech.id
    );
    res.json({
      versions: rows.map((row) => ({
        id: row.id,
        version: row.version,
        label: row.label,
        wordCount: row.word_count,
        createdAt: row.created_at,
        ...(includeContent ? { content: row.content } : {}),
      })),
    });
  });

  router.post('/:id/versions', async (req, res) => {
    const speech = await loadOwnedSpeech(req.user.id, Number(req.params.id));
    const content = requiredString(req.body?.content, 'Speech text', { min: 20, max: config.ai.maxSpeechChars });
    const label = optionalString(req.body?.label, 'Version label', { max: 120 });

    const latest = await db.get(
      'SELECT * FROM speech_versions WHERE speech_id = ? ORDER BY version DESC LIMIT 1',
      speech.id
    );

    if (latest && latest.content === content) {
      return res.status(200).json({
        created: false,
        version: {
          id: latest.id,
          version: latest.version,
          label: latest.label,
          wordCount: latest.word_count,
          createdAt: latest.created_at,
        },
      });
    }

    const nextVersion = (latest?.version ?? 0) + 1;
    const inserted = await db.transaction(async (tx) => {
      const row = await tx.get(
        `INSERT INTO speech_versions (speech_id, version, content, label, word_count)
         VALUES (?, ?, ?, ?, ?) RETURNING *`,
        speech.id,
        nextVersion,
        content,
        label || `Revision ${nextVersion}`,
        countWords(content)
      );
      await tx.run(
        `UPDATE speeches SET latest_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
        nextVersion,
        speech.id,
        req.user.id
      );
      return row;
    });

    res.status(201).json({
      created: true,
      version: {
        id: inserted.id,
        version: inserted.version,
        label: inserted.label,
        wordCount: inserted.word_count,
        createdAt: inserted.created_at,
      },
    });
  });

  router.delete('/:id', async (req, res) => {
    const speech = await loadOwnedSpeech(req.user.id, Number(req.params.id));
    await db.transaction(async (tx) => {
      const ownedAnalyses = 'SELECT id FROM analyses WHERE speech_id = ? AND user_id = ?';
      await tx.run(`DELETE FROM analysis_findings WHERE analysis_id IN (${ownedAnalyses})`, speech.id, req.user.id);
      await tx.run(`DELETE FROM argument_nodes WHERE analysis_id IN (${ownedAnalyses})`, speech.id, req.user.id);
      await tx.run(`DELETE FROM argument_edges WHERE analysis_id IN (${ownedAnalyses})`, speech.id, req.user.id);
      await tx.run('DELETE FROM analyses WHERE speech_id = ? AND user_id = ?', speech.id, req.user.id);
      await tx.run('DELETE FROM speech_versions WHERE speech_id = ?', speech.id);
      await tx.run('DELETE FROM speeches WHERE id = ? AND user_id = ?', speech.id, req.user.id);
    });
    res.json({ deleted: true, id: speech.id });
  });

  return router;
}
