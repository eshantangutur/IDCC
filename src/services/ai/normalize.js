import { AiResponseError } from '../../utils/errors.js';
import { NODE_TYPES, FINDING_CATEGORIES, WEAKNESS_TYPES, CONFIDENCE_LEVELS, RELATIONS } from './prompt.js';
import { SCORE_SCALE } from '../formats.js';
import { deriveGraph } from './graph.js';

const MAX_NODES = 24;
const MAX_EDGES = 60;
const MAX_FINDINGS = 20;

const CATEGORY_SYNONYMS = {
  critical: 'critical',
  high: 'critical',
  major: 'critical',
  severe: 'critical',
  moderate: 'moderate',
  medium: 'moderate',
  minor: 'minor',
  low: 'minor',
  improvement: 'improvement',
  suggestion: 'improvement',
  opportunity: 'improvement',
  strength: 'strength',
  positive: 'strength',
  strong: 'strength',
};

const TYPE_SYNONYMS = {
  factual: 'factual_inaccuracy',
  factual_error: 'factual_inaccuracy',
  factual_inaccuracy: 'factual_inaccuracy',
  inaccuracy: 'factual_inaccuracy',
  missing_evidence: 'missing_evidence',
  unsupported: 'missing_evidence',
  evidence: 'missing_evidence',
  logical: 'logical_weakness',
  logical_weakness: 'logical_weakness',
  structural: 'structural_weakness',
  structural_weakness: 'structural_weakness',
  framework: 'framework_weakness',
  framework_weakness: 'framework_weakness',
  weighing: 'weighing_weakness',
  weighing_weakness: 'weighing_weakness',
  strategic: 'strategic_judgment',
  strategic_judgment: 'strategic_judgment',
  clarity: 'clarity',
};

function cleanText(value, max = 900) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(value, { maxItems = 10, maxLength = 400 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanText(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function pickEnum(value, allowed, fallback) {
  const key = String(value ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return allowed.includes(key) ? key : fallback;
}

function normalizeStrength(value) {
  return pickEnum(value, ['strong', 'moderate', 'weak'], 'moderate');
}

function normalizeComponentList(rawList, type, counter = { value: 0 }, max = 8) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .slice(0, max)
    .map((entry) => {
      if (typeof entry === 'string') {
        const text = cleanText(entry, 600);
        if (!text) return null;
        counter.value += 1;
        return { id: `${type[0]}${counter.value}`, text, excerpt: text, strength: 'moderate', note: '' };
      }
      if (!entry || typeof entry !== 'object') return null;
      const text = cleanText(entry.text ?? entry.label ?? entry.claim ?? entry.description, 600);
      const excerpt = cleanText(entry.excerpt ?? entry.passage ?? entry.quote ?? '', 900) || text;
      if (!text && !excerpt) return null;
      counter.value += 1;
      return {
        id: cleanText(entry.id, 40) || `${type[0]}${counter.value}`,
        text: text || excerpt,
        excerpt,
        strength: entry.strength ? normalizeStrength(entry.strength) : 'moderate',
        note: cleanText(entry.note ?? entry.why ?? entry.analysis ?? '', 600),
      };
    })
    .filter(Boolean);
}

function normalizeNodes(rawNodes) {
  if (!Array.isArray(rawNodes)) return [];
  const seen = new Set();
  const usedIds = new Map();
  const nodes = [];

  rawNodes.slice(0, MAX_NODES).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const type = pickEnum(entry.type ?? entry.kind, NODE_TYPES, 'claim');
    const label = cleanText(entry.label ?? entry.title ?? entry.text, 120);
    const excerpt = cleanText(entry.excerpt ?? entry.passage ?? entry.quote ?? entry.text, 900);
    if (!label && !excerpt) return;
    let id = cleanText(entry.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
    if (!id || seen.has(id)) id = `n${index + 1}`;
    let suffix = 1;
    const baseId = id;
    while (seen.has(id)) id = `${baseId}-${suffix++}`;
    seen.add(id);
    if (typeof entry.id === 'string' && entry.id.trim()) {
      usedIds.set(entry.id.trim(), id);
      usedIds.set(entry.id.trim().toLowerCase(), id);
    }
    nodes.push({
      id,
      type,
      label: label || excerpt.slice(0, 80),
      excerpt,
      detail: cleanText(entry.detail ?? entry.explanation ?? entry.note, 700),
      strength: entry.strength ? normalizeStrength(entry.strength) : 'moderate',
    });
  });

  return { nodes, usedIds };
}

function normalizeEdges(rawEdges, nodes, idAliases) {
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set();
  const edges = [];

  function resolveId(value) {
    const key = cleanText(value, 60);
    if (!key) return null;
    if (ids.has(key)) return key;
    const alias = idAliases.get(key) ?? idAliases.get(key.toLowerCase());
    return alias && ids.has(alias) ? alias : null;
  }

  if (Array.isArray(rawEdges)) {
    rawEdges.slice(0, MAX_EDGES).forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const from = resolveId(entry.from ?? entry.source ?? entry.sourceId);
      const to = resolveId(entry.to ?? entry.target ?? entry.targetId);
      if (!from || !to || from === to) return;
      const relation = pickEnum(entry.relation ?? entry.type, RELATIONS, 'supports');
      const key = `${from}|${to}|${relation}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({
        from,
        to,
        relation,
        explanation: cleanText(entry.explanation ?? entry.note, 600),
        supported: entry.supported === false ? false : true,
      });
    });
  }

  return edges;
}

function normalizeFinding(entry, index, nodeIds) {
  if (!entry || typeof entry !== 'object') return null;
  const title = cleanText(entry.title ?? entry.name, 180);
  const passage = cleanText(entry.passage ?? entry.quote ?? entry.excerpt ?? entry.text, 1200);
  const explanation = cleanText(entry.explanation ?? entry.description, 1200);
  if (!title || !explanation) return null;
  const category = CATEGORY_SYNONYMS[String(entry.category ?? entry.severity ?? '').toLowerCase().trim()] || 'moderate';
  const weaknessType = TYPE_SYNONYMS[String(entry.weaknessType ?? entry.type ?? '').toLowerCase().trim()] || 'strategic_judgment';
  const confidence = pickEnum(entry.confidence, CONFIDENCE_LEVELS, category === 'strength' ? 'high' : 'medium');
  const nodeCandidate = cleanText(entry.nodeId ?? entry.node ?? entry.node_id, 60);
  return {
    position: index,
    category,
    weaknessType,
    title,
    passage,
    explanation,
    whyItMatters: cleanText(entry.whyItMatters ?? entry.why_it_matters ?? entry.impact, 900),
    suggestion: cleanText(entry.suggestion ?? entry.improvement, 900),
    confidence,
    nodeId: nodeCandidate && nodeIds.has(nodeCandidate) ? nodeCandidate : null,
    tags: cleanList(entry.tags, { maxItems: 5, maxLength: 40 }),
  };
}

function normalizeRubric(rawRubric, formatSpec) {
  const rawDimensions = Array.isArray(rawRubric?.dimensions)
    ? rawRubric.dimensions
    : Array.isArray(rawRubric)
      ? rawRubric
      : [];

  const dimensions = formatSpec.rubric.map((definition) => {
    const match = rawDimensions.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const key = String(entry.key ?? entry.id ?? '').toLowerCase().trim();
      const name = String(entry.name ?? '').toLowerCase().trim();
      return key === definition.key.toLowerCase() || name === definition.name.toLowerCase();
    });
    const rawScore = match ? Number(match.score) : NaN;
    const score = Number.isFinite(rawScore) && rawScore >= SCORE_SCALE.min && rawScore <= SCORE_SCALE.max
      ? Math.round(rawScore)
      : null;
    return {
      key: definition.key,
      name: definition.name,
      definition: definition.definition,
      score,
      rationale: cleanText(match?.rationale ?? match?.reason ?? '', 500) || (score === null ? 'Not scored in this analysis.' : ''),
    };
  });

  const scored = dimensions.filter((dimension) => dimension.score !== null).length;
  return {
    scale: SCORE_SCALE.label,
    scaleDefinitions: SCORE_SCALE.definitions,
    caution: SCORE_SCALE.caution,
    dimensions,
    scored,
    complete: scored === dimensions.length,
  };
}

function normalizeFormatSpecific(raw, formatSpec) {
  const spec = formatSpec.formatSpecific;
  const source = raw?.formatSpecific?.[spec.key] ?? raw?.[spec.key] ?? null;

  if (spec.key === 'weighing') {
    const value = source && typeof source === 'object' ? source : {};
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      data: {
        magnitude: cleanText(value.magnitude, 600) || 'Not addressed in this speech.',
        probability: cleanText(value.probability, 600) || 'Not addressed in this speech.',
        timeframe: cleanText(value.timeframe, 600) || 'Not addressed in this speech.',
        comparativeFraming: cleanText(value.comparativeFraming, 700) || 'Not addressed in this speech.',
        droppedArguments: cleanList(value.droppedArguments, { maxItems: 8, maxLength: 300 }),
      },
    };
  }

  if (spec.key === 'frameworkCheck') {
    const value = source && typeof source === 'object' ? source : {};
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      data: {
        value: cleanText(value.value, 400) || 'Not stated in this speech.',
        criterion: cleanText(value.criterion, 400) || 'Not stated in this speech.',
        consistency: pickEnum(value.consistency, ['consistent', 'partially_consistent', 'inconsistent', 'unclear'], 'unclear'),
        notes: cleanText(value.notes, 900),
        tensions: cleanList(value.tensions, { maxItems: 8, maxLength: 400 }),
        frameworkInteraction: cleanText(value.frameworkInteraction, 700) || 'Not addressed in this speech.',
      },
    };
  }

  if (spec.key === 'disadvantageChains') {
    const chains = Array.isArray(source?.disadvantageChains) ? source.disadvantageChains : [];
    const stock = source?.stockIssues && typeof source.stockIssues === 'object' ? source.stockIssues : {};
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      data: {
        chains: chains.slice(0, 8).map((chain) => ({
          name: cleanText(chain?.name ?? chain?.title, 160) || 'Unnamed disadvantage',
          uniqueness: cleanText(chain?.uniqueness, 500) || 'Missing',
          link: cleanText(chain?.link, 500) || 'Missing',
          internalLinks: cleanList(chain?.internalLinks, { maxItems: 8, maxLength: 400 }),
          impact: cleanText(chain?.impact, 500) || 'Missing',
          strength: normalizeStrength(chain?.strength),
          notes: cleanText(chain?.notes, 600),
        })),
        stockIssues: {
          harms: cleanText(stock.harms, 700) || 'Not addressed in this speech.',
          inherency: cleanText(stock.inherency, 700) || 'Not addressed in this speech.',
          solvency: cleanText(stock.solvency, 700) || 'Not addressed in this speech.',
          topicality: cleanText(stock.topicality, 700) || 'Not addressed in this speech.',
          counterplanOrKritik: cleanText(stock.counterplanOrKritik, 700) || 'Not addressed in this speech.',
        },
        impactCalculus: cleanText(source?.impactCalculus, 800) || 'Not addressed in this speech.',
      },
    };
  }

  if (spec.key === 'legislativeAnalysis') {
    const value = source && typeof source === 'object' ? source : {};
    const provisions = Array.isArray(value.provisions) ? value.provisions : [];
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      data: {
        provisions: provisions.slice(0, 10).map((provision) => ({
          text: cleanText(provision?.text, 500),
          interpretation: cleanText(provision?.interpretation, 600),
          support: cleanText(provision?.support, 600),
          attack: cleanText(provision?.attack, 600),
        })).filter((provision) => provision.text),
        proceduralNotes: cleanText(value.proceduralNotes, 700),
        persuasiveness: cleanText(value.persuasiveness, 700),
        questioning: cleanText(value.questioning, 700),
      },
    };
  }

  if (spec.key === 'teamConsistency') {
    const value = source && typeof source === 'object' ? source : {};
    const contradictions = Array.isArray(value.contradictions) ? value.contradictions : [];
    const repetition = Array.isArray(value.repetition) ? value.repetition : [];
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      data: {
        roleAdherence: cleanText(value.roleAdherence, 800),
        contradictions: contradictions.slice(0, 8).map((entry) => ({
          between: cleanText(entry?.between, 300),
          description: cleanText(entry?.description, 600),
          severity: pickEnum(entry?.severity, ['critical', 'moderate', 'minor'], 'moderate'),
        })),
        repetition: repetition.slice(0, 8).map((entry) => ({
          idea: cleanText(entry?.idea, 400),
          speakers: cleanText(entry?.speakers, 300),
        })),
        comparativeStance: cleanText(value.comparativeStance, 800),
      },
    };
  }

  return { key: spec.key, label: spec.label, description: spec.description, data: {} };
}

/**
 * Validate and normalise an AI response into the shape persisted by the app.
 * Throws AiResponseError when the payload cannot support a useful report.
 */
export function normalizeAnalysis(raw, { formatSpec, content }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AiResponseError('The analysis service did not return a JSON object.');
  }

  const summaryRaw = raw.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const componentsRaw = raw.components && typeof raw.components === 'object'
    ? raw.components
    : raw.structure && typeof raw.structure === 'object'
      ? raw.structure
      : {};

  const counters = { claim: 0, evidence: 0, warrant: 0, impact: 0, assumption: 0, counterargument: 0 };
  const components = {
    claims: normalizeComponentList(componentsRaw.claims ?? componentsRaw.contentions, 'claim', { get value() { return counters.claim; }, set value(v) { counters.claim = v; } }),
    evidence: normalizeComponentList(componentsRaw.evidence, 'evidence', { get value() { return counters.evidence; }, set value(v) { counters.evidence = v; } }),
    warrants: normalizeComponentList(componentsRaw.warrants, 'warrant', { get value() { return counters.warrant; }, set value(v) { counters.warrant = v; } }),
    impacts: normalizeComponentList(componentsRaw.impacts, 'impact', { get value() { return counters.impact; }, set value(v) { counters.impact = v; } }),
    assumptions: normalizeComponentList(componentsRaw.assumptions, 'assumption', { get value() { return counters.assumption; }, set value(v) { counters.assumption = v; } }),
    counterarguments: normalizeComponentList(componentsRaw.counterarguments ?? raw.counterarguments, 'counterargument', { get value() { return counters.counterargument; }, set value(v) { counters.counterargument = v; } }),
  };

  const { nodes: aiNodes, usedIds } = normalizeNodes(raw.nodes);
  const rubric = normalizeRubric(raw.rubric, formatSpec);

  let nodes = aiNodes;
  let edges = normalizeEdges(raw.edges, nodes, usedIds);

  if (nodes.length < 3) {
    const derived = deriveGraph({ components, content });
    nodes = derived.nodes;
    edges = derived.edges;
  } else if (edges.length < 2) {
    const derived = deriveGraph({ components, content });
    if (derived.edges.length > 0) edges = derived.edges;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawFindings = Array.isArray(raw.findings)
    ? raw.findings
    : Array.isArray(raw.weaknesses)
      ? raw.weaknesses
      : [];

  const findings = rawFindings
    .slice(0, MAX_FINDINGS)
    .map((entry, index) => normalizeFinding(entry, index, nodeIds))
    .filter(Boolean);

  const summary = {
    overview: cleanText(summaryRaw.overview ?? raw.overview, 1800),
    structureAssessment: cleanText(summaryRaw.structureAssessment ?? summaryRaw.structure, 1200),
    weighingSummary: cleanText(summaryRaw.weighingSummary ?? summaryRaw.weighing, 1200),
    formatNotes: cleanText(summaryRaw.formatNotes, 900),
    strongComponents: cleanList(summaryRaw.strongComponents ?? summaryRaw.strengths, { maxItems: 8, maxLength: 400 }),
  };

  if (!summary.overview && findings.length === 0) {
    throw new AiResponseError('The analysis service returned neither a summary nor any findings.');
  }

  const contradictions = Array.isArray(raw.contradictions) ? raw.contradictions.slice(0, 10).map((entry) => ({
    title: cleanText(entry?.title ?? 'Potential contradiction', 200),
    passages: cleanList(entry?.passages ?? [entry?.passage], { maxItems: 4, maxLength: 600 }),
    explanation: cleanText(entry?.explanation, 900),
    severity: pickEnum(entry?.severity, ['critical', 'moderate', 'minor'], 'moderate'),
  })).filter((entry) => entry.explanation || entry.passages.length) : [];

  const analysis = {
    summary,
    structure: {
      ...components,
      relationships: Array.isArray(raw.logicalRelationships)
        ? raw.logicalRelationships.slice(0, 14).map((entry) => ({
          description: cleanText(entry?.description ?? entry?.relationship, 700),
          from: cleanText(entry?.from ?? entry?.source, 120),
          to: cleanText(entry?.to ?? entry?.target, 120),
        })).filter((entry) => entry.description)
        : [],
      contradictions,
      unsupportedAssertions: Array.isArray(raw.unsupportedAssertions)
        ? raw.unsupportedAssertions.slice(0, 12).map((entry) => ({
          text: cleanText(entry?.text ?? entry?.assertion, 600),
          why: cleanText(entry?.why ?? entry?.explanation, 600),
        })).filter((entry) => entry.text)
        : [],
      missingConnections: Array.isArray(raw.missingConnections)
        ? raw.missingConnections.slice(0, 12).map((entry) => ({
          description: cleanText(entry?.description ?? entry?.gap, 600),
          suggestion: cleanText(entry?.suggestion, 600),
        })).filter((entry) => entry.description)
        : [],
      counterargumentAnalysis: Array.isArray(raw.counterargumentAnalysis)
        ? raw.counterargumentAnalysis.slice(0, 10).map((entry) => ({
          argument: cleanText(entry?.argument, 600),
          response: cleanText(entry?.response, 600),
          strength: normalizeStrength(entry?.strength),
        })).filter((entry) => entry.argument)
        : [],
    },
    nodes,
    edges,
    findings,
    rubric,
    formatSpecific: normalizeFormatSpecific(raw, formatSpec),
  };

  analysis.counts = {
    claims: components.claims.length,
    evidence: components.evidence.length,
    warrants: components.warrants.length,
    impacts: components.impacts.length,
    assumptions: components.assumptions.length,
    counterarguments: components.counterarguments.length,
    findings: findings.length,
    critical: findings.filter((finding) => finding.category === 'critical').length,
    moderate: findings.filter((finding) => finding.category === 'moderate').length,
    minor: findings.filter((finding) => finding.category === 'minor').length,
    improvements: findings.filter((finding) => finding.category === 'improvement').length,
    strengths: findings.filter((finding) => finding.category === 'strength').length,
    nodes: nodes.length,
    edges: edges.length,
  };

  analysis.weaknessTypes = [...new Set(findings.map((finding) => finding.weaknessType))];
  analysis.categories = FINDING_CATEGORIES;
  analysis.weaknessTypeVocabulary = WEAKNESS_TYPES;

  return analysis;
}

export function parseJsonLoose(content) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiResponseError('The analysis service returned an empty response.');
  }
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AiResponseError('The analysis service did not return JSON.');
  }
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new AiResponseError('The analysis service returned malformed JSON.', { reason: error.message });
  }
}
