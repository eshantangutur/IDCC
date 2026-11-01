import { Router } from 'express';
import { badRequest, notFound } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { ensureArray, enumValue, optionalString, requiredString } from '../utils/validate.js';
import { FORMAT_IDS, getFormat, isValidSide } from '../services/formats.js';

const MAX_CASES = 200;

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function serializeContentions(value) {
  const list = ensureArray(value, 'Contentions', { max: 25 });
  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw badRequest(`Contention ${index + 1} must be an object with a title and text.`, { field: 'contentions' });
    }
    return {
      title: requiredString(entry.title, `Contention ${index + 1} title`, { max: 160 }),
      body: requiredString(entry.body ?? entry.text, `Contention ${index + 1} text`, { max: 4000 }),
    };
  });
}

function parseContentionsColumn(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeCase(row) {
  return {
    id: row.id,
    title: row.title,
    resolution: row.resolution,
    format: row.format,
    side: row.side,
    notes: row.notes,
    contentions: parseContentionsColumn(row.contentions_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    speechCount: row.speech_count ?? 0,
    analysisCount: row.analysis_count ?? 0,
  };
}

export function createCasesRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  function loadOwnedCase(userId, caseId) {
    const row = db.get(
      `SELECT c.*,
        (SELECT COUNT(*) FROM speeches s WHERE s.case_id = c.id) AS speech_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.case_id = c.id) AS analysis_count
       FROM debate_cases c WHERE c.id = ? AND c.user_id = ?`,
      caseId,
      userId
    );
    if (!row) throw notFound('That case does not exist in your workspace.');
    return row;
  }

  router.get('/', (req, res) => {
    const format = req.query.format ? enumValue(String(req.query.format), FORMAT_IDS, 'format') : null;
    const query = optionalString(req.query.q, 'Search query', { max: 120 });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '100', 10) || 100, 1), MAX_CASES);

    const conditions = ['c.user_id = ?'];
    const params = [req.user.id];

    if (format) {
      conditions.push('c.format = ?');
      params.push(format);
    }
    if (query) {
      const like = `%${escapeLike(query)}%`;
      conditions.push("(c.title LIKE ? ESCAPE '\\' OR c.resolution LIKE ? ESCAPE '\\' OR c.notes LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }

    const rows = db.all(
      `SELECT c.*,
        (SELECT COUNT(*) FROM speeches s WHERE s.case_id = c.id) AS speech_count,
        (SELECT COUNT(*) FROM analyses a WHERE a.case_id = c.id) AS analysis_count
       FROM debate_cases c
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.updated_at DESC
       LIMIT ?`,
      ...params,
      limit
    );

    res.json({ cases: rows.map(serializeCase) });
  });

  router.post('/', (req, res) => {
    const title = requiredString(req.body?.title, 'Case title', { max: 160 });
    const resolution = requiredString(req.body?.resolution, 'Resolution', { max: 500 });
    const format = enumValue(req.body?.format, FORMAT_IDS, 'Format');
    const formatSpec = getFormat(format);
    const side = enumValue(req.body?.side, formatSpec.sides.map((entry) => entry.id), 'Side');
    const notes = optionalString(req.body?.notes, 'Notes', { max: 8000 });
    const contentions = req.body?.contentions === undefined ? [] : serializeContentions(req.body.contentions);

    const count = db.get('SELECT COUNT(*) AS count FROM debate_cases WHERE user_id = ?', req.user.id);
    if (count.count >= MAX_CASES) {
      throw badRequest(`You have reached the ${MAX_CASES} case limit. Delete a case to create another.`);
    }

    const result = db.run(
      `INSERT INTO debate_cases (user_id, title, resolution, format, side, notes, contentions_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.user.id,
      title,
      resolution,
      format,
      side,
      notes,
      JSON.stringify(contentions)
    );

    res.status(201).json({ case: serializeCase(loadOwnedCase(req.user.id, result.lastInsertRowid)) });
  });

  router.get('/:id', (req, res) => {
    const caseRow = loadOwnedCase(req.user.id, Number(req.params.id));
    const speeches = db.all(
      `SELECT s.id, s.title, s.format, s.side, s.speech_type, s.latest_version, s.created_at, s.updated_at,
        (SELECT COUNT(*) FROM analyses a WHERE a.speech_id = s.id) AS analysis_count,
        (SELECT id FROM analyses a WHERE a.speech_id = s.id ORDER BY a.id DESC LIMIT 1) AS last_analysis_id,
        (SELECT created_at FROM analyses a WHERE a.speech_id = s.id ORDER BY a.id DESC LIMIT 1) AS last_analyzed_at
       FROM speeches s WHERE s.case_id = ? AND s.user_id = ?
       ORDER BY s.updated_at DESC`,
      caseRow.id,
      req.user.id
    );

    res.json({
      case: serializeCase(caseRow),
      speeches: speeches.map((row) => ({
        id: row.id,
        title: row.title,
        format: row.format,
        side: row.side,
        speechType: row.speech_type,
        latestVersion: row.latest_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        analysisCount: row.analysis_count,
        lastAnalysisId: row.last_analysis_id,
        lastAnalyzedAt: row.last_analyzed_at,
      })),
    });
  });

  router.put('/:id', (req, res) => {
    const caseId = Number(req.params.id);
    const existing = loadOwnedCase(req.user.id, caseId);

    const title = req.body?.title === undefined ? existing.title : requiredString(req.body.title, 'Case title', { max: 160 });
    const resolution = req.body?.resolution === undefined
      ? existing.resolution
      : requiredString(req.body.resolution, 'Resolution', { max: 500 });
    const format = req.body?.format === undefined ? existing.format : enumValue(req.body.format, FORMAT_IDS, 'Format');
    const formatSpec = getFormat(format);
    const side = req.body?.side === undefined
      ? existing.side
      : enumValue(req.body.side, formatSpec.sides.map((entry) => entry.id), 'Side');

    if (!isValidSide(format, side)) {
      throw badRequest('The selected side is not valid for this format.', { field: 'side' });
    }

    const notes = req.body?.notes === undefined ? existing.notes : optionalString(req.body.notes, 'Notes', { max: 8000 });
    const contentions = req.body?.contentions === undefined
      ? parseContentionsColumn(existing.contentions_json)
      : serializeContentions(req.body.contentions);

    db.run(
      `UPDATE debate_cases
       SET title = ?, resolution = ?, format = ?, side = ?, notes = ?, contentions_json = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
      title,
      resolution,
      format,
      side,
      notes,
      JSON.stringify(contentions),
      caseId,
      req.user.id
    );

    res.json({ case: serializeCase(loadOwnedCase(req.user.id, caseId)) });
  });

  router.delete('/:id', (req, res) => {
    const caseId = Number(req.params.id);
    loadOwnedCase(req.user.id, caseId);
    db.run('DELETE FROM debate_cases WHERE id = ? AND user_id = ?', caseId, req.user.id);
    res.json({ deleted: true, id: caseId });
  });

  return router;
}
