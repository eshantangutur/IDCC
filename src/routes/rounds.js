import { Router } from 'express';
import { badRequest } from '../utils/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { ensureArray, enumValue, idParam, optionalString, requiredString } from '../utils/validate.js';
import {
  ARGUMENT_STATUSES,
  ARGUMENT_TYPES,
  FORMAT_IDS,
  getFormat,
  getRoundStructure,
  getSideLabel,
} from '../services/formats.js';
import { buildRoundGraph, buildRoundTimeline } from '../services/graph-service.js';
import {
  MAX_ROUND_SPEECHES,
  MAX_ROUND_SPEECH_CHARS,
  saveRoundAnalysis,
} from '../services/round-service.js';
import { latestVerifications } from '../services/evidence-service.js';

function speechInput(body) {
  const content = body?.content === undefined ? '' : String(body.content);
  if (content.trim().length < 20) {
    throw badRequest('Speech text must be at least 20 characters.', { field: 'content' });
  }
  if (content.length > MAX_ROUND_SPEECH_CHARS) {
    throw badRequest(`Speech text must be ${MAX_ROUND_SPEECH_CHARS} characters or fewer.`, { field: 'content' });
  }
  return {
    side: body?.side,
    speechType: body?.speechType,
    speakerName: optionalString(body?.speakerName, 'Speaker name', { max: 120 }),
    team: optionalString(body?.team, 'Team', { max: 120 }),
    content,
    position: body?.position === undefined ? undefined : idParam(body.position, 'position'),
  };
}

export function createRoundsRouter({ config, logger, ai, roundService, aiLimiter }) {
  const router = Router();
  router.use(requireAuth);

  async function feedbackByTarget(userId, roundId) {
    const rows = await router.db.all(
      'SELECT * FROM finding_feedback WHERE user_id = ? AND round_id = ?',
      userId,
      roundId
    );
    return new Map(
      rows.map((row) => [
        `${row.target_type}:${row.target_id}`,
        {
          id: row.id,
          rating: row.rating,
          comment: row.comment,
          suggestedCorrection: row.suggested_correction,
          updatedAt: row.updated_at,
        },
      ])
    );
  }

  void feedbackByTarget;

  router.get('/', async (req, res) => {
    const format = req.query.format ? enumValue(String(req.query.format), FORMAT_IDS, 'format') : null;
    const query = optionalString(req.query.q, 'Search query', { max: 120 });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '100', 10) || 100, 1), 200);
    const rounds = await roundService.listRounds(req.user.id, { format, query, limit });
    res.json({ rounds });
  });

  router.post('/', async (req, res) => {
    const title = requiredString(req.body?.title, 'Round title', { max: 160 });
    const format = enumValue(req.body?.format, FORMAT_IDS, 'Format');
    const formatSpec = getFormat(format);
    const resolution = requiredString(req.body?.resolution, 'Resolution or topic', { min: 5, max: 500 });
    const side = req.body?.side ? enumValue(req.body.side, formatSpec.sides.map((entry) => entry.id), 'Side') : null;
    const notes = optionalString(req.body?.notes, 'Notes', { max: 4000 });

    const participants = ensureArray(req.body?.participants, 'Participants', { max: 20 }).map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw badRequest(`Participant ${index + 1} must be an object with a name.`, { field: 'participants' });
      }
      return {
        name: requiredString(entry.name, `Participant ${index + 1} name`, { max: 120 }),
        team: optionalString(entry.team, 'Team', { max: 120 }),
        side: entry.side && formatSpec.sides.some((sideEntry) => sideEntry.id === entry.side) ? entry.side : null,
        role: optionalString(entry.role, 'Role', { max: 120 }),
      };
    });

    const speeches = ensureArray(req.body?.speeches, 'Speeches', { max: MAX_ROUND_SPEECHES }).map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw badRequest(`Speech ${index + 1} must be an object.`, { field: 'speeches' });
      }
      const content = entry.content === undefined ? '' : String(entry.content);
      if (content.length > MAX_ROUND_SPEECH_CHARS) {
        throw badRequest(`Speech ${index + 1} is too long.`, { field: 'speeches' });
      }
      return {
        side: entry.side ?? null,
        speechType: entry.speechType ?? null,
        speakerName: optionalString(entry.speakerName, 'Speaker name', { max: 120 }),
        team: optionalString(entry.team, 'Team', { max: 120 }),
        content,
      };
    });

    const detail = await roundService.createRound(req.user.id, {
      title,
      format,
      resolution,
      side,
      notes,
      participants,
      speeches,
    });

    res.status(201).json({
      round: detail.round,
      roundStructure: getRoundStructure(format),
      speeches: detail.speeches,
    });
  });

  router.get('/:id', async (req, res) => {
    const db = req.app.locals.db;
    const detail = await roundService.getRoundDetail(req.user.id, idParam(req.params.id));
    const graph = buildRoundGraph(detail);
    const timeline = buildRoundTimeline(detail);

    const [verifications, feedbackRows, annotations] = await Promise.all([
      latestVerifications(db, detail.evidence.map((record) => record.id)),
      db.all(
        'SELECT * FROM finding_feedback WHERE user_id = ? AND round_id = ?',
        req.user.id,
        detail.round.id
      ),
      db.all(
        'SELECT * FROM human_annotations WHERE user_id = ? AND round_id = ? ORDER BY id DESC LIMIT 100',
        req.user.id,
        detail.round.id
      ),
    ]);

    const feedbackMap = new Map(
      feedbackRows.map((row) => [
        `${row.target_type}:${row.target_id}`,
        {
          id: row.id,
          rating: row.rating,
          comment: row.comment,
          suggestedCorrection: row.suggested_correction,
          updatedAt: row.updated_at,
        },
      ])
    );

    res.json({
      ...detail,
      findings: detail.findings.map((finding) => ({
        ...finding,
        feedback: feedbackMap.get(`round_finding:${finding.id}`) ?? null,
      })),
      arguments: detail.arguments.map((argument) => ({
        ...argument,
        feedback: feedbackMap.get(`round_argument:${argument.id}`) ?? null,
      })),
      evidence: detail.evidence.map((record) => ({
        ...record,
        verification: verifications.get(record.id) ?? null,
      })),
      annotations: annotations.map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        aiValue: row.ai_value,
        humanValue: row.human_value,
        note: row.note,
        createdAt: row.created_at,
      })),
      graph,
      timeline,
      verificationAvailable: Boolean(config.evidence?.searchUrl),
      roundStructure: getRoundStructure(detail.round.format),
    });
  });

  router.put('/:id', async (req, res) => {
    const format = req.body?.format === undefined ? null : enumValue(req.body.format, FORMAT_IDS, 'Format');
    const detail = await roundService.updateRound(req.user.id, idParam(req.params.id), {
      title: req.body?.title === undefined ? undefined : requiredString(req.body.title, 'Round title', { max: 160 }),
      format: format ?? undefined,
      resolution:
        req.body?.resolution === undefined
          ? undefined
          : requiredString(req.body.resolution, 'Resolution or topic', { min: 5, max: 500 }),
      side: req.body?.side === undefined ? undefined : req.body.side,
      notes: req.body?.notes === undefined ? undefined : optionalString(req.body.notes, 'Notes', { max: 4000 }),
    });
    res.json({ round: detail.round });
  });

  router.delete('/:id', async (req, res) => {
    res.json(await roundService.deleteRound(req.user.id, idParam(req.params.id)));
  });

  router.post('/:id/speeches', async (req, res) => {
    const speech = await roundService.addSpeech(req.user.id, idParam(req.params.id), speechInput(req.body));
    res.status(201).json({
      speech: {
        id: speech.id,
        position: speech.position,
        side: speech.side,
        speechType: speech.speech_type,
        speakerName: speech.speaker_name,
        team: speech.team,
        content: speech.content,
        wordCount: speech.word_count,
      },
    });
  });

  router.put('/:id/speeches/order', async (req, res) => {
    const ids = ensureArray(req.body?.ids, 'Speech order', { max: MAX_ROUND_SPEECHES }).map((id) =>
      idParam(id, 'speech id')
    );
    const speeches = await roundService.reorderSpeeches(req.user.id, idParam(req.params.id), ids);
    res.json({ speeches: speeches.map((row) => ({ id: row.id, position: row.position })) });
  });

  router.put('/:id/speeches/:speechId', async (req, res) => {
    if (req.body?.content !== undefined && String(req.body.content).length > MAX_ROUND_SPEECH_CHARS) {
      throw badRequest('That speech is too long.', { field: 'content' });
    }
    const speech = await roundService.updateSpeech(
      req.user.id,
      idParam(req.params.id),
      idParam(req.params.speechId, 'speechId'),
      {
        side: req.body?.side,
        speechType: req.body?.speechType,
        speakerName:
          req.body?.speakerName === undefined
            ? undefined
            : optionalString(req.body.speakerName, 'Speaker name', { max: 120 }),
        team: req.body?.team === undefined ? undefined : optionalString(req.body.team, 'Team', { max: 120 }),
        content: req.body?.content === undefined ? undefined : String(req.body.content),
      }
    );
    res.json({ speech: { id: speech.id, position: speech.position, content: speech.content, wordCount: speech.word_count } });
  });

  router.delete('/:id/speeches/:speechId', async (req, res) => {
    res.json(
      await roundService.deleteSpeech(req.user.id, idParam(req.params.id), idParam(req.params.speechId, 'speechId'))
    );
  });

  router.post('/:id/participants', async (req, res) => {
    const participant = await roundService.addParticipant(req.user.id, idParam(req.params.id), {
      name: requiredString(req.body?.name, 'Participant name', { max: 120 }),
      team: optionalString(req.body?.team, 'Team', { max: 120 }),
      side: optionalString(req.body?.side, 'Side', { max: 40 }),
      role: optionalString(req.body?.role, 'Role', { max: 120 }),
    });
    res.status(201).json({ participant });
  });

  router.delete('/:id/participants/:participantId', async (req, res) => {
    res.json(
      await roundService.deleteParticipant(
        req.user.id,
        idParam(req.params.id),
        idParam(req.params.participantId, 'participantId')
      )
    );
  });

  // The AI rate limiter is mounted on this path in app.js so that it is
  // counted once per request, not once per layer.
  router.post('/:id/analyze', async (req, res) => {
    const roundId = idParam(req.params.id);
    const detail = await roundService.getRoundDetail(req.user.id, roundId);
    const formatSpec = getFormat(detail.round.format);

    const speeches = detail.speeches
      .filter((speech) => String(speech.content || '').trim().length >= 20)
      .map((speech) => ({
        id: speech.id,
        position: speech.position,
        side: speech.side,
        speechType: speech.speechType,
        speakerName: speech.speakerName,
        content: speech.content,
      }));

    if (speeches.length === 0) {
      throw badRequest('Add at least one speech with text before running a round analysis.', { field: 'speeches' });
    }
    if (!formatSpec) throw badRequest('This round has an unknown format.', { field: 'format' });

    const { analysis, meta } = await ai.analyzeRound({
      formatSpec,
      resolution: detail.round.resolution,
      sideLabel: detail.round.side ? getSideLabel(detail.round.format, detail.round.side) : 'Neutral observer',
      speeches,
    });

    const persisted = await saveRoundAnalysis({
      db: req.app.locals.db,
      logger,
      userId: req.user.id,
      round: { id: roundId, title: detail.round.title },
      formatSpec,
      analysis,
      meta,
    });

    res.status(201).json({
      roundAnalysisId: persisted.roundAnalysisId,
      mode: meta.mode,
      isDemo: meta.mode === 'demo',
      provider: meta.provider,
      model: meta.model,
      latencyMs: meta.latencyMs,
      demoReason: meta.demoReason ?? null,
      counts: analysis.counts,
      summary: analysis.summary,
      redirect: `/round.html?id=${roundId}&view=report`,
    });
  });

  router.get('/:id/graph', async (req, res) => {
    const detail = await roundService.getRoundDetail(req.user.id, idParam(req.params.id));
    res.json({ graph: buildRoundGraph(detail), updatedAt: detail.round.updatedAt });
  });

  router.get('/:id/timeline', async (req, res) => {
    const detail = await roundService.getRoundDetail(req.user.id, idParam(req.params.id));
    res.json({ timeline: buildRoundTimeline(detail) });
  });

  router.get('/:id/arguments/:argumentId', async (req, res) => {
    res.json(
      await roundService.getArgumentHistory(
        req.user.id,
        idParam(req.params.id),
        idParam(req.params.argumentId, 'argumentId')
      )
    );
  });

  router.put('/:id/arguments/:argumentId', async (req, res) => {
    const status = req.body?.status;
    if (status !== undefined && !ARGUMENT_STATUSES.includes(status)) {
      throw badRequest(`Status must be one of: ${ARGUMENT_STATUSES.join(', ')}.`, { field: 'status' });
    }
    const type = req.body?.type;
    if (type !== undefined && !ARGUMENT_TYPES.includes(type)) {
      throw badRequest(`Type must be one of: ${ARGUMENT_TYPES.join(', ')}.`, { field: 'type' });
    }
    const argument = await roundService.updateArgument(
      req.user.id,
      idParam(req.params.id),
      idParam(req.params.argumentId, 'argumentId'),
      {
        label: req.body?.label === undefined ? undefined : requiredString(req.body.label, 'Label', { max: 200 }),
        claim: req.body?.claim === undefined ? undefined : requiredString(req.body.claim, 'Claim', { max: 2000 }),
        warrant:
          req.body?.warrant === undefined ? undefined : optionalString(req.body.warrant, 'Warrant', { max: 2000 }),
        impact: req.body?.impact === undefined ? undefined : optionalString(req.body.impact, 'Impact', { max: 2000 }),
        evidence:
          req.body?.evidence === undefined ? undefined : optionalString(req.body.evidence, 'Evidence', { max: 2000 }),
        type,
        status,
        note: optionalString(req.body?.note, 'Note', { max: 1000 }),
      }
    );
    res.json({ argument });
  });

  router.post('/:id/relationships', async (req, res) => {
    const result = await roundService.addRelationship(req.user.id, idParam(req.params.id), {
      sourceId: idParam(req.body?.sourceId, 'sourceId'),
      targetId: idParam(req.body?.targetId, 'targetId'),
      relation: req.body?.relation,
      explanation: optionalString(req.body?.explanation, 'Explanation', { max: 1000 }),
      note: optionalString(req.body?.note, 'Note', { max: 1000 }),
    });
    res.status(result.created ? 201 : 200).json(result);
  });

  router.put('/:id/relationships/:relationshipId', async (req, res) => {
    res.json(
      await roundService.updateRelationship(
        req.user.id,
        idParam(req.params.id),
        idParam(req.params.relationshipId, 'relationshipId'),
        {
          relation: req.body?.relation,
          explanation:
            req.body?.explanation === undefined
              ? undefined
              : optionalString(req.body.explanation, 'Explanation', { max: 1000 }),
          note: optionalString(req.body?.note, 'Note', { max: 1000 }),
        }
      )
    );
  });

  router.delete('/:id/relationships/:relationshipId', async (req, res) => {
    res.json(
      await roundService.deleteRelationship(
        req.user.id,
        idParam(req.params.id),
        idParam(req.params.relationshipId, 'relationshipId')
      )
    );
  });

  router.get('/:id/evidence', async (req, res) => {
    const db = req.app.locals.db;
    const detail = await roundService.getRoundDetail(req.user.id, idParam(req.params.id));
    const verifications = await latestVerifications(db, detail.evidence.map((record) => record.id));
    res.json({
      evidence: detail.evidence.map((record) => ({
        ...record,
        verification: verifications.get(record.id) ?? null,
      })),
      verificationAvailable: Boolean(config.evidence?.searchUrl),
    });
  });

  return router;
}
