import { createHash } from 'node:crypto';
import { badRequest, notFound } from '../utils/errors.js';
import {
  ARGUMENT_RELATIONS,
  ARGUMENT_STATUSES,
  ARGUMENT_TYPES,
  getFormat,
  getRoundStructure,
} from './formats.js';
import { countWords } from './analysis-service.js';
import { textSimilarity } from './ai/round-demo.js';

export const MAX_ROUNDS = 200;
export const MAX_ROUND_SPEECHES = 30;
export const MAX_ROUND_SPEECH_CHARS = 40000;

const APPEARANCE_STATUS = {
  introduced: 'introduced',
  repeated: 'still_contested',
  extended: 'extended',
  answered: 'answered',
  conceded: 'conceded',
  turned: 'turned',
};

export function serializeRound(row) {
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    resolution: row.resolution,
    side: row.side,
    notes: row.notes,
    status: row.status,
    lastAnalyzedAt: row.last_analyzed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    speechCount: row.speech_count ?? 0,
    argumentCount: row.argument_count ?? 0,
    analysisMode: row.analysis_mode ?? null,
  };
}

export function serializeSpeech(row) {
  return {
    id: row.id,
    position: row.position,
    speakerName: row.speaker_name,
    team: row.team,
    side: row.side,
    speechType: row.speech_type,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeArgument(row) {
  return {
    id: row.id,
    roundId: row.round_id,
    key: row.argument_key,
    side: row.side,
    type: row.type,
    label: row.label,
    claim: row.claim,
    warrant: row.warrant,
    evidence: row.evidence,
    impact: row.impact,
    assumptions: row.assumptions,
    introducedSpeechId: row.introduced_speech_id,
    latestSpeechId: row.latest_speech_id,
    status: row.status,
    statusConfidence: row.status_confidence,
    statusReason: row.status_reason,
    origin: row.origin,
    humanEdited: Boolean(row.human_edited),
    position: row.position,
    updatedAt: row.updated_at,
  };
}

async function loadOwnedRound(db, userId, roundId) {
  const row = await db.get('SELECT * FROM rounds WHERE id = ? AND user_id = ?', roundId, userId);
  if (!row) throw notFound('That round does not exist in your workspace.');
  return row;
}

export async function loadRoundSpeeches(db, userId, roundId) {
  return db.all(
    `SELECT s.* FROM round_speeches s
     WHERE s.round_id = ? AND s.user_id = ?
     ORDER BY s.position ASC, s.id ASC`,
    roundId,
    userId
  );
}

async function nextPosition(db, roundId) {
  const row = await db.get('SELECT COALESCE(MAX(position), 0) AS max FROM round_speeches WHERE round_id = ?', roundId);
  return Number(row?.max ?? 0) + 1;
}

export function createRoundService({ db, logger }) {
  async function listRounds(userId, { format = null, query = null, limit = 100 } = {}) {
    const conditions = ['r.user_id = ?'];
    const params = [userId];
    if (format) {
      conditions.push('r.format = ?');
      params.push(format);
    }
    if (query) {
      const like = `%${String(query).replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push("(r.title LIKE ? ESCAPE '\\' OR r.resolution LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const rows = await db.all(
      `SELECT r.*,
        (SELECT COUNT(*) FROM round_speeches s WHERE s.round_id = r.id) AS speech_count,
        (SELECT COUNT(*) FROM round_arguments a WHERE a.round_id = r.id) AS argument_count,
        (SELECT mode FROM round_analyses ra WHERE ra.round_id = r.id ORDER BY ra.id DESC LIMIT 1) AS analysis_mode
       FROM rounds r
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.updated_at DESC
       LIMIT ?`,
      ...params,
      Math.min(Math.max(limit, 1), MAX_ROUNDS)
    );
    return rows.map(serializeRound);
  }

  async function createRound(userId, input) {
    const { title, format, resolution, side = null, notes = null, participants = [], speeches = [] } = input;
    const formatSpec = getFormat(format);
    if (!formatSpec) throw badRequest('Select a debate format.', { field: 'format' });
    if (side !== null && !formatSpec.sides.some((entry) => entry.id === side)) {
      throw badRequest('The selected side is not valid for this format.', { field: 'side' });
    }

    const count = await db.get('SELECT COUNT(*) AS count FROM rounds WHERE user_id = ?', userId);
    if (count.count >= MAX_ROUNDS) {
      throw badRequest(`You have reached the ${MAX_ROUNDS} round limit. Delete a round to create another.`);
    }

    const roundId = await db.transaction(async (tx) => {
      const inserted = await tx.run(
        `INSERT INTO rounds (user_id, title, format, resolution, side, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
        userId,
        title,
        format,
        resolution,
        side,
        notes
      );
      const id = inserted.lastInsertRowid;

      for (const [index, participant] of participants.entries()) {
        await tx.run(
          `INSERT INTO round_participants (round_id, name, team, side, role, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          participant.name,
          participant.team ?? null,
          participant.side ?? null,
          participant.role ?? null,
          index
        );
      }

      const structure = getRoundStructure(format);
      const slots = structure && !structure.flexibleOrder ? structure.slots : [];

      for (const [index, speech] of speeches.entries()) {
        const slot = slots[index];
        const side = speech.side ?? slot?.side ?? null;
        if (!side || !formatSpec.sides.some((entry) => entry.id === side)) {
          throw badRequest(`Speech ${index + 1} needs a valid side for this format.`, { field: 'speeches' });
        }
        const speechType = speech.speechType ?? slot?.speechType ?? formatSpec.speechTypes[0];
        if (!formatSpec.speechTypes.includes(speechType)) {
          throw badRequest(`Speech ${index + 1} has an invalid speech type for this format.`, { field: 'speeches' });
        }
        const content = String(speech.content ?? '').trim();
        await tx.run(
          `INSERT INTO round_speeches
            (round_id, user_id, position, speaker_name, team, side, speech_type, content, word_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          userId,
          index + 1,
          speech.speakerName ?? null,
          speech.team ?? null,
          side,
          speechType,
          content,
          countWords(content)
        );
      }

      return id;
    });

    logger.info('Round created', { roundId, format, userId });
    return getRoundDetail(userId, roundId);
  }

  async function getRoundDetail(userId, roundId) {
    const round = await loadOwnedRound(db, userId, roundId);
    const [participants, speeches, argumentsRows, relationships, findings, evidence, latest] = await Promise.all([
      db.all('SELECT * FROM round_participants WHERE round_id = ? ORDER BY position, id', roundId),
      loadRoundSpeeches(db, userId, roundId),
      db.all('SELECT * FROM round_arguments WHERE round_id = ? ORDER BY position, id', roundId),
      db.all('SELECT * FROM argument_relationships WHERE round_id = ? ORDER BY id', roundId),
      db.all('SELECT * FROM round_findings WHERE round_id = ? ORDER BY position, id', roundId),
      db.all('SELECT * FROM evidence_records WHERE round_id = ? ORDER BY position, id', roundId),
      db.get('SELECT * FROM round_analyses WHERE round_id = ? ORDER BY id DESC LIMIT 1', roundId),
    ]);

    let analysis = null;
    if (latest) {
      try {
        analysis = JSON.parse(latest.report_json);
      } catch {
        analysis = null;
      }
    }

    const skills = await db.all(
      `SELECT skill_key, skill_name, level, explanation, passage, recommendation, created_at
       FROM skill_assessments
       WHERE round_id = ? AND user_id = ? AND source_type = 'round'
       ORDER BY id DESC`,
      roundId,
      userId
    );

    const argumentById = new Map(argumentsRows.map((row) => [row.id, row]));

    return {
      round: serializeRound({
        ...round,
        speech_count: speeches.length,
        argument_count: argumentsRows.length,
        analysis_mode: latest?.mode ?? null,
      }),
      participants: participants.map((row) => ({
        id: row.id,
        name: row.name,
        team: row.team,
        side: row.side,
        role: row.role,
      })),
      speeches: speeches.map((row) => ({
        ...serializeSpeech(row),
        content: row.content,
        excerpt: row.content.slice(0, 220),
      })),
      arguments: argumentsRows.map((row) => ({
        ...serializeArgument(row),
        introducedSpeechPosition:
          speeches.find((speech) => speech.id === row.introduced_speech_id)?.position ?? null,
        latestSpeechPosition: speeches.find((speech) => speech.id === row.latest_speech_id)?.position ?? null,
      })),
      relationships: relationships.map((row) => ({
        id: row.id,
        sourceId: row.source_argument_id,
        targetId: row.target_argument_id,
        sourceKey: argumentById.get(row.source_argument_id)?.argument_key ?? null,
        targetKey: argumentById.get(row.target_argument_id)?.argument_key ?? null,
        relation: row.relation,
        explanation: row.explanation,
        origin: row.origin,
        humanEdited: Boolean(row.human_edited),
      })),
      findings: findings.map((row) => ({
        id: row.id,
        argumentId: row.argument_id,
        category: row.category,
        weaknessType: row.weakness_type,
        title: row.title,
        passage: row.passage,
        explanation: row.explanation,
        whyItMatters: row.why_it_matters,
        suggestion: row.suggestion,
        confidence: row.confidence,
        origin: row.origin,
      })),
      evidence: evidence.map((row) => ({
        id: row.id,
        speechId: row.speech_id,
        speechPosition: speeches.find((speech) => speech.id === row.speech_id)?.position ?? null,
        argumentId: row.argument_id,
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
      })),
      skills: skills.map((row) => ({
        key: row.skill_key,
        name: row.skill_name,
        level: row.level,
        explanation: row.explanation,
        passage: row.passage,
        recommendation: row.recommendation,
        createdAt: row.created_at,
      })),
      analysis: latest
        ? {
            id: latest.id,
            mode: latest.mode,
            provider: latest.provider,
            model: latest.model,
            latencyMs: latest.latency_ms,
            speechCount: latest.speech_count,
            createdAt: latest.created_at,
            report: analysis,
          }
        : null,
    };
  }

  async function updateRound(userId, roundId, patch) {
    const existing = await loadOwnedRound(db, userId, roundId);
    const format = patch.format ?? existing.format;
    const formatSpec = getFormat(format);
    if (!formatSpec) throw badRequest('Select a debate format.', { field: 'format' });

    const side = patch.side === undefined ? existing.side : patch.side;
    if (side !== null && !formatSpec.sides.some((entry) => entry.id === side)) {
      throw badRequest('The selected side is not valid for this format.', { field: 'side' });
    }

    await db.run(
      `UPDATE rounds SET title = ?, format = ?, resolution = ?, side = ?, notes = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
      patch.title ?? existing.title,
      format,
      patch.resolution ?? existing.resolution,
      side,
      patch.notes !== undefined ? patch.notes : existing.notes,
      roundId,
      userId
    );

    return getRoundDetail(userId, roundId);
  }

  async function deleteRound(userId, roundId) {
    await loadOwnedRound(db, userId, roundId);
    await db.transaction(async (tx) => {
      await tx.run(
        'DELETE FROM skill_assessments WHERE round_id = ? AND user_id = ?',
        roundId,
        userId
      );
      await tx.run('DELETE FROM finding_feedback WHERE round_id = ? AND user_id = ?', roundId, userId);
      await tx.run('DELETE FROM human_annotations WHERE round_id = ? AND user_id = ?', roundId, userId);
      // Arguments, relationships, history, findings, evidence, analyses and
      // participants cascade from the round itself.
      await tx.run('DELETE FROM rounds WHERE id = ? AND user_id = ?', roundId, userId);
    });
    logger.info('Round deleted', { roundId, userId });
    return { deleted: true, id: roundId };
  }

  async function addSpeech(userId, roundId, input) {
    const round = await loadOwnedRound(db, userId, roundId);
    const formatSpec = getFormat(round.format);
    const side = input.side;
    if (!formatSpec.sides.some((entry) => entry.id === side)) {
      throw badRequest('Choose a valid side for this format.', { field: 'side' });
    }
    if (!formatSpec.speechTypes.includes(input.speechType)) {
      throw badRequest('Choose a valid speech type for this format.', { field: 'speechType' });
    }
    const content = String(input.content ?? '');

    const count = await db.get('SELECT COUNT(*) AS count FROM round_speeches WHERE round_id = ?', roundId);
    if (count.count >= MAX_ROUND_SPEECHES) {
      throw badRequest(`A round can hold at most ${MAX_ROUND_SPEECHES} speeches.`);
    }

    const requested = Number(input.position);
    const position =
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, count.count + 1)
        : await nextPosition(db, roundId);

    const id = await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE round_speeches SET position = position + 1 WHERE round_id = ? AND position >= ?',
        roundId,
        position
      );
      const inserted = await tx.run(
        `INSERT INTO round_speeches
          (round_id, user_id, position, speaker_name, team, side, speech_type, content, word_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        roundId,
        userId,
        position,
        input.speakerName ?? null,
        input.team ?? null,
        side,
        input.speechType,
        content,
        countWords(content)
      );
      await tx.run(
        `UPDATE rounds SET status = 'ready', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
        roundId,
        userId
      );
      return inserted.lastInsertRowid;
    });

    return db.get('SELECT * FROM round_speeches WHERE id = ?', id);
  }

  async function updateSpeech(userId, roundId, speechId, patch) {
    const round = await loadOwnedRound(db, userId, roundId);
    const speech = await db.get(
      'SELECT * FROM round_speeches WHERE id = ? AND round_id = ? AND user_id = ?',
      speechId,
      roundId,
      userId
    );
    if (!speech) throw notFound('That speech is not part of this round.');
    const formatSpec = getFormat(round.format);

    const side = patch.side ?? speech.side;
    if (!formatSpec.sides.some((entry) => entry.id === side)) {
      throw badRequest('Choose a valid side for this format.', { field: 'side' });
    }
    const speechType = patch.speechType ?? speech.speech_type;
    if (!formatSpec.speechTypes.includes(speechType)) {
      throw badRequest('Choose a valid speech type for this format.', { field: 'speechType' });
    }
    const content = patch.content === undefined ? null : String(patch.content);

    await db.run(
      `UPDATE round_speeches
       SET speaker_name = ?, team = ?, side = ?, speech_type = ?,
           content = COALESCE(?, content),
           word_count = CASE WHEN ? IS NULL THEN word_count ELSE ? END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND round_id = ? AND user_id = ?`,
      patch.speakerName !== undefined ? patch.speakerName : speech.speaker_name,
      patch.team !== undefined ? patch.team : speech.team,
      side,
      speechType,
      content,
      content,
      content === null ? 0 : countWords(content),
      speechId,
      roundId,
      userId
    );

    await db.run(
      `UPDATE rounds SET status = CASE WHEN status = 'analyzed' THEN 'ready' ELSE status END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
      roundId,
      userId
    );

    return db.get('SELECT * FROM round_speeches WHERE id = ?', speechId);
  }

  async function deleteSpeech(userId, roundId, speechId) {
    await loadOwnedRound(db, userId, roundId);
    const speech = await db.get(
      'SELECT * FROM round_speeches WHERE id = ? AND round_id = ? AND user_id = ?',
      speechId,
      roundId,
      userId
    );
    if (!speech) throw notFound('That speech is not part of this round.');

    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM evidence_records WHERE speech_id = ? AND user_id = ?', speechId, userId);
      await tx.run('DELETE FROM round_speeches WHERE id = ? AND round_id = ? AND user_id = ?', speechId, roundId, userId);
      await tx.run(
        'UPDATE round_speeches SET position = position - 1 WHERE round_id = ? AND position > ?',
        roundId,
        speech.position
      );
      await tx.run(
        `UPDATE rounds SET status = 'ready', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
        roundId,
        userId
      );
    });

    return { deleted: true, id: speechId };
  }

  async function reorderSpeeches(userId, roundId, orderedIds) {
    await loadOwnedRound(db, userId, roundId);
    const speeches = await loadRoundSpeeches(db, userId, roundId);
    const existing = new Set(speeches.map((row) => row.id));
    if (orderedIds.length !== speeches.length || orderedIds.some((id) => !existing.has(id))) {
      throw badRequest('The new order must list every speech in the round exactly once.', { field: 'ids' });
    }
    await db.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.run('UPDATE round_speeches SET position = ? WHERE id = ? AND round_id = ?', index + 1, id, roundId);
      }
    });
    return loadRoundSpeeches(db, userId, roundId);
  }

  async function addParticipant(userId, roundId, participant) {
    await loadOwnedRound(db, userId, roundId);
    const row = await db.get('SELECT COALESCE(MAX(position), -1) AS max FROM round_participants WHERE round_id = ?', roundId);
    const result = await db.run(
      `INSERT INTO round_participants (round_id, name, team, side, role, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
      roundId,
      participant.name,
      participant.team ?? null,
      participant.side ?? null,
      participant.role ?? null,
      Number(row.max) + 1
    );
    return db.get('SELECT * FROM round_participants WHERE id = ?', result.lastInsertRowid);
  }

  async function deleteParticipant(userId, roundId, participantId) {
    await loadOwnedRound(db, userId, roundId);
    const result = await db.run(
      'DELETE FROM round_participants WHERE id = ? AND round_id = ?',
      participantId,
      roundId
    );
    if (!result.changes) throw notFound('That participant is not part of this round.');
    return { deleted: true, id: participantId };
  }

  async function updateArgument(userId, roundId, argumentId, patch, annotations = {}) {
    await loadOwnedRound(db, userId, roundId);
    const existing = await db.get(
      'SELECT * FROM round_arguments WHERE id = ? AND round_id = ? AND user_id = ?',
      argumentId,
      roundId,
      userId
    );
    if (!existing) throw notFound('That argument is not part of this round.');

    const next = {
      label: patch.label !== undefined ? patch.label : existing.label,
      claim: patch.claim !== undefined ? patch.claim : existing.claim,
      warrant: patch.warrant !== undefined ? patch.warrant : existing.warrant,
      impact: patch.impact !== undefined ? patch.impact : existing.impact,
      evidence: patch.evidence !== undefined ? patch.evidence : existing.evidence,
      type: patch.type !== undefined ? patch.type : existing.type,
      status: patch.status !== undefined ? patch.status : existing.status,
    };

    if (!ARGUMENT_TYPES.includes(next.type)) throw badRequest('Unknown argument type.', { field: 'type' });
    if (!ARGUMENT_STATUSES.includes(next.status)) throw badRequest('Unknown argument status.', { field: 'status' });

    const changedStatus = next.status !== existing.status;

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE round_arguments
         SET label = ?, claim = ?, warrant = ?, evidence = ?, impact = ?, type = ?, status = ?,
             status_confidence = 'high', status_reason = ?,
             human_edited = 1, origin = 'human',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND round_id = ? AND user_id = ?`,
        next.label,
        next.claim,
        next.warrant,
        next.evidence,
        next.impact,
        next.type,
        next.status,
        'Status set by the user during review.',
        argumentId,
        roundId,
        userId
      );

      if (changedStatus) {
        await tx.run(
          `INSERT INTO argument_status_history
            (round_id, argument_id, speech_id, status, previous_status, reason, origin)
           VALUES (?, ?, ?, ?, ?, ?, 'human')`,
          roundId,
          argumentId,
          existing.latest_speech_id,
          next.status,
          existing.status,
          'Correction submitted by the user.'
        );
      }

      const humanValue =
        annotations.humanValue ??
        JSON.stringify({ label: next.label, status: next.status, type: next.type });
      await tx.run(
        `INSERT INTO human_annotations
          (user_id, target_type, target_id, round_id, ai_value, human_value, note)
         VALUES (?, 'round_argument', ?, ?, ?, ?, ?)`,
        userId,
        argumentId,
        roundId,
        JSON.stringify({
          label: existing.label,
          status: existing.status,
          type: existing.type,
          origin: existing.origin,
        }),
        humanValue,
        patch.note ?? null
      );
    });

    return serializeArgument(
      await db.get('SELECT * FROM round_arguments WHERE id = ? AND user_id = ?', argumentId, userId)
    );
  }

  async function getArgumentHistory(userId, roundId, argumentId) {
    await loadOwnedRound(db, userId, roundId);
    const argument = await db.get(
      'SELECT * FROM round_arguments WHERE id = ? AND round_id = ? AND user_id = ?',
      argumentId,
      roundId,
      userId
    );
    if (!argument) throw notFound('That argument is not part of this round.');

    const history = await db.all(
      `SELECT h.*, s.position AS speech_position, s.side AS speech_side, s.speech_type
       FROM argument_status_history h
       LEFT JOIN round_speeches s ON s.id = h.speech_id
       WHERE h.argument_id = ? ORDER BY h.id`,
      argumentId
    );

    const related = await db.all(
      `SELECT rel.*, src.argument_key AS source_key, tgt.argument_key AS target_key
       FROM argument_relationships rel
       JOIN round_arguments src ON src.id = rel.source_argument_id
       JOIN round_arguments tgt ON tgt.id = rel.target_argument_id
       WHERE rel.round_id = ? AND (rel.source_argument_id = ? OR rel.target_argument_id = ?)`,
      roundId,
      argumentId,
      argumentId
    );

    return {
      argument: serializeArgument(argument),
      history: history.map((row) => ({
        id: row.id,
        status: row.status,
        previousStatus: row.previous_status,
        reason: row.reason,
        origin: row.origin,
        speechPosition: row.speech_position,
        speechSide: row.speech_side,
        speechType: row.speech_type,
        createdAt: row.created_at,
      })),
      relationships: related.map((row) => ({
        id: row.id,
        sourceKey: row.source_key,
        targetKey: row.target_key,
        relation: row.relation,
        explanation: row.explanation,
      })),
    };
  }

  async function addRelationship(userId, roundId, input) {
    await loadOwnedRound(db, userId, roundId);
    if (!ARGUMENT_RELATIONS.includes(input.relation)) {
      throw badRequest(`Relation must be one of: ${ARGUMENT_RELATIONS.join(', ')}.`, { field: 'relation' });
    }
    if (input.sourceId === input.targetId) {
      throw badRequest('An argument cannot relate to itself.', { field: 'targetId' });
    }
    const [source, target] = await Promise.all([
      db.get('SELECT id FROM round_arguments WHERE id = ? AND round_id = ? AND user_id = ?', input.sourceId, roundId, userId),
      db.get('SELECT id FROM round_arguments WHERE id = ? AND round_id = ? AND user_id = ?', input.targetId, roundId, userId),
    ]);
    if (!source || !target) throw notFound('Both arguments must belong to this round.');

    const existing = await db.get(
      `SELECT id FROM argument_relationships
       WHERE round_id = ? AND source_argument_id = ? AND target_argument_id = ? AND relation = ?`,
      roundId,
      input.sourceId,
      input.targetId,
      input.relation
    );
    if (existing) return { id: existing.id, created: false };

    const result = await db.run(
      `INSERT INTO argument_relationships
        (round_id, user_id, source_argument_id, target_argument_id, relation, explanation, origin, human_edited)
       VALUES (?, ?, ?, ?, ?, ?, 'human', 1)`,
      roundId,
      userId,
      input.sourceId,
      input.targetId,
      input.relation,
      input.explanation ?? null
    );

    await db.run(
      `INSERT INTO human_annotations
        (user_id, target_type, target_id, round_id, ai_value, human_value, note)
       VALUES (?, 'relationship', ?, ?, NULL, ?, ?)`,
      userId,
      result.lastInsertRowid,
      roundId,
      JSON.stringify({ sourceId: input.sourceId, targetId: input.targetId, relation: input.relation }),
      input.note ?? null
    );

    return { id: result.lastInsertRowid, created: true };
  }

  async function updateRelationship(userId, roundId, relationshipId, patch) {
    await loadOwnedRound(db, userId, roundId);
    const existing = await db.get(
      'SELECT * FROM argument_relationships WHERE id = ? AND round_id = ? AND user_id = ?',
      relationshipId,
      roundId,
      userId
    );
    if (!existing) throw notFound('That relationship is not part of this round.');
    if (patch.relation !== undefined && !ARGUMENT_RELATIONS.includes(patch.relation)) {
      throw badRequest(`Relation must be one of: ${ARGUMENT_RELATIONS.join(', ')}.`, { field: 'relation' });
    }
    await db.run(
      `UPDATE argument_relationships
       SET relation = ?, explanation = ?, human_edited = 1, origin = 'human',
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND round_id = ? AND user_id = ?`,
      patch.relation ?? existing.relation,
      patch.explanation !== undefined ? patch.explanation : existing.explanation,
      relationshipId,
      roundId,
      userId
    );
    await db.run(
      `INSERT INTO human_annotations
        (user_id, target_type, target_id, round_id, ai_value, human_value, note)
       VALUES (?, 'relationship', ?, ?, ?, ?, ?)`,
      userId,
      relationshipId,
      roundId,
      JSON.stringify({ relation: existing.relation, explanation: existing.explanation }),
      JSON.stringify({ relation: patch.relation ?? existing.relation, explanation: patch.explanation ?? existing.explanation }),
      patch.note ?? null
    );
    return { updated: true, id: relationshipId };
  }

  async function deleteRelationship(userId, roundId, relationshipId) {
    await loadOwnedRound(db, userId, roundId);
    const result = await db.run(
      'DELETE FROM argument_relationships WHERE id = ? AND round_id = ? AND user_id = ?',
      relationshipId,
      roundId,
      userId
    );
    if (!result.changes) throw notFound('That relationship is not part of this round.');
    return { deleted: true, id: relationshipId };
  }

  return {
    listRounds,
    createRound,
    getRoundDetail,
    updateRound,
    deleteRound,
    addSpeech,
    updateSpeech,
    deleteSpeech,
    reorderSpeeches,
    addParticipant,
    deleteParticipant,
    updateArgument,
    getArgumentHistory,
    addRelationship,
    updateRelationship,
    deleteRelationship,
  };
}

/* ------------------------------------------------------------------ */
/* Analysis persistence                                                */
/* ------------------------------------------------------------------ */

function argumentMatchKey(argument, fallbackIndex) {
  const normalized = String(argument.claim || argument.label || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 14)
    .join(' ');
  const hash = createHash('sha1').update(normalized || `argument-${fallbackIndex}`).digest('hex');
  return `k${hash.slice(0, 18)}`;
}

/**
 * Persist a validated round analysis.
 *
 * AI-owned rows from the previous run are replaced. Rows the user has edited
 * are kept, including their status, labels and manual relationships, so a
 * re-analysis never silently discards human corrections.
 */
export async function saveRoundAnalysis({ db, logger, userId, round, formatSpec, analysis, meta }) {
  const speeches = await loadRoundSpeeches(db, userId, round.id);
  const speechByPosition = new Map(speeches.map((speech) => [speech.position, speech]));

  const persisted = await db.transaction(async (tx) => {
    const analysisInsert = await tx.run(
      `INSERT INTO round_analyses
        (round_id, user_id, mode, provider, model, latency_ms, speech_count, report_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      round.id,
      userId,
      meta.mode,
      meta.provider,
      meta.model,
      meta.latencyMs ?? null,
      speeches.length,
      JSON.stringify(analysis)
    );
    const roundAnalysisId = analysisInsert.lastInsertRowid;

    const humanRows = await tx.all(
      'SELECT * FROM round_arguments WHERE round_id = ? AND human_edited = 1',
      round.id
    );

    await tx.run('DELETE FROM round_arguments WHERE round_id = ? AND human_edited = 0', round.id);
    await tx.run("DELETE FROM round_findings WHERE round_id = ? AND origin <> 'human'", round.id);
    await tx.run("DELETE FROM evidence_records WHERE round_id = ? AND origin <> 'human'", round.id);
    await tx.run('DELETE FROM skill_assessments WHERE round_id = ? AND source_type = ?', round.id, 'round');

    const keyToId = new Map();
    const usedHumanIds = new Set();

    for (const [index, argument] of analysis.arguments.entries()) {
      const introduced = speechByPosition.get(argument.introducedSpeechPosition) ?? null;
      const latest = speechByPosition.get(argument.latestSpeechPosition) ?? introduced;
      const matchKey = argumentMatchKey(argument, index);

      const humanMatch = humanRows.find(
        (row) =>
          !usedHumanIds.has(row.id) &&
          row.side === argument.side &&
          textSimilarity(`${row.claim} ${row.label}`, `${argument.claim} ${argument.label}`) >= 0.45
      );

      if (humanMatch) {
        usedHumanIds.add(humanMatch.id);
        await tx.run(
          `UPDATE round_arguments SET latest_speech_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
          latest?.id ?? humanMatch.latest_speech_id,
          humanMatch.id
        );
        keyToId.set(argument.key, humanMatch.id);
        continue;
      }

      const inserted = await tx.run(
        `INSERT INTO round_arguments
          (round_id, user_id, match_key, argument_key, side, type, label, claim, warrant, evidence,
           impact, assumptions, introduced_speech_id, latest_speech_id, status, status_confidence,
           status_reason, origin, human_edited, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        round.id,
        userId,
        matchKey,
        argument.key,
        argument.side,
        argument.type,
        argument.label,
        argument.claim,
        argument.warrant,
        argument.evidence,
        argument.impact,
        argument.assumptions,
        introduced?.id ?? null,
        latest?.id ?? null,
        argument.status,
        argument.statusConfidence,
        argument.statusReason,
        meta.mode === 'demo' ? 'heuristic' : 'ai',
        index
      );
      keyToId.set(argument.key, inserted.lastInsertRowid);

      const argumentId = inserted.lastInsertRowid;
      if (introduced) {
        await tx.run(
          `INSERT INTO argument_status_history
            (round_id, argument_id, speech_id, status, previous_status, reason, origin)
           VALUES (?, ?, ?, 'introduced', NULL, ?, ?)`,
          round.id,
          argumentId,
          introduced.id,
          'Argument introduced in this speech.',
          meta.mode === 'demo' ? 'heuristic' : 'ai'
        );
      }

      let previousStatus = 'introduced';
      for (const appearance of argument.appearances) {
        if (appearance.kind === 'introduced') continue;
        const speech = speechByPosition.get(appearance.speechPosition);
        const status = APPEARANCE_STATUS[appearance.kind] ?? 'still_contested';
        await tx.run(
          `INSERT INTO argument_status_history
            (round_id, argument_id, speech_id, status, previous_status, reason, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          round.id,
          argumentId,
          speech?.id ?? null,
          status,
          previousStatus,
          appearance.passage
            ? 'Recorded from a passage in this speech.'
            : 'Appearance inferred from the speech, without a matched passage.',
          meta.mode === 'demo' ? 'heuristic' : 'ai'
        );
        previousStatus = status;
      }

      if (argument.status !== previousStatus) {
        await tx.run(
          `INSERT INTO argument_status_history
            (round_id, argument_id, speech_id, status, previous_status, reason, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          round.id,
          argumentId,
          latest?.id ?? null,
          argument.status,
          previousStatus,
          argument.statusReason,
          meta.mode === 'demo' ? 'heuristic' : 'ai'
        );
      }
    }

    for (const relationship of analysis.relationships) {
      const sourceId = keyToId.get(relationship.fromKey);
      const targetId = keyToId.get(relationship.toKey);
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const existing = await tx.get(
        `SELECT id FROM argument_relationships
         WHERE round_id = ? AND source_argument_id = ? AND target_argument_id = ? AND relation = ?`,
        round.id,
        sourceId,
        targetId,
        relationship.relation
      );
      if (existing) continue;
      await tx.run(
        `INSERT INTO argument_relationships
          (round_id, user_id, source_argument_id, target_argument_id, relation, explanation, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        round.id,
        userId,
        sourceId,
        targetId,
        relationship.relation,
        relationship.explanation,
        meta.mode === 'demo' ? 'heuristic' : 'ai'
      );
    }

    for (const [index, finding] of analysis.findings.entries()) {
      const argumentId = finding.argumentKey ? keyToId.get(finding.argumentKey) ?? null : null;
      await tx.run(
        `INSERT INTO round_findings
          (round_id, user_id, argument_id, category, weakness_type, title, passage, explanation,
           why_it_matters, suggestion, confidence, origin, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        round.id,
        userId,
        argumentId,
        finding.category,
        finding.weaknessType,
        finding.title,
        finding.passage,
        finding.explanation,
        finding.whyItMatters,
        finding.suggestion,
        finding.confidence,
        meta.mode === 'demo' ? 'heuristic' : 'ai',
        index
      );
    }

    for (const [index, evidence] of analysis.evidence.entries()) {
      const speech = speechByPosition.get(evidence.speechPosition);
      const argumentId = evidence.argumentKey ? keyToId.get(evidence.argumentKey) ?? null : null;
      await tx.run(
        `INSERT INTO evidence_records
          (round_id, user_id, speech_id, argument_id, passage, citation, author, published_at,
           supported_claim, speaker_usage, supports_claim, assessment, explanation, confidence, origin, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        round.id,
        userId,
        speech?.id ?? null,
        argumentId,
        evidence.passage,
        evidence.citation,
        evidence.author,
        evidence.publishedAt,
        evidence.supportedClaim,
        evidence.speakerUsage,
        evidence.supportsClaim,
        evidence.assessment,
        evidence.explanation,
        evidence.confidence,
        meta.mode === 'demo' ? 'heuristic' : 'ai',
        index
      );
    }

    for (const skill of analysis.skills) {
      await tx.run(
        `INSERT INTO skill_assessments
          (user_id, format, skill_key, skill_name, level, explanation, passage, recommendation,
           source_type, source_id, round_id, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'round', ?, ?, ?)`,
        userId,
        formatSpec.id,
        skill.key,
        skill.name,
        skill.level,
        skill.explanation,
        skill.passage,
        skill.recommendation,
        round.id,
        round.id,
        meta.mode === 'demo' ? 'heuristic' : 'ai'
      );
    }

    await tx.run(
      `UPDATE rounds SET status = 'analyzed',
         last_analyzed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
      round.id,
      userId
    );

    return { roundAnalysisId };
  });

  logger.info('Round analysis stored', {
    roundId: round.id,
    format: formatSpec.id,
    mode: meta.mode,
    arguments: analysis.arguments.length,
    findings: analysis.findings.length,
    latencyMs: meta.latencyMs,
  });

  return persisted;
}
