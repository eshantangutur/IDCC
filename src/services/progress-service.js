import { FORMATS, getFormat } from './formats.js';

/**
 * Personal development tracking.
 *
 * Every number returned here is aggregated from stored skill_assessments rows.
 * When a skill has fewer than two assessments the response marks it as
 * insufficient data and the UI shows that state instead of inventing a trend.
 * There is no comparison against other users and no ranking.
 */

function recommendationFor(level, definition) {
  if (level <= 2) {
    return `Prioritise this in your next speech. The standard is: ${definition}`;
  }
  if (level === 3) {
    return `Make this explicit rather than implied in the next round. The standard is: ${definition}`;
  }
  return 'Keep this pattern and reuse it when the round gets tight.';
}

/**
 * Stores one assessment per scored rubric dimension. Rationale comes from the
 * analysis itself; a supporting passage is only recorded when the analysis
 * tied a finding to the same dimension, so the dashboard never shows a quote
 * that does not belong to the rating.
 */
export async function saveSpeechSkillAssessments({ tx, userId, formatSpec, analysis, analysisId, speechId }) {
  const dimensions = analysis?.rubric?.dimensions ?? [];
  if (!dimensions.length) return 0;

  const findings = analysis?.findings ?? [];
  let saved = 0;

  for (const dimension of dimensions) {
    if (!Number.isInteger(dimension.score)) continue;
    const relatedFinding = findings.find(
      (finding) => finding.tags?.some((tag) => String(tag).toLowerCase() === dimension.key.toLowerCase())
    );
    await tx.run(
      `INSERT INTO skill_assessments
        (user_id, format, skill_key, skill_name, level, explanation, passage, recommendation,
         source_type, source_id, analysis_id, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'speech', ?, ?, ?)`,
      userId,
      formatSpec.id,
      dimension.key,
      dimension.name,
      dimension.score,
      dimension.rationale || 'Scored without a written rationale.',
      relatedFinding?.passage ?? null,
      recommendationFor(dimension.score, dimension.definition),
      speechId,
      analysisId,
      'ai'
    );
    saved += 1;
  }

  return saved;
}

export function createProgressService({ db }) {
  async function getProgress(userId, { format = null, from = null, to = null, skill = null } = {}) {
    const conditions = ['user_id = ?'];
    const params = [userId];
    if (format) {
      conditions.push('format = ?');
      params.push(format);
    }
    if (from) {
      conditions.push('created_at >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('created_at <= ?');
      params.push(to);
    }
    if (skill) {
      conditions.push('skill_key = ?');
      params.push(skill);
    }

    const rows = await db.all(
      `SELECT * FROM skill_assessments WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC, id ASC`,
      ...params
    );

    const formatIds = [...new Set(rows.map((row) => row.format))];
    const formatSpec = format ? getFormat(format) : null;

    const bySkill = new Map();
    for (const row of rows) {
      const key = `${row.format}:${row.skill_key}`;
      if (!bySkill.has(key)) {
        bySkill.set(key, {
          format: row.format,
          key: row.skill_key,
          name: row.skill_name,
          assessments: [],
        });
      }
      bySkill.get(key).assessments.push({
        id: row.id,
        level: row.level,
        explanation: row.explanation,
        passage: row.passage,
        recommendation: row.recommendation,
        sourceType: row.source_type,
        sourceId: row.source_id,
        createdAt: row.created_at,
      });
    }

    const skills = [...bySkill.values()]
      .map((entry) => {
        const levels = entry.assessments.map((assessment) => assessment.level);
        const latest = levels[levels.length - 1];
        const previous = levels.length >= 2 ? levels[levels.length - 2] : null;
        const first = levels[0];
        const average = levels.reduce((sum, value) => sum + value, 0) / levels.length;
        const lowCount = levels.filter((level) => level <= 2).length;
        const latestAssessment = entry.assessments[entry.assessments.length - 1];

        return {
          format: entry.format,
          key: entry.key,
          name: entry.name,
          assessments: entry.assessments,
          count: levels.length,
          latest,
          previous,
          first,
          delta: previous === null ? null : latest - previous,
          improvement: levels.length >= 2 ? latest - first : null,
          average: Number(average.toFixed(2)),
          repeatedWeakness: levels.length >= 2 && lowCount >= 2,
          insufficientData: levels.length < 2,
          recommendation: latestAssessment?.recommendation ?? null,
          latestExplanation: latestAssessment?.explanation ?? null,
          latestPassage: latestAssessment?.passage ?? null,
        };
      })
      .sort((a, b) => a.format.localeCompare(b.format) || a.name.localeCompare(b.name));

    const repeatedWeaknesses = skills.filter((entry) => entry.repeatedWeakness);
    const improvements = skills
      .filter((entry) => entry.improvement !== null && entry.improvement > 0)
      .sort((a, b) => b.improvement - a.improvement);

    const focusAreas = skills
      .filter((entry) => !entry.insufficientData)
      .sort((a, b) => a.latest - b.latest || a.average - b.average)
      .slice(0, 3)
      .map((entry) => ({
        key: entry.key,
        name: entry.name,
        format: entry.format,
        latest: entry.latest,
        recommendation: entry.recommendation,
      }));

    const sourceCounts = rows.reduce(
      (accumulator, row) => {
        accumulator[row.source_type] = (accumulator[row.source_type] ?? 0) + 1;
        return accumulator;
      },
      { speech: 0, round: 0 }
    );

    const formats = FORMATS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      abbreviation: entry.abbreviation,
      skills: entry.rubric.map((dimension) => ({ key: dimension.key, name: dimension.name })),
    })).filter((entry) => formatIds.length === 0 || formatIds.includes(entry.id));

    return {
      generatedAt: new Date().toISOString(),
      filters: { format, from, to, skill },
      totals: {
        assessments: rows.length,
        skillsTracked: skills.length,
        formats: formatIds.length,
        speechAssessments: sourceCounts.speech ?? 0,
        roundAssessments: sourceCounts.round ?? 0,
      },
      availableFormats: formats,
      formatSpec: formatSpec
        ? { id: formatSpec.id, name: formatSpec.name, rubric: formatSpec.rubric }
        : null,
      skills,
      repeatedWeaknesses: repeatedWeaknesses.map((entry) => ({
        key: entry.key,
        name: entry.name,
        format: entry.format,
        lowCount: entry.assessments.filter((assessment) => assessment.level <= 2).length,
        count: entry.count,
        recommendation: entry.recommendation,
      })),
      improvements,
      focusAreas,
      insufficientData: skills.every((entry) => entry.insufficientData),
      note:
        'Ratings come only from stored analyses. A skill needs at least two assessments before a trend is shown.',
    };
  }

  return { getProgress };
}
