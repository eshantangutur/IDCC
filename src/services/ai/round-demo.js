/**
 * Deterministic round analyser.
 *
 * This is the fallback used when no AI provider is configured. It is a real
 * heuristic over the recorded speeches, not sample data: arguments are split
 * out of the text, matched across speeches by token overlap, and findings are
 * derived from missing warrants, missing evidence and unresolved statuses.
 *
 * It is deliberately conservative about status. It never marks an argument
 * "dropped" on its own, because a transcript of speeches alone cannot prove
 * that nobody answered it.
 */

const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'will', 'would', 'there', 'their', 'they',
  'because', 'which', 'when', 'what', 'about', 'into', 'than', 'then', 'also', 'more', 'most',
  'some', 'such', 'very', 'just', 'only', 'over', 'under', 'been', 'were', 'was', 'are', 'for',
  'our', 'you', 'your', 'his', 'her', 'its', 'not', 'but', 'can', 'does', 'did', 'has', 'had',
]);

const EVIDENCE_RE = /\b(according to|study|studies|report|survey|data|research|found that|percent|\d+(?:\.\d+)?%|\b(?:19|20)\d{2}\b)\b/i;
const WARRANT_RE = /\b(because|since|therefore|thus|which means|as a result|leads? to|so that|given that|if)\b/i;
const IMPACT_RE = /\b(impact|harm|cost|econom\w*|jobs?|liv(?:es|ing)|deaths?|growth|security|traffic|wages?|inflation|health|safety|access)\b/i;
const ASSUMPTION_RE = /\b(obviously|clearly|everyone knows|of course|assume[sd]?|naturally|simply|must be)\b/i;
const CONCESSION_RE = /\b(concede|concedes|conceded|grant|granted|accept|accepted|admit|fair point)\b/i;
const TURN_RE = /\b(turn|turns|turned|backfire|backfires|actually shows|reverse|reverses)\b/i;

function sentencesOf(content) {
  return String(content || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 40);
}

function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word))
  );
}

export function textSimilarity(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

function classify(sentence) {
  return {
    evidence: EVIDENCE_RE.test(sentence),
    warrant: WARRANT_RE.test(sentence),
    impact: IMPACT_RE.test(sentence),
    assumption: ASSUMPTION_RE.test(sentence),
    concession: CONCESSION_RE.test(sentence),
    turn: TURN_RE.test(sentence),
  };
}

function citationOf(sentence) {
  const match = sentence.match(/\b(?:according to|per|by)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/);
  if (match) return match[1].trim();
  const year = sentence.match(/\b(19|20)\d{2}\b/);
  return year ? `Source dated ${year[0]}` : null;
}

function clampLevel(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function skillRatings(formatSpec, metrics) {
  const ratios = {
    clarity: metrics.arguments > 0 ? 1 : 0,
    warrant: metrics.warrantRatio,
    evidence: metrics.evidenceRatio,
    impact: metrics.impactRatio,
    response: metrics.responseRatio,
    structure: metrics.structureRatio,
  };

  const pick = (key) => {
    if (/evidence/.test(key)) return ratios.evidence;
    if (/warrant/.test(key)) return ratios.warrant;
    if (/impact|weigh|calculus/.test(key)) return ratios.impact;
    if (/rebut|clash|response|interaction|question|role|stock|da_|disadvantage|framework_consistency/.test(key)) return ratios.response;
    if (/framework/.test(key)) return ratios.warrant;
    if (/organi|structure|team/.test(key)) return ratios.structure;
    if (/claim|clarity/.test(key)) return ratios.clarity;
    return ratios.structure;
  };

  return formatSpec.rubric
    .map((dimension) => {
      if (metrics.arguments === 0) return null;
      const ratio = pick(dimension.key);
      const level = clampLevel(1 + ratio * 4);
      return {
        key: dimension.key,
        name: dimension.name,
        level,
        explanation: `Demo heuristic: derived from ${metrics.arguments} argument${
          metrics.arguments === 1 ? '' : 's'
        } across ${metrics.speeches} recorded speech${metrics.speeches === 1 ? '' : 'es'} (measured ratio ${ratio.toFixed(
          2
        )}).`,
        passage: metrics.firstClaim || '',
        recommendation:
          level <= 2
            ? `Add or repair this in your next speech: ${dimension.definition}`
            : level === 3
              ? `Make this explicit rather than implied: ${dimension.definition}`
              : 'Keep this pattern and reuse it in the next round.',
      };
    })
    .filter(Boolean);
}

export function generateDemoRoundAnalysis({ formatSpec, resolution, speeches }) {
  const byPosition = new Map(speeches.map((speech) => [speech.position, speech]));
  const argumentsOut = [];
  const relationships = [];
  const evidenceOut = [];
  const findingsOut = [];
  let evidenceSentences = 0;
  let warrantSentences = 0;
  let impactSentences = 0;
  let answeredArguments = 0;
  let firstClaim = '';

  const argumentForSpeech = new Map();

  for (const speech of speeches) {
    const sentences = sentencesOf(speech.content);
    const claimCandidates = sentences
      .filter((sentence) => {
        const flags = classify(sentence);
        return sentence.length >= 60 && !(flags.evidence && !flags.warrant && !flags.impact);
      })
      .slice(0, 4);

    const localArguments = [];

    for (const claim of claimCandidates) {
      const flags = classify(claim);
      const supporting = sentences.filter((sentence) => sentence !== claim);
      const warrantSentence = supporting.find((sentence) => classify(sentence).warrant);
      const evidenceSentence = supporting.find((sentence) => classify(sentence).evidence);
      const impactSentence = supporting.find((sentence) => classify(sentence).impact);

      if (flags.warrant) warrantSentences += 1;
      if (flags.impact) impactSentences += 1;
      if (evidenceSentence) evidenceSentences += 1;
      if (!firstClaim) firstClaim = claim;

      let matched = null;
      let bestScore = 0;
      for (const existing of argumentsOut) {
        const score = textSimilarity(claim, existing.claim);
        if (score > bestScore) {
          bestScore = score;
          matched = existing;
        }
      }

      // Same side + strong overlap means the argument was extended, not
      // re-introduced. Opposite side means this sentence is a response, which
      // becomes its own node so the graph can show the clash.
      let responseTo = null;
      if (matched && matched.side === speech.side && bestScore >= 0.3) {
        matched.appearances.push({ speech: speech.position, kind: 'extended', passage: claim });
        matched.method = 'extended';
        matched.latestSpeech = speech.position;
        if (!['answered', 'conceded', 'turned'].includes(matched.status)) matched.status = 'extended';
        localArguments.push(matched);
        continue;
      }

      if (matched && matched.side !== speech.side && bestScore >= 0.22) {
        responseTo = matched;
        const kind = flags.concession ? 'conceded' : flags.turn ? 'turned' : 'answered';
        matched.appearances.push({ speech: speech.position, kind, passage: claim });
        matched.latestSpeech = speech.position;
        matched.method = kind;
        matched.status =
          kind === 'conceded'
            ? 'conceded'
            : kind === 'turned'
              ? 'turned'
              : bestScore >= 0.4
                ? 'answered'
                : 'partially_answered';
        matched.statusConfidence = 'low';
        matched.statusReason = `Demo heuristic: a later ${speech.side} speech repeats ${Math.round(
          bestScore * 100
        )}% of this argument's distinctive wording. Verify that it is a real response.`;
        if (['answered', 'partially_answered'].includes(matched.status)) answeredArguments += 1;
      }

      const argument = {
        key: `A${argumentsOut.length + 1}`,
        side: speech.side,
        type: flags.concession
          ? 'concession'
          : flags.impact
            ? 'impact'
            : flags.warrant
              ? 'warrant'
              : 'claim',
        label: claim.split(/\s+/).slice(0, 9).join(' '),
        claim,
        warrant: warrantSentence ? warrantSentence : 'Not stated',
        evidence: evidenceSentence ? evidenceSentence : 'None offered',
        impact: impactSentence ? impactSentence : flags.impact ? claim : 'Not stated',
        assumptions: flags.assumption ? 'The statement is presented as self-evident in the text.' : '',
        introducedSpeech: speech.position,
        latestSpeech: speech.position,
        status: 'introduced',
        statusConfidence: 'low',
        statusReason: 'Demo heuristic: introduced here. No later speech has been matched to it yet.',
        matchConfidence: 'low',
        appearances: [{ speech: speech.position, kind: 'introduced', passage: claim }],
        method: 'introduced',
      };
      argumentsOut.push(argument);
      localArguments.push(argument);

      if (responseTo) {
        relationships.push({
          fromKey: argument.key,
          toKey: responseTo.key,
          relation: flags.turn ? 'turns' : flags.concession ? 'responds_to' : 'responds_to',
          explanation: `Demo heuristic matched this ${speech.side} statement to the earlier ${responseTo.side} argument by wording overlap. It is marked ${argument.type}.`,
          confidence: 'low',
        });
      }
    }

    for (const argument of localArguments) argumentForSpeech.set(`${speech.position}:${argument.key}`, argument);

    if (speech.side && localArguments.length === 0) {
      const fallback = sentences[0];
      if (fallback) {
        const argument = {
          key: `A${argumentsOut.length + 1}`,
          side: speech.side,
          type: 'claim',
          label: fallback.split(/\s+/).slice(0, 9).join(' '),
          claim: fallback,
          warrant: 'Not stated',
          evidence: 'None offered',
          impact: 'Not stated',
          assumptions: '',
          introducedSpeech: speech.position,
          latestSpeech: speech.position,
          status: 'introduced',
          statusConfidence: 'low',
          statusReason: 'Demo heuristic: the speech has no sentence long enough to analyse in depth.',
          matchConfidence: 'low',
          appearances: [{ speech: speech.position, kind: 'introduced', passage: fallback }],
          method: 'introduced',
        };
        argumentsOut.push(argument);
        localArguments.push(argument);
      }
    }

    // Evidence records for this speech, attached to the argument introduced here.
    const owner = localArguments[0] ?? null;
    for (const sentence of sentences) {
      if (!classify(sentence).evidence) continue;
      const citation = citationOf(sentence);
      const causal = /\b(caus\w*|leads? to|results? in|because)\b/i.test(sentence);
      const assessment = citation
        ? causal
          ? 'correlation_not_causation'
          : 'missing_context'
        : 'unsupported_claim';
      evidenceOut.push({
        speech: speech.position,
        passage: sentence,
        citation: citation || 'None',
        author: citation ? citation : 'Not stated',
        publishedAt: citation && /\b(19|20)\d{2}\b/.test(citation + sentence) ? (sentence.match(/\b(19|20)\d{2}\b/) || [''])[0] : 'Not stated',
        supportedClaim: owner ? owner.claim : 'Not stated',
        argumentKey: owner?.key ?? null,
        speakerUsage: 'Used as support in this speech.',
        supportsClaim: assessment === 'supported',
        assessment,
        explanation: citation
          ? 'Demo heuristic: a source is named, but no source was retrieved, so its scope and accuracy were not verified.'
          : 'Demo heuristic: the sentence offers a statistic or authority without naming a source, so the claim is unsupported in the text.',
        confidence: 'low',
      });
    }
  }

  // Statuses for arguments no later speech engaged.
  const lastPosition = Math.max(...speeches.map((speech) => speech.position), 0);
  for (const argument of argumentsOut) {
    if (argument.method !== 'introduced') continue;
    if (argument.latestSpeech < lastPosition) {
      argument.status = 'unclear';
      argument.statusConfidence = 'low';
      argument.statusReason =
        'Demo heuristic: this argument does not reappear in the recorded speeches. A drop cannot be confirmed without the opponent\'s full case, so it is marked unclear.';
    }
  }

  // Findings derived only from what the text is missing.
  const pushFinding = (finding) => {
    if (findingsOut.length >= MAX_FINDINGS) return;
    if (findingsOut.some((entry) => entry.title === finding.title)) return;
    findingsOut.push(finding);
  };

  for (const argument of argumentsOut) {
    const missingWarrant = !argument.warrant || argument.warrant === 'Not stated';
    const missingEvidence = !argument.evidence || argument.evidence === 'None offered';

    if (missingWarrant) {
      pushFinding({
        category: 'moderate',
        weaknessType: 'logical_weakness',
        title: `No warrant connects the evidence to the claim: ${argument.label}`,
        passage: argument.claim,
        explanation:
          'The speech states the claim without explaining why the support it offers actually establishes it. The reasoning step is left for the judge to invent.',
        whyItMatters: 'An opponent can answer the evidence without ever engaging the conclusion you need.',
        suggestion: 'Add one sentence that states the mechanism: because X causes Y, the evidence implies the claim.',
        confidence: 'medium',
        argumentKey: argument.key,
      });
    }

    if (missingEvidence) {
      pushFinding({
        category: 'moderate',
        weaknessType: 'missing_evidence',
        title: `Assertion without support: ${argument.label}`,
        passage: argument.claim,
        explanation: 'The claim is presented without a source, statistic or example in this speech.',
        whyItMatters: 'Unsupported claims are cheap for the other side to dismiss and hard for a judge to weigh.',
        suggestion: 'Attach a dated, named source or a concrete example that a listener can check.',
        confidence: 'medium',
        argumentKey: argument.key,
      });
    }

    if (argument.assumptions) {
      pushFinding({
        category: 'minor',
        weaknessType: 'logical_weakness',
        title: `Unstated assumption: ${argument.label}`,
        passage: argument.claim,
        explanation: 'The wording treats a debatable premise as obvious, so the assumption is never defended.',
        whyItMatters: 'The other side can concede everything you said and still reject the assumption underneath it.',
        suggestion: 'Name the assumption and defend it explicitly before extending the argument.',
        confidence: 'medium',
        argumentKey: argument.key,
      });
    }

    if (!missingWarrant && !missingEvidence && findingsOut.filter((entry) => entry.category === 'strength').length < 4) {
      pushFinding({
        category: 'strength',
        weaknessType: 'structural_weakness',
        title: `Complete argument structure: ${argument.label}`,
        passage: argument.claim,
        explanation: 'This argument carries a claim, a reasoning step and supporting material in the recorded speech.',
        whyItMatters: 'This is the structure to reuse when you extend the argument into later speeches.',
        suggestion: 'Keep this shape and make the comparison to the other side explicit.',
        confidence: 'medium',
        argumentKey: argument.key,
      });
    }

    if (['unclear', 'partially_answered', 'still_contested'].includes(argument.status)) {
      pushFinding({
        category: 'moderate',
        weaknessType: 'weighing_weakness',
        title: `Unresolved clash: ${argument.label}`,
        passage: argument.claim,
        explanation:
          'The recorded speeches do not show a clear answer or a clear extension, so this argument is left hanging in the round.',
        whyItMatters: 'A judge cannot vote on an argument that was neither answered nor carried through.',
        suggestion: 'In the next speech, either extend it with new weighing or answer it directly.',
        confidence: 'low',
        argumentKey: argument.key,
      });
    }
  }

  const metrics = {
    arguments: argumentsOut.length,
    speeches: speeches.length,
    warrantRatio: argumentsOut.length ? argumentsOut.filter((entry) => entry.warrant !== 'Not stated').length / argumentsOut.length : 0,
    evidenceRatio: argumentsOut.length ? argumentsOut.filter((entry) => entry.evidence !== 'None offered').length / argumentsOut.length : 0,
    impactRatio: argumentsOut.length ? argumentsOut.filter((entry) => entry.impact !== 'Not stated').length / argumentsOut.length : 0,
    responseRatio: argumentsOut.length ? answeredArguments / argumentsOut.length : 0,
    structureRatio: Math.min(1, argumentsOut.length / Math.max(1, speeches.length)),
    firstClaim,
  };

  const sideSummary = (sideId) => {
    const owned = argumentsOut.filter((argument) => argument.side === sideId);
    const answered = owned.filter((argument) => ['answered', 'conceded', 'turned'].includes(argument.status)).length;
    return owned.length
      ? `${owned.length} argument${owned.length === 1 ? '' : 's'} recorded; ${answered} clearly engaged by the other side. Demo heuristic only.`
      : 'No arguments were identified for this side in the recorded speeches.';
  };

  const analysis = {
    summary: {
      overview: `Demo heuristic analysed ${speeches.length} speech${
        speeches.length === 1 ? '' : 'es'
      } and reconstructed ${argumentsOut.length} argument${
        argumentsOut.length === 1 ? '' : 's'
      }. No AI provider is configured, so this report is generated from the speech text with fixed rules and cannot judge meaning the way a model would.`,
      developmentSummary: `${answeredArguments} argument${
        answeredArguments === 1 ? ' was' : 's were'
      } matched to a later opposing statement by wording overlap. ${
        argumentsOut.filter((argument) => argument.status === 'unclear').length
      } could not be resolved from the recorded speeches.`,
      clashSummary: 'Clash is inferred from repeated distinctive wording. Verify each match before relying on it.',
      pro: sideSummary(formatSpec.sides[0].id),
      con: sideSummary(formatSpec.sides[1]?.id ?? formatSpec.sides[0].id),
      remainingClash: argumentsOut
        .filter((argument) => ['unclear', 'partially_answered', 'still_contested'].includes(argument.status))
        .slice(0, 5)
        .map((argument) => argument.label),
      strategicNotes: [
        'This is a demo heuristic. It cannot follow meaning across paraphrases the way a language model can.',
        'No winner is declared. The report gives observations only.',
      ],
    },
    arguments: argumentsOut,
    relationships: relationships.map((relationship) => ({
      ...relationship,
      fromKey:
        relationship.fromKey ??
        argumentsOut.find((argument) => argument.appearances.some((appearance) => appearance.kind === 'answered'))?.key ??
        argumentsOut[0]?.key,
    })),
    evidence: evidenceOut.slice(0, 30),
    findings: findingsOut,
    skills: skillRatings(formatSpec, metrics),
  };

  return analysis;
}

const MAX_FINDINGS = 24;
