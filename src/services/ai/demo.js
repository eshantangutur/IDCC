/**
 * ARGUMENT FORENSICS DEMO ANALYSER
 *
 * This is NOT an AI model. It is a local, deterministic structural heuristic
 * used only when no AI credentials are configured. It reads the supplied
 * speech, extracts sentences, looks for evidence/warrant/impact cues and
 * reports what it found. Every UI surface labels this output as demo mode.
 */

const EVIDENCE_CUES = [
  /\b\d+(?:\.\d+)?\s?%/,
  /\baccording to\b/i,
  /\bstud(?:y|ies)\b/i,
  /\bdata\b/i,
  /\breport(?:ed|s)?\b/i,
  /\bsurvey\b/i,
  /\bjournal\b/i,
  /\bpublished\b/i,
  /\bresearch\b/i,
  /\$[\d,]+/,
  /\b\d{4}\b/,
  /\bper (?:cent|capita|year)\b/i,
];

const WARRANT_CUES = [/\bbecause\b/i, /\bsince\b/i, /\bas a result\b/i, /\bwhich means\b/i, /\bleads? to\b/i, /\bresults? in\b/i, /\bthis causes\b/i];
const IMPACT_CUES = [/\bimpact\b/i, /\bcost/i, /\beconom/i, /\blives?\b/i, /\bhealth\b/i, /\bsecur/i, /\benvironment/i, /\bdeath/i, /\bpoverty\b/i, /\bgrowth\b/i, /\binflation\b/i, /\beducation\b/i];
const ABSOLUTE_CUES = [/\balways\b/i, /\bnever\b/i, /\bobviously\b/i, /\bclearly\b/i, /\beveryone\b/i, /\bno one\b/i, /\bundeniable\b/i, /\bguarantee/i, /\bproves?\b/i];
const CLASH_CUES = [/\bhowever\b/i, /\bopponent/i, /\bthey argue\b/i, /\bthe other side\b/i, /\beven if\b/i, /\brebut/i, /\bin response\b/i, /\btheir case\b/i];
const WEIGHING_CUES = [/\boutweigh/i, /\bweigh/i, /\beven if\b/i, /\bmagnitude\b/i, /\bprobability\b/i, /\btimeframe\b/i, /\bcomparative/i, /\bpreferable\b/i];
const VALUE_CUES = [/\bjustice\b/i, /\bliberty\b/i, /\bequality\b/i, /\bmorality\b/i, /\bmoral\b/i, /\bstability\b/i, /\bwelfare\b/i, /\bdignity\b/i, /\bautonomy\b/i];
const CRITERION_CUES = [/\bcriterion\b/i, /\bstandard\b/i, /\bmaximiz/i, /\bminimiz/i, /\bprotect/i, /\bpreserv/i, /\bought\b/i];
const PROVISION_CUES = [/\bshall\b/i, /\brequires?\b/i, /\bfunds?\b/i, /\bestablish/i, /\bprohibit/i, /\bmandat/i, /\bappropriat/i];
const PROCEDURE_CUES = [/\bamend/i, /\bmotion\b/i, /\bgermanen/i, /\bquorum\b/i, /\bsuspend\b/i, /\bprecedent\b/i];
const STRUCTURE_CUES = [/\bfirst\b/i, /\bsecond\b/i, /\bfinally\b/i, /\bnext\b/i, /\bconclusion\b/i, /\bcontention\b/i];

const has = (sentence, cues) => cues.some((cue) => cue.test(sentence));
const quote = (sentence, max = 420) => (sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence);

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(\[])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 15);
}

function component(list, index) {
  const entry = list[index];
  return entry ? entry.excerpt || entry.text : '';
}

function findFirst(sentences, cues) {
  return sentences.find((sentence) => has(sentence, cues)) || '';
}

function tally(list, type) {
  return list.map((entry, index) => ({
    id: `${type}${index + 1}`,
    text: quote(entry, 500),
    excerpt: quote(entry),
    strength: 'moderate',
    note: 'Extracted by the demo heuristic; review the sentence in context.',
  }));
}

export function generateDemoAnalysis({ formatSpec, content, resolution, sideLabel, speechType }) {
  const sentences = splitSentences(content);
  const paragraphs = String(content || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const evidenceSentences = sentences.filter((sentence) => has(sentence, EVIDENCE_CUES));
  const impactSentences = sentences.filter((sentence) => has(sentence, IMPACT_CUES) && !evidenceSentences.includes(sentence));
  const warrantSentences = sentences.filter((sentence) => has(sentence, WARRANT_CUES) && !evidenceSentences.includes(sentence));
  const claimSentences = sentences
    .filter((sentence) => !evidenceSentences.includes(sentence) && !impactSentences.includes(sentence) && !warrantSentences.includes(sentence))
    .slice(0, 6);
  if (claimSentences.length === 0 && sentences.length > 0) claimSentences.push(sentences[0]);

  const claims = tally(claimSentences, 'c');
  const evidence = tally(evidenceSentences.slice(0, 6), 'e');
  const warrants = tally(warrantSentences.slice(0, 5), 'w');
  const impacts = tally(impactSentences.slice(0, 4), 'i');

  const assumptions = claimSentences.slice(0, 2).map((sentence, index) => ({
    id: `a${index + 1}`,
    text: `The claim "${quote(sentence, 160)}" depends on an unstated assumption that the described mechanism operates as claimed.`,
    excerpt: quote(sentence),
    strength: 'moderate',
    note: 'Demo heuristic: the sentence contains no explicit warrant for this inference.',
  }));

  const counterarguments = claimSentences.slice(0, 2).map((sentence, index) => ({
    id: `r${index + 1}`,
    text: `The opposing ${formatSpec.sides.find((entry) => entry.label !== sideLabel)?.label || 'side'} could contest the causal step in "${quote(sentence, 140)}" by denying that the stated mechanism generalises.`,
    excerpt: quote(sentence),
    strength: 'moderate',
    note: 'Demo heuristic: a potential line of attack, not a claim about the opponent\'s actual case.',
  }));

  const nodes = [];
  const edges = [];
  const addNode = (type, text, detail) => {
    if (!text) return null;
    const id = `n${nodes.length + 1}`;
    nodes.push({
      id,
      type,
      label: quote(text, 70),
      excerpt: quote(text),
      detail: detail || '',
      strength: 'moderate',
    });
    return id;
  };

  const claimNodeIds = claims.slice(0, 4).map((claim) => addNode('claim', claim.text, 'Demo heuristic: treated as a claim because it asserts a position.'));
  evidence.slice(0, 3).forEach((entry) => {
    const id = addNode('evidence', entry.text, 'Demo heuristic: contains a date, statistic, source reference or number.');
    if (id && claimNodeIds[0]) edges.push({ from: id, to: claimNodeIds[0], relation: 'supports', explanation: 'Evidence appears to support the central claim; verify the source in context.', supported: true });
  });
  warrants.slice(0, 3).forEach((entry) => {
    const id = addNode('warrant', entry.text, 'Demo heuristic: contains an explicit causal connective.');
    if (id && claimNodeIds[0]) edges.push({ from: id, to: claimNodeIds[0], relation: 'warrants', explanation: 'The sentence supplies an explicit reason for the claim.', supported: true });
  });
  const impactIds = impacts.slice(0, 2).map((entry) => addNode('impact', entry.text, 'Demo heuristic: references a consequence domain.'));
  if (claimNodeIds[0] && impactIds[0]) {
    edges.push({ from: claimNodeIds[0], to: impactIds[0], relation: 'impacts', explanation: 'Demo heuristic: the speech connects the claim to this consequence without fully quantifying it.', supported: Boolean(evidence.length) });
  }
  assumptions.slice(0, 2).forEach((entry) => {
    const id = addNode('assumption', entry.text, entry.note);
    if (id && claimNodeIds[0]) edges.push({ from: id, to: claimNodeIds[0], relation: 'assumes', explanation: 'The speech relies on this unstated assumption.', supported: false });
  });
  counterarguments.slice(0, 2).forEach((entry) => {
    const id = addNode('counterargument', entry.text, entry.note);
    if (id && claimNodeIds[0]) edges.push({ from: id, to: claimNodeIds[0], relation: 'rebuts', explanation: 'No direct pre-emption of this objection appears in the speech.', supported: false });
  });

  const hasWeighing = sentences.some((sentence) => has(sentence, WEIGHING_CUES));
  const hasClash = sentences.some((sentence) => has(sentence, CLASH_CUES));
  const hasStructure = sentences.some((sentence) => has(sentence, STRUCTURE_CUES));
  const absoluteSentence = sentences.find((sentence) => has(sentence, ABSOLUTE_CUES));
  const primaryClaim = claims[0]?.excerpt || sentences[0] || '';
  const findings = [];
  let position = 0;
  const addFinding = (finding) => {
    findings.push({
      ...finding,
      position: position++,
      tags: finding.tags || ['demo-heuristic'],
    });
  };

  if (evidence.length === 0 && primaryClaim) {
    addFinding({
      title: 'No verifiable evidence is cited for the central claim',
      passage: quote(primaryClaim),
      weaknessType: 'missing_evidence',
      category: 'critical',
      explanation: 'The speech asserts its position but contains no statistic, source, study reference or dated example. Every load-bearing claim is therefore assertion-only.',
      whyItMatters: 'A judge has no external warrant to prefer this claim, so an opponent can answer with "no evidence" and win the credibility comparison.',
      suggestion: 'Attach at least one specific, dated source to the central claim and quote the finding rather than the conclusion.',
      confidence: 'high',
      nodeId: claimNodeIds[0] || null,
    });
  } else if (evidence.length > 0 && claimSentences.length > 2) {
    addFinding({
      title: 'Evidence is present but not tied to specific claims',
      passage: quote(evidence[0].excerpt),
      weaknessType: 'logical_weakness',
      category: 'moderate',
      explanation: 'The speech includes supporting material, yet the surrounding sentences do not state which claim each piece proves or how the cited figure establishes it.',
      whyItMatters: 'Unlinked evidence lets an opponent concede the statistic and dispute the inference, which is harder to answer in later speeches.',
      suggestion: 'After each piece of evidence, add one sentence beginning "This proves ... because ..." naming the claim it supports.',
      confidence: 'medium',
      nodeId: evidence[0] ? null : null,
    });
  }

  if (absoluteSentence) {
    addFinding({
      title: 'Absolute certainty language substitutes for proof',
      passage: quote(absoluteSentence),
      weaknessType: 'logical_weakness',
      category: 'moderate',
      explanation: 'The sentence uses absolute language ("always", "never", "clearly", "proves") without qualifying conditions. Any counterexample then defeats the claim as written.',
      whyItMatters: 'Overclaiming invites a one-line rebuttal: a single exception falsifies the assertion and damages credibility on adjacent arguments.',
      suggestion: 'Qualify the claim ("in most cases", "under current policy") and state the conditions under which it holds.',
      confidence: 'high',
      nodeId: null,
    });
  }

  if (!hasWeighing) {
    addFinding({
      title: 'No explicit comparative weighing',
      passage: quote(sentences[sentences.length - 1] || primaryClaim),
      weaknessType: formatSpec.formatSpecific.key === 'frameworkCheck' ? 'framework_weakness' : 'weighing_weakness',
      category: 'critical',
      explanation: 'The speech explains why its arguments are good, but never explains why they are better than the competing consideration. No magnitude, probability, timeframe or framework comparison appears.',
      whyItMatters: formatSpec.formatSpecific.key === 'frameworkCheck'
        ? 'Without framework interaction, the judge has no reason to prefer this value or criterion over the opponent\'s standard.'
        : 'Judges default to the opponent\'s weighing when only one side compares, so strong arguments can lose on a clean weighing line.',
      suggestion: formatSpec.formatSpecific.key === 'frameworkCheck'
        ? 'Add a framework interaction section: why this criterion should govern, and how the opponent\'s standard fails its own test.'
        : 'Add a weighing paragraph that compares this impact to the likely opposing impact on magnitude, probability and timeframe.',
      confidence: 'medium',
      nodeId: null,
    });
  }

  if (impacts.length === 0 && primaryClaim) {
    addFinding({
      title: 'Impacts remain implicit',
      passage: quote(primaryClaim),
      weaknessType: 'structural_weakness',
      category: 'moderate',
      explanation: 'The speech stops at policy or principle without stating who is affected, how much, and how soon. No sentence functions as a terminal impact.',
      whyItMatters: 'An implicit impact cannot be weighed and is easy for an opponent to characterise as abstract or non-unique.',
      suggestion: 'For each contention, add a labelled impact sentence with a quantity, an affected population and a timeframe.',
      confidence: 'medium',
      nodeId: impactIds[0] || null,
    });
  }

  if (sentences.length > 6 && !hasClash) {
    addFinding({
      title: 'No direct engagement with the opposing case',
      passage: quote(primaryClaim),
      weaknessType: 'strategic_judgment',
      category: 'moderate',
      explanation: 'The speech contains no reference to an opposing argument, no "even if" defence and no rebuttal of a competing position. It reads as a constructive only.',
      whyItMatters: 'If this is a rebuttal or later speech, unanswered opposing arguments survive to the judge\'s flow; if it is a constructive, the opponent gets a free first attack.',
      suggestion: 'Add a pre-emption paragraph naming the strongest opposing argument and answering it before it is run.',
      confidence: 'low',
      nodeId: null,
    });
  }

  if (warrants.length === 0 && primaryClaim) {
    addFinding({
      title: 'Links between evidence and claim are asserted, not warranted',
      passage: quote(primaryClaim),
      weaknessType: 'logical_weakness',
      category: 'moderate',
      explanation: 'No causal connective or explanatory sentence appears between the supporting material and the conclusion, so the inference is left to the judge.',
      whyItMatters: 'An unwarranted inference can be denied without touching the evidence, giving the opponent a cheap and persuasive answer.',
      suggestion: 'Insert an explicit "because" sentence that states the mechanism by which the evidence produces the claim.',
      confidence: 'medium',
      nodeId: warrantSentences[0] ? null : null,
    });
  }

  if (paragraphs.length >= 3 && !hasStructure) {
    addFinding({
      title: 'Structure is not signposted for the judge',
      passage: quote(paragraphs[2] || primaryClaim),
      weaknessType: 'structural_weakness',
      category: 'minor',
      explanation: 'The speech has multiple paragraphs but no ordinal signposting ("first", "second", "finally") or contention labels.',
      whyItMatters: 'Unlabelled structure increases the chance the judge drops an argument during the flow and reduces the clarity of later extensions.',
      suggestion: 'Label each contention and use ordinal transitions so the judge can flow and extend the argument later.',
      confidence: 'medium',
      nodeId: null,
    });
  }

  if (evidence.length >= 2) {
    addFinding({
      title: 'Supporting material is distributed across claims',
      passage: quote(evidence[0].excerpt),
      weaknessType: 'clarity',
      category: 'strength',
      explanation: `The speech cites ${evidence.length} sentence(s) containing dates, statistics or source references, giving the judge multiple anchors for the case.`,
      whyItMatters: 'Multiple evidence anchors make the case harder to answer with a single "no evidence" response and support later extensions.',
      suggestion: 'Keep these anchors and add a one-line warrant after each so the inference is as strong as the citation.',
      confidence: 'high',
      nodeId: null,
    });
  }

  if (warrants.length > 0) {
    addFinding({
      title: 'Explicit causal language connects claims to consequences',
      passage: quote(warrants[0].excerpt),
      weaknessType: 'clarity',
      category: 'strength',
      explanation: `The speech uses ${warrants.length} explicit causal connective(s), which makes the reasoning traceable rather than implied.`,
      whyItMatters: 'Explicit warrants are easier for a judge to flow and harder for an opponent to characterise as a leap.',
      suggestion: 'Extend these warrants with a comparative sentence so the mechanism also becomes a weighing advantage.',
      confidence: 'high',
      nodeId: warrantSentences[0] ? null : null,
    });
  }

  if (findings.filter((finding) => finding.category === 'strength').length < 2 && primaryClaim) {
    addFinding({
      title: 'A clear position on the resolution is stated',
      passage: quote(primaryClaim),
      weaknessType: 'clarity',
      category: 'strength',
      explanation: 'The speech commits to a recognisable position rather than describing both sides, which gives the judge something concrete to evaluate.',
      whyItMatters: 'A committed position is a prerequisite for clash and for extension into later speeches.',
      suggestion: 'Keep the commitment explicit and restate it verbatim in the final sentence of the speech.',
      confidence: 'medium',
      nodeId: null,
    });
  }

  if (findings.length < 3 && primaryClaim) {
    addFinding({
      title: 'Argument is compressed into relatively few sentences',
      passage: quote(primaryClaim),
      weaknessType: 'structural_weakness',
      category: 'improvement',
      explanation: `Only ${sentences.length} substantive sentence(s) were detected, which limits the depth of any structural analysis.`,
      whyItMatters: 'Short artifacts leave the mechanism and impact underdeveloped, even when the core idea is sound.',
      suggestion: 'Expand the argument with an explicit mechanism sentence, an evidence sentence and an impact sentence.',
      confidence: 'medium',
      nodeId: null,
    });
  }

  const overallOverview = primaryClaim
    ? `Demo structural read: the speech contains ${sentences.length} substantive sentence(s) across ${paragraphs.length || 1} paragraph(s). It states a position and offers ${evidence.length} sentence(s) with evidence markers, ${warrants.length} explicit causal link(s) and ${impacts.length} sentence(s) referencing consequences. No overall score is produced in demo mode.`
    : 'The supplied text is too short for a structural read.';

  const summary = {
    overview: overallOverview,
    structureAssessment: hasStructure
      ? 'The speech uses ordinal signposting, which makes the flow easier to follow.'
      : 'The speech is organised as continuous prose without contention labels, which makes extension and flow harder.',
    weighingSummary: hasWeighing
      ? 'Comparative weighing language is present; verify that it names a competing impact explicitly.'
      : 'No comparative weighing language was detected.',
    formatNotes: `${formatSpec.name} demo heuristic. This report was generated locally without an AI model: it detects structural cues only and cannot judge the truth of any claim.`,
    strongComponents: [
      evidence.length > 0 ? 'Contains sentences with evidence markers (dates, statistics or source references).' : null,
      warrants.length > 0 ? 'Uses explicit causal connectives that make reasoning traceable.' : null,
      hasStructure ? 'Signposts the structure for the judge.' : null,
      'Commits to a recognisable position on the resolution.',
    ].filter(Boolean).slice(0, 4),
  };

  const formatSpecific = buildFormatSpecific({ formatSpec, sentences, paragraphs, claimSentences, evidenceSentences, impactSentences, hasWeighing, hasClash, primaryClaim, speechType });

  const rubric = {
    dimensions: formatSpec.rubric.map((dimension) => {
      const heuristic = rubricHeuristic(dimension.key, { evidence, warrants, impacts, claims, hasWeighing, hasClash, hasStructure, sentences });
      return {
        key: dimension.key,
        name: dimension.name,
        score: heuristic.score,
        rationale: `Demo heuristic estimate (${heuristic.basis}). Not an AI judgment.`,
      };
    }),
  };

  return {
    summary,
    components: { claims, evidence, warrants, impacts, assumptions, counterarguments },
    nodes,
    edges,
    findings,
    logicalRelationships: [
      { description: 'Demo heuristic: each evidence node is attached to the first reconstructed claim; verify the actual link in the text.', from: 'evidence', to: 'claim' },
    ],
    contradictions: [],
    unsupportedAssertions: findings
      .filter((finding) => finding.weaknessType === 'missing_evidence' && finding.passage)
      .map((finding) => ({ text: finding.passage, why: 'No support for this claim appears in the supplied speech.' })),
    missingConnections: findings
      .filter((finding) => ['logical_weakness', 'structural_weakness'].includes(finding.weaknessType))
      .slice(0, 4)
      .map((finding) => ({ description: finding.title, suggestion: finding.suggestion })),
    counterargumentAnalysis: counterarguments.map((entry) => ({ argument: entry.text, response: 'Not addressed in this speech.', strength: 'moderate' })),
    rubric,
    formatSpecific: { [formatSpec.formatSpecific.key]: formatSpecific },
  };
}

function rubricHeuristic(key, { evidence, warrants, impacts, claims, hasWeighing, hasClash, hasStructure, sentences }) {
  const base = (value, basis) => ({ score: Math.min(5, Math.max(1, Math.round(value))), basis });
  switch (key) {
    case 'claim_clarity':
      return base(claims.length >= 3 ? 4 : claims.length >= 1 ? 3 : 1, `${claims.length} distinct claim sentence(s) detected`);
    case 'evidence_quality':
      return base(evidence.length >= 3 ? 4 : evidence.length >= 1 ? 3 : 1, `${evidence.length} sentence(s) contain evidence markers`);
    case 'warranting':
    case 'internal_linking':
    case 'argument_depth':
      return base(warrants.length >= 2 ? 4 : warrants.length === 1 ? 3 : 1, `${warrants.length} explicit causal link(s) detected`);
    case 'impact_weighing':
    case 'impact_calculus':
    case 'comparative_analysis':
      return base(hasWeighing ? 4 : impacts.length > 0 ? 2 : 1, hasWeighing ? 'weighing language detected' : 'no weighing language detected');
    case 'rebuttal_extension':
    case 'clash':
    case 'rebuttal_questioning':
      return base(hasClash ? 4 : 2, hasClash ? 'clash language detected' : 'no direct clash language detected');
    case 'framework_clarity':
    case 'framework_consistency':
    case 'philosophical_grounding':
    case 'framework_interaction':
      return base(hasStructure ? 3 : 2, 'framework-specific content cannot be verified by heuristics');
    case 'plan_clarity':
    case 'stock_issues':
    case 'da_completeness':
    case 'negative_layer':
    case 'legislative_analysis':
    case 'evidence_integration':
    case 'speech_organization':
    case 'persuasion_procedure':
    case 'role_adherence':
    case 'team_consistency':
      return base(sentences.length >= 8 ? 3 : 2, `${sentences.length} substantive sentence(s) available to evaluate structure`);
    default:
      return base(2 + (sentences.length > 6 ? 1 : 0), 'generic structural heuristic');
  }
}

function buildFormatSpecific({ formatSpec, sentences, paragraphs, claimSentences, evidenceSentences, impactSentences, hasWeighing, hasClash, primaryClaim, speechType }) {
  const key = formatSpec.formatSpecific.key;
  const notAddressed = 'Not addressed in this speech.';

  if (key === 'weighing') {
    return {
      magnitude: findFirst(sentences, [/\bmagnitude\b/i, /\bmillions?\b/i, /\bbillions?\b/i, /%/]) || notAddressed,
      probability: findFirst(sentences, [/\bprobab/i, /\blikely\b/i, /\brisk\b/i, /\bchance\b/i]) || notAddressed,
      timeframe: findFirst(sentences, [/\bdecade\b/i, /\byears?\b/i, /\bimmediate/i, /\bby 20\d\d\b/i, /\bsooner\b/i]) || notAddressed,
      comparativeFraming: findFirst(sentences, WEIGHING_CUES) || notAddressed,
      droppedArguments: hasClash ? [] : ['No opposing argument is named, so dropped arguments cannot be identified from this artifact alone.'],
    };
  }

  if (key === 'frameworkCheck') {
    const valueMatch = String(primaryClaim).match(/\bvalue\s*(?:is|:)\s*([^.;\n]{3,120})/i);
    const criterionMatch = String(primaryClaim).match(/\bcriterion\s*(?:is|:)\s*([^.;\n]{3,120})/i);
    const valueCue = sentences.find((sentence) => has(sentence, VALUE_CUES));
    const criterionCue = sentences.find((sentence) => has(sentence, CRITERION_CUES));
    const value = valueMatch?.[1]?.trim() || (valueCue ? `Implied by: "${quote(valueCue, 140)}"` : 'Not stated in this speech.');
    const criterion = criterionMatch?.[1]?.trim() || (criterionCue ? `Implied by: "${quote(criterionCue, 140)}"` : 'Not stated in this speech.');
    const bothPresent = Boolean(valueMatch?.[1] || valueCue) && Boolean(criterionMatch?.[1] || criterionCue);
    return {
      value,
      criterion,
      consistency: bothPresent ? 'partially_consistent' : 'inconsistent',
      notes: bothPresent
        ? 'Demo heuristic: a value and a criterion are identifiable, but argument-level resolution through the criterion cannot be verified without semantic analysis. Review each contention manually.'
        : 'Demo heuristic: the speech does not clearly state both a value and a criterion, so contentions cannot be tested against a standard.',
      tensions: bothPresent ? [] : ['No stable standard is available to evaluate the contentions.'],
      frameworkInteraction: findFirst(sentences, [/\bframework\b/i, /\bcriterion\b/i, /\bstandard\b/i]) || notAddressed,
    };
  }

  if (key === 'disadvantageChains') {
    const chains = paragraphs
      .filter((paragraph) => /\b(uniqueness|link|impact|disad|scenario|off[- ]case)\b/i.test(paragraph))
      .slice(0, 4)
      .map((paragraph, index) => {
        const parts = splitSentences(paragraph);
        const uniqueness = parts.find((sentence) => /\buniqueness\b/i.test(sentence)) || parts.find((sentence) => /\bcurrently\b|\bstatus quo\b|\bnow\b/i.test(sentence)) || '';
        const link = parts.find((sentence) => /\blink\b/i.test(sentence)) || parts.find((sentence) => /\bwill cause\b|\bleads? to\b|\bresults? in\b/i.test(sentence)) || '';
        const impact = parts.find((sentence) => /\bimpact\b/i.test(sentence)) || parts.find((sentence) => has(sentence, IMPACT_CUES)) || '';
        const internalLinks = parts.filter((sentence) => /\binternal\b/i.test(sentence)).slice(0, 3);
        return {
          name: `Extracted chain ${index + 1}`,
          uniqueness: uniqueness ? quote(uniqueness, 300) : 'Missing',
          link: link ? quote(link, 300) : 'Missing',
          internalLinks: internalLinks.map((sentence) => quote(sentence, 300)),
          impact: impact ? quote(impact, 300) : 'Missing',
          strength: uniqueness && link && impact ? 'moderate' : 'weak',
          notes: 'Demo heuristic extraction. Verify the chain against the full flow.',
        };
      });

    if (chains.length === 0) {
      chains.push({
        name: 'No disadvantage chain identified',
        uniqueness: 'Missing',
        link: 'Missing',
        internalLinks: [],
        impact: 'Missing',
        strength: 'weak',
        notes: 'No uniqueness, link or impact structure was detectable in this speech by the demo heuristic.',
      });
    }

    return {
      disadvantageChains: chains,
      stockIssues: {
        harms: findFirst(sentences, [/\bharm/i, /\bproblem\b/i, /\bcrisis\b/i]) || notAddressed,
        inherency: findFirst(sentences, [/\binheren/i, /\bstatus quo\b/i, /\bcurrent(?:ly)?\b/i]) || notAddressed,
        solvency: findFirst(sentences, [/\bsolven/i, /\bplan\b/i, /\bwould fix\b/i, /\bmechanism\b/i]) || notAddressed,
        topicality: findFirst(sentences, [/\btopical/i, /\bresolution\b/i, /\bplan text\b/i]) || notAddressed,
        counterplanOrKritik: findFirst(sentences, [/\bcounterplan\b/i, /\bkritik\b/i, /\balternative\b/i]) || notAddressed,
      },
      impactCalculus: findFirst(sentences, [/\bimpact calculus\b/i, ...WEIGHING_CUES]) || notAddressed,
    };
  }

  if (key === 'legislativeAnalysis') {
    const provisions = sentences
      .filter((sentence) => has(sentence, PROVISION_CUES))
      .slice(0, 6)
      .map((sentence) => ({
        text: quote(sentence, 400),
        interpretation: 'Demo heuristic: the sentence uses legislative language; confirm what the provision would actually do in the bill text.',
        support: 'Potential affirmative use: cite the provision as the mechanism for the claimed benefit.',
        attack: 'Potential objection: challenge funding, enforcement or scope as written.',
      }));
    return {
      provisions,
      proceduralNotes: findFirst(sentences, PROCEDURE_CUES) || notAddressed,
      persuasiveness: hasWeighing ? 'Comparative language is present; confirm it is tied to the bill.' : 'No comparative language detected; the speech reads as advocacy without comparison.',
      questioning: hasClash ? findFirst(sentences, CLASH_CUES) : notAddressed,
    };
  }

  if (key === 'teamConsistency') {
    const roleMap = {
      'First Proposition': 'Opening proposition speaker: must define the motion and establish the core case.',
      'First Opposition': 'Opening opposition speaker: must rebut the proposition case and establish the opposition line.',
      'Second Proposition': 'Second proposition: must extend the case with a new substantive argument and defend the first speaker.',
      'Second Opposition': 'Second opposition: must extend the opposition line and answer the proposition extension.',
      'Third Proposition': 'Third proposition: must extend, compare and crystallise without repeating.',
      'Third Opposition': 'Third opposition: must extend, compare and crystallise without repeating.',
      'Reply Speech': 'Reply speaker: must compare worlds and crystallise, introducing no new material.',
    };
    const repeatedWords = new Map();
    String(claimSentences.join(' '))
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 6)
      .forEach((word) => repeatedWords.set(word, (repeatedWords.get(word) || 0) + 1));
    const repetition = [...repeatedWords.entries()]
      .filter(([, count]) => count >= 3)
      .slice(0, 4)
      .map(([word, count]) => ({ idea: `"${word}" appears ${count} times`, speakers: 'Within this speech' }));

    return {
      roleAdherence: `${roleMap[speechType] || 'Speaker role not standardised for this speech type.'} Demo heuristic cannot verify consistency with other team members from a single speech.`,
      contradictions: [],
      repetition,
      comparativeStance: hasWeighing
        ? findFirst(sentences, WEIGHING_CUES)
        : 'No explicit comparison between the two worlds was detected.',
    };
  }

  return {};
}
