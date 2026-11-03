import { Router } from 'express';
import { badRequest, notFound } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { enumValue, idParam, optionalId, optionalString, requiredString } from '../utils/validate.js';
import { FORMAT_IDS, getFormat } from '../services/formats.js';

function serialize(row) {
  let expected = null;
  try {
    expected = JSON.parse(row.expected_json || '{}');
  } catch {
    expected = null;
  }
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    speechType: row.speech_type,
    resolution: row.resolution,
    side: row.side,
    speechText: row.speech_text,
    expected,
    notes: row.notes,
    isShared: Boolean(row.is_shared),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Benchmark examples are human-reviewed annotations used to check the analyser
 * later. They are private per account by default and are never used to train a
 * model. Setting isShared only marks the example as shareable; nothing is
 * published from this endpoint.
 */
export function createBenchmarksRouter({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const rows = await db.all(
      'SELECT * FROM benchmark_examples WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200',
      req.user.id
    );
    res.json({ benchmarks: rows.map(serialize) });
  });

  router.get('/:id', async (req, res) => {
    const row = await db.get(
      'SELECT * FROM benchmark_examples WHERE id = ? AND user_id = ?',
      idParam(req.params.id),
      req.user.id
    );
    if (!row) throw notFound('That benchmark example does not exist in your workspace.');
    res.json({ benchmark: serialize(row) });
  });

  router.post('/', async (req, res) => {
    const title = requiredString(req.body?.title, 'Title', { max: 200 });
    const format = enumValue(req.body?.format, FORMAT_IDS, 'Format');
    const formatSpec = getFormat(format);

    let speechText = optionalString(req.body?.speechText, 'Speech text', { max: 128000 });
    let speechType = optionalString(req.body?.speechType, 'Speech type', { max: 120 });
    let resolution = optionalString(req.body?.resolution, 'Resolution', { max: 500 });
    let side = optionalString(req.body?.side, 'Side', { max: 40 });
    let expected = req.body?.expected ?? null;

    const fromAnalysisId = optionalId(req.body?.fromAnalysisId, 'fromAnalysisId');
    if (fromAnalysisId) {
      const analysis = await db.get(
        'SELECT * FROM analyses WHERE id = ? AND user_id = ?',
        fromAnalysisId,
        req.user.id
      );
      if (!analysis) throw notFound('That analysis does not exist in your workspace.');
      speechText = speechText || analysis.content;
      speechType = speechType || analysis.speech_type;
      resolution = resolution || analysis.resolution;
      side = side || analysis.side;
      if (!expected) {
        try {
          const result = JSON.parse(analysis.result_json);
          expected = {
            arguments: result.structure ?? null,
            findings: result.findings ?? [],
            nodes: result.nodes ?? [],
            edges: result.edges ?? [],
          };
        } catch {
          expected = null;
        }
      }
    }

    if (!speechText || speechText.trim().length < 20) {
      throw badRequest('Speech text must be at least 20 characters.', { field: 'speechText' });
    }
    if (side && !formatSpec.sides.some((entry) => entry.id === side)) {
      throw badRequest('The side is not valid for this format.', { field: 'side' });
    }
    if (speechType && !formatSpec.speechTypes.includes(speechType)) {
      throw badRequest('The speech type is not valid for this format.', { field: 'speechType' });
    }

    const result = await db.run(
      `INSERT INTO benchmark_examples
        (user_id, title, format, speech_type, resolution, side, speech_text, expected_json, notes, is_shared)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id,
      title,
      format,
      speechType,
      resolution,
      side,
      speechText,
      JSON.stringify(expected ?? {}),
      optionalString(req.body?.notes, 'Notes', { max: 4000 }),
      req.body?.isShared === true ? 1 : 0
    );

    const row = await db.get('SELECT * FROM benchmark_examples WHERE id = ?', result.lastInsertRowid);
    res.status(201).json({ benchmark: serialize(row) });
  });

  router.put('/:id', async (req, res) => {
    const existing = await db.get(
      'SELECT * FROM benchmark_examples WHERE id = ? AND user_id = ?',
      idParam(req.params.id),
      req.user.id
    );
    if (!existing) throw notFound('That benchmark example does not exist in your workspace.');

    await db.run(
      `UPDATE benchmark_examples
       SET title = ?, notes = ?, expected_json = ?, is_shared = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
      req.body?.title === undefined ? existing.title : requiredString(req.body.title, 'Title', { max: 200 }),
      req.body?.notes === undefined ? existing.notes : optionalString(req.body.notes, 'Notes', { max: 4000 }),
      req.body?.expected === undefined ? existing.expected_json : JSON.stringify(req.body.expected),
      req.body?.isShared === undefined ? existing.is_shared : req.body.isShared ? 1 : 0,
      existing.id,
      req.user.id
    );

    const row = await db.get('SELECT * FROM benchmark_examples WHERE id = ?', existing.id);
    res.json({ benchmark: serialize(row) });
  });

  router.delete('/:id', async (req, res) => {
    const result = await db.run(
      'DELETE FROM benchmark_examples WHERE id = ? AND user_id = ?',
      idParam(req.params.id),
      req.user.id
    );
    if (!result.changes) throw notFound('That benchmark example does not exist in your workspace.');
    res.json({ deleted: true, id: idParam(req.params.id) });
  });

  return router;
}
