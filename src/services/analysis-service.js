import { ApiError, notFound } from '../utils/errors.js';
import { getSideLabel } from '../services/formats.js';
import { saveSpeechSkillAssessments } from './progress-service.js';

export function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function passageSurvives(passage, content) {
  const needle = normalizeForMatch(passage).slice(0, 70);
  if (!needle) return true;
  return normalizeForMatch(content).includes(needle);
}

function summarizeFinding(finding) {
  return {
    id: finding.id ?? null,
    title: finding.title,
    passage: finding.passage,
    category: finding.category,
    weaknessType: finding.weaknessType,
    confidence: finding.confidence,
  };
}

export function compareWithPrevious(previous, newContent) {
  if (!previous) return null;
  const previousResult = previous.result ?? {};
  const previousFindings = Array.isArray(previousResult.findings) ? previousResult.findings : [];
  const resolved = [];
  const persistent = [];

  for (const finding of previousFindings) {
    if (!finding?.passage) continue;
    if (passageSurvives(finding.passage, newContent)) {
      persistent.push(summarizeFinding(finding));
    } else {
      resolved.push(summarizeFinding(finding));
    }
  }

  return {
    previousAnalysisId: previous.id,
    previousCreatedAt: previous.createdAt,
    resolved,
    persistent,
    resolvedCount: resolved.length,
    persistentCount: persistent.length,
  };
}

async function loadOwnedSpeech(db, userId, speechId) {
  const speech = await db.get('SELECT * FROM speeches WHERE id = ? AND user_id = ?', speechId, userId);
  if (!speech) throw notFound('That speech does not exist in your workspace.');
  return speech;
}

async function loadLatestAnalysis(db, userId, speechId) {
  const row = await db.get(
    `SELECT id, content, result_json, created_at
     FROM analyses
     WHERE speech_id = ? AND user_id = ?
     ORDER BY id DESC LIMIT 1`,
    speechId,
    userId
  );
  if (!row) return null;
  let result = null;
  try {
    result = JSON.parse(row.result_json);
  } catch {
    result = null;
  }
  return { id: row.id, createdAt: row.created_at, content: row.content, result };
}

function deriveTitle({ title, resolution, formatSpec, speechType }) {
  const base = (title && String(title).trim()) || resolution;
  const short = base.length > 90 ? `${base.slice(0, 87)}…` : base;
  return `${formatSpec.abbreviation} · ${speechType} · ${short}`;
}

/**
 * Runs an analysis and persists the speech version, analysis and findings
 * atomically. Nothing is written when the provider call fails.
 */
export function createAnalysisService({ db, logger, ai }) {
  async function run({
    userId,
    formatSpec,
    resolution,
    side,
    speechType,
    content,
    caseId = null,
    speechId = null,
    title = null,
  }) {
    let speech = null;
    let previous = null;

    if (speechId) {
      speech = await loadOwnedSpeech(db, userId, speechId);
      previous = await loadLatestAnalysis(db, userId, speech.id);
    }

    if (caseId) {
      const ownedCase = await db.get('SELECT id FROM debate_cases WHERE id = ? AND user_id = ?', caseId, userId);
      if (!ownedCase) throw notFound('That case does not exist in your workspace.');
    }

    const { analysis, meta } = await ai.analyze({
      formatSpec,
      resolution,
      sideLabel: getSideLabel(formatSpec.id, side),
      speechType,
      content,
    });

    const comparison = previous ? compareWithPrevious(previous, content) : null;

    const persisted = await db.transaction(async (tx) => {
      let speechRow = speech;
      let versionRow;
      let versionCreated = false;

      if (!speechRow) {
        const speechInsert = await tx.run(
          `INSERT INTO speeches (user_id, case_id, title, format, side, speech_type, resolution, latest_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          userId,
          caseId,
          deriveTitle({ title, resolution, formatSpec, speechType }),
          formatSpec.id,
          side,
          speechType,
          resolution
        );
        speechRow = await tx.get('SELECT * FROM speeches WHERE id = ?', speechInsert.lastInsertRowid);
        versionRow = await tx.get(
          `INSERT INTO speech_versions (speech_id, version, content, label, word_count)
           VALUES (?, 1, ?, 'Initial draft', ?) RETURNING *`,
          speechRow.id,
          content,
          countWords(content)
        );
        versionCreated = true;
      } else {
        const latest = await tx.get(
          'SELECT * FROM speech_versions WHERE speech_id = ? ORDER BY version DESC LIMIT 1',
          speechRow.id
        );
        if (latest && latest.content === content) {
          versionRow = latest;
        } else {
          const nextVersion = (latest?.version ?? 0) + 1;
          versionRow = await tx.get(
            `INSERT INTO speech_versions (speech_id, version, content, label, word_count)
             VALUES (?, ?, ?, ?, ?) RETURNING *`,
            speechRow.id,
            nextVersion,
            content,
            `Revision ${nextVersion}`,
            countWords(content)
          );
          versionCreated = true;
        }
        await tx.run(
          `UPDATE speeches
           SET latest_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               resolution = ?, format = ?, side = ?, speech_type = ?,
               case_id = COALESCE(case_id, ?)
           WHERE id = ? AND user_id = ?`,
          versionRow.version,
          resolution,
          formatSpec.id,
          side,
          speechType,
          caseId,
          speechRow.id,
          userId
        );
        speechRow = await tx.get('SELECT * FROM speeches WHERE id = ?', speechRow.id);
      }

      const analysisInsert = await tx.run(
        `INSERT INTO analyses
          (user_id, speech_id, speech_version_id, case_id, format, side, speech_type, resolution,
           content, summary, rubric_json, format_specific_json, result_json, comparison_json,
           provider, model, mode, is_demo, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        speechRow.id,
        versionRow.id,
        caseId || speechRow.case_id || null,
        formatSpec.id,
        side,
        speechType,
        resolution,
        content,
        analysis.summary.overview,
        JSON.stringify(analysis.rubric),
        JSON.stringify(analysis.formatSpecific),
        JSON.stringify(analysis),
        comparison ? JSON.stringify(comparison) : null,
        meta.provider,
        meta.model,
        meta.mode,
        meta.mode === 'demo' ? 1 : 0,
        meta.latencyMs
      );

      const analysisId = analysisInsert.lastInsertRowid;

      for (const [index, finding] of analysis.findings.entries()) {
        await tx.run(
          `INSERT INTO analysis_findings
            (analysis_id, category, weakness_type, title, passage, explanation, why_it_matters,
             suggestion, confidence, node_key, tags_json, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          analysisId,
          finding.category,
          finding.weaknessType,
          finding.title,
          finding.passage,
          finding.explanation,
          finding.whyItMatters,
          finding.suggestion,
          finding.confidence,
          finding.nodeId,
          JSON.stringify(finding.tags || []),
          index
        );
      }

      for (const [index, node] of analysis.nodes.entries()) {
        await tx.run(
          `INSERT INTO argument_nodes (analysis_id, node_key, type, label, excerpt, detail, strength, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          analysisId,
          node.id,
          node.type,
          node.label,
          node.excerpt,
          node.detail,
          node.strength,
          index
        );
      }

      for (const edge of analysis.edges) {
        await tx.run(
          `INSERT INTO argument_edges (analysis_id, source_key, target_key, relation, explanation, supported)
           VALUES (?, ?, ?, ?, ?, ?)`,
          analysisId,
          edge.from,
          edge.to,
          edge.relation,
          edge.explanation,
          edge.supported ? 1 : 0
        );
      }

      // One assessment per scored rubric dimension feeds the progress
      // dashboard. Ratings are persisted with the analysis they came from.
      await saveSpeechSkillAssessments({
        tx,
        userId,
        formatSpec,
        analysis,
        analysisId,
        speechId: speechRow.id,
      });

      return {
        analysisId,
        speechId: speechRow.id,
        speechVersionId: versionRow.id,
        version: versionRow.version,
        versionCreated,
      };
    });

    logger.info('Analysis stored', {
      analysisId: persisted.analysisId,
      format: formatSpec.id,
      mode: meta.mode,
      findings: analysis.findings.length,
      latencyMs: meta.latencyMs,
    });

    return {
      ...persisted,
      mode: meta.mode,
      provider: meta.provider,
      model: meta.model,
      latencyMs: meta.latencyMs,
      attempts: meta.attempts,
      demoReason: meta.demoReason || null,
      comparison,
      analysis,
      speech: {
        id: persisted.speechId,
        title: deriveTitle({ title, resolution, formatSpec, speechType }),
        version: persisted.version,
      },
    };
  }

  return { run };
}

export async function loadAnalysis(db, userId, analysisId) {
  const row = await db.get('SELECT * FROM analyses WHERE id = ? AND user_id = ?', analysisId, userId);
  if (!row) throw notFound('That analysis does not exist in your workspace.');

  let result;
  try {
    result = JSON.parse(row.result_json);
  } catch {
    throw new ApiError(500, 'This analysis record could not be read.', 'corrupt_analysis');
  }

  let comparison = null;
  if (row.comparison_json) {
    try {
      comparison = JSON.parse(row.comparison_json);
    } catch {
      comparison = null;
    }
  }

  const speech = row.speech_id
    ? await db.get('SELECT id, title, latest_version, format, side, speech_type FROM speeches WHERE id = ? AND user_id = ?', row.speech_id, userId)
    : null;

  const speechVersionRow = row.speech_version_id
    ? await db.get('SELECT version FROM speech_versions WHERE id = ?', row.speech_version_id)
    : null;

  return {
    id: row.id,
    format: row.format,
    side: row.side,
    speechType: row.speech_type,
    resolution: row.resolution,
    content: row.content,
    createdAt: row.created_at,
    mode: row.mode,
    isDemo: Boolean(row.is_demo),
    provider: row.provider,
    model: row.model,
    latencyMs: row.latency_ms,
    speechId: row.speech_id,
    caseId: row.case_id,
    speechVersionId: row.speech_version_id,
    speechVersion: speechVersionRow?.version ?? null,
    speech,
    result,
    comparison,
  };
}
