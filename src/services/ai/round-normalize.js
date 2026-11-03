import { AiResponseError } from '../../utils/errors.js';
import {
  ARGUMENT_STATUSES,
  ARGUMENT_TYPES,
  ARGUMENT_RELATIONS,
  EVIDENCE_ASSESSMENTS,
} from '../formats.js';
import { CONFIDENCE_LEVELS, FINDING_CATEGORIES, WEAKNESS_TYPES } from './round-prompt.js';

const MAX_ARGUMENTS = 40;
const MAX_FINDINGS = 24;
const MAX_EVIDENCE = 30;

function cleanText(value, max = 900) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function pickEnum(value, allowed, fallback) {
  const key = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  return allowed.includes(key) ? key : fallback;
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Confirms a quoted passage really appears in the speech it claims to come
 * from. The beginning of the passage is compared against the normalised
 * speech text, which tolerates whitespace and punctuation differences but not
 * invented wording. Nothing is rewritten when the check fails; the caller
 * downgrades confidence instead.
 */
export function passageAppears(passage, content) {
  const needle = normalizeForMatch(passage).slice(0, 90);
  if (!needle) return false;
  return normalizeForMatch(content).includes(needle);
}

function normalizeAppearances(raw, speechByPosition) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue;
    const position = Number(entry.speech);
    const speech = speechByPosition.get(position);
    if (!speech) continue;
    const passage = cleanText(entry.passage, 900);
    const verified = passage ? passageAppears(passage, speech.content) : false;
    out.push({
      speechPosition: position,
      speechId: speech.id,
      kind: pickEnum(entry.kind, ['introduced', 'answered', 'extended', 'conceded', 'turned', 'repeated'], 'repeated'),
      passage: verified ? passage : '',
      passageVerified: verified,
    });
  }
  return out;
}

function normalizeArguments(raw, { speeches, formatSpec }) {
  const speechByPosition = new Map(speeches.map((speech) => [speech.position, speech]));
  const sideIds = formatSpec.sides.map((side) => side.id);
  const usedKeys = new Set();
  const argumentsOut = [];

  if (!Array.isArray(raw)) return argumentsOut;

  raw.slice(0, MAX_ARGUMENTS).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const label = cleanText(entry.label ?? entry.claim, 160);
    const claim = cleanText(entry.claim ?? entry.label, 700);
    if (!label && !claim) return;

    let key = cleanText(entry.key ?? entry.id, 24).replace(/[^A-Za-z0-9_-]/g, '');
    if (!key || usedKeys.has(key)) key = `A${index + 1}`;
    let suffix = 1;
    const base = key;
    while (usedKeys.has(key)) key = `${base}-${suffix++}`;
    usedKeys.add(key);

    const introduced = speechByPosition.get(Number(entry.introducedSpeech));
    const latest = speechByPosition.get(Number(entry.latestSpeech));
    const appearances = normalizeAppearances(entry.appearances, speechByPosition);
    const unverified = appearances.some((appearance) => appearance.passage && !appearance.passageVerified);
    const confidence = pickEnum(entry.statusConfidence, CONFIDENCE_LEVELS, 'low');

    argumentsOut.push({
      key,
      side: pickEnum(entry.side, sideIds, introduced?.side ?? sideIds[0]),
      type: pickEnum(entry.type, ARGUMENT_TYPES, 'claim'),
      label: label || claim.slice(0, 120),
      claim: claim || label,
      warrant: cleanText(entry.warrant, 700) || 'Not stated',
      evidence: cleanText(entry.evidence, 700) || 'None offered',
      impact: cleanText(entry.impact, 700) || 'Not stated',
      assumptions: cleanText(entry.assumptions, 700),
      introducedSpeechPosition: introduced?.position ?? null,
      introducedSpeechId: introduced?.id ?? null,
      latestSpeechPosition: latest?.position ?? introduced?.position ?? null,
      latestSpeechId: latest?.id ?? introduced?.id ?? null,
      status: pickEnum(entry.status, ARGUMENT_STATUSES, 'unclear'),
      statusConfidence: unverified ? 'low' : confidence,
      statusReason:
        cleanText(entry.statusReason, 700) ||
        (unverified
          ? 'The supporting passage could not be matched to the recorded speech, so this status is uncertain.'
          : 'No reasoning was returned for this status.'),
      matchConfidence: pickEnum(entry.matchConfidence, CONFIDENCE_LEVELS, 'low'),
      appearances,
    });
  });

  return argumentsOut;
}

function normalizeRelationships(raw, argumentKeys) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(raw)) return out;

  for (const entry of raw.slice(0, 80)) {
    if (!entry || typeof entry !== 'object') continue;
    // Live models emit from/to; the local heuristic emits fromKey/toKey.
    const from = cleanText(entry.from ?? entry.source ?? entry.fromKey, 24);
    const to = cleanText(entry.to ?? entry.target ?? entry.toKey, 24);
    if (!argumentKeys.has(from) || !argumentKeys.has(to) || from === to) continue;
    const relation = pickEnum(entry.relation, ARGUMENT_RELATIONS, 'responds_to');
    const key = `${from}|${to}|${relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      fromKey: from,
      toKey: to,
      relation,
      explanation: cleanText(entry.explanation, 600),
      confidence: pickEnum(entry.confidence, CONFIDENCE_LEVELS, 'low'),
    });
  }

  return out;
}

function normalizeEvidence(raw, { speeches, argumentKeyToIndex }) {
  const speechByPosition = new Map(speeches.map((speech) => [speech.position, speech]));
  const out = [];
  if (!Array.isArray(raw)) return out;

  for (const entry of raw.slice(0, MAX_EVIDENCE)) {
    if (!entry || typeof entry !== 'object') continue;
    const passage = cleanText(entry.passage, 1200);
    if (!passage) continue;
    const speech = speechByPosition.get(Number(entry.speech));
    if (!speech) continue;
    const verified = passageAppears(passage, speech.content);
    // An evidence record is a quotation. If the quotation is not in the
    // speech, the record is fabricated and is discarded rather than shown.
    if (!verified) continue;
    const supportsClaim = entry.supportsClaim === true ? 1 : entry.supportsClaim === false ? 0 : null;
    out.push({
      speechPosition: speech.position,
      speechId: speech.id,
      argumentKey: cleanText(entry.argumentKey, 24) || null,
      passage,
      passageVerified: true,
      citation: cleanText(entry.citation, 300) || 'None',
      author: cleanText(entry.author, 200) || 'Not stated',
      publishedAt: cleanText(entry.publishedAt, 80) || 'Not stated',
      supportedClaim: cleanText(entry.supportedClaim, 500),
      speakerUsage: cleanText(entry.speakerUsage, 500),
      supportsClaim,
      assessment: pickEnum(entry.assessment, EVIDENCE_ASSESSMENTS, 'unsupported_claim'),
      explanation: cleanText(entry.explanation, 800),
      confidence: pickEnum(entry.confidence, CONFIDENCE_LEVELS, 'low'),
    });
  }

  return out;
}

function normalizeFindings(raw, { speeches, argumentIdByKey }) {
  const speechText = speeches.map((speech) => speech.content).join('\n');
  const out = [];
  if (!Array.isArray(raw)) return out;

  raw.slice(0, MAX_FINDINGS).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const title = cleanText(entry.title, 200);
    const explanation = cleanText(entry.explanation, 1200);
    if (!title || !explanation) return;
    const passage = cleanText(entry.passage, 1200);
    const verified = passage ? passageAppears(passage, speechText) : false;
    out.push({
      category: pickEnum(entry.category, FINDING_CATEGORIES, 'moderate'),
      weaknessType: pickEnum(entry.weaknessType, WEAKNESS_TYPES, 'strategic_judgment'),
      title,
      passage: verified ? passage : '',
      passageVerified: verified,
      explanation,
      whyItMatters: cleanText(entry.whyItMatters, 900),
      suggestion: cleanText(entry.suggestion, 900),
      confidence: verified ? pickEnum(entry.confidence, CONFIDENCE_LEVELS, 'medium') : 'low',
      argumentKey: cleanText(entry.argumentKey, 24) || null,
      argumentId: argumentIdByKey.get(cleanText(entry.argumentKey, 24)) ?? null,
    });
  });

  return out;
}

function normalizeSkills(raw, formatSpec) {
  if (!Array.isArray(raw)) return [];
  const current = new Map(formatSpec.rubric.map((dimension) => [dimension.key, dimension]));
  const out = [];
  const seen = new Set();

  for (const entry of raw.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue;
    const key = pickEnum(entry.key, [...current.keys()], '');
    if (!key || seen.has(key)) continue;
    const level = Number(entry.level ?? entry.score);
    if (!Number.isInteger(level) || level < 1 || level > 5) continue;
    seen.add(key);
    const dimension = current.get(key);
    out.push({
      key,
      name: dimension.name,
      level,
      explanation: cleanText(entry.explanation, 700),
      passage: cleanText(entry.passage, 900),
      recommendation: cleanText(entry.recommendation, 700),
    });
  }

  return out;
}

/**
 * Validate a round-analysis response. Throws when the payload cannot support a
 * useful round report. Nothing is silently invented: passages that cannot be
 * matched to a stored speech lose their quotation and their confidence.
 */
export function normalizeRoundAnalysis(raw, { formatSpec, speeches }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AiResponseError('The round analysis did not return a JSON object.');
  }

  const argumentsOut = normalizeArguments(raw.arguments, { speeches, formatSpec });
  if (argumentsOut.length === 0) {
    throw new AiResponseError('The round analysis did not identify any arguments.');
  }

  const argumentKeys = new Set(argumentsOut.map((argument) => argument.key));
  const argumentIdByKey = new Map(argumentsOut.map((argument, index) => [argument.key, index]));

  const summaryRaw = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const remainingClash = Array.isArray(summaryRaw.remainingClash)
    ? summaryRaw.remainingClash.map((entry) => cleanText(entry, 400)).filter(Boolean).slice(0, 10)
    : [];
  const strategicNotes = Array.isArray(summaryRaw.strategicNotes)
    ? summaryRaw.strategicNotes.map((entry) => cleanText(entry, 400)).filter(Boolean).slice(0, 8)
    : [];

  const analysis = {
    summary: {
      overview: cleanText(summaryRaw.overview, 1800),
      developmentSummary: cleanText(summaryRaw.developmentSummary, 1200),
      clashSummary: cleanText(summaryRaw.clashSummary, 1200),
      pro: cleanText(summaryRaw.pro, 1200),
      con: cleanText(summaryRaw.con, 1200),
      remainingClash,
      strategicNotes,
    },
    arguments: argumentsOut,
    relationships: normalizeRelationships(raw.relationships, argumentKeys),
    evidence: normalizeEvidence(raw.evidence, { speeches, argumentKeyToIndex: argumentIdByKey }),
    findings: normalizeFindings(raw.findings, { speeches, argumentIdByKey }),
    skills: normalizeSkills(raw.skills, formatSpec),
    speechPositions: speeches.map((speech) => speech.position),
  };

  analysis.counts = {
    arguments: analysis.arguments.length,
    relationships: analysis.relationships.length,
    evidence: analysis.evidence.length,
    findings: analysis.findings.length,
    critical: analysis.findings.filter((finding) => finding.category === 'critical').length,
    strengths: analysis.findings.filter((finding) => finding.category === 'strength').length,
    unanswered: analysis.arguments.filter((argument) =>
      ['dropped', 'unclear', 'partially_answered', 'still_contested'].includes(argument.status)
    ).length,
    skills: analysis.skills.length,
  };

  return analysis;
}
