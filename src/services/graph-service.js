/**
 * Builds the interactive round graph from stored analysis rows.
 *
 * Nothing here is sample data: every node comes from a persisted argument or
 * evidence record, and every edge comes from a stored relationship, from the
 * evidence-to-argument link, or from an argument's own appearance in a later
 * speech. The frontend only renders what this returns.
 */

const STATUS_TONE = {
  introduced: 'neutral',
  answered: 'positive',
  partially_answered: 'warning',
  extended: 'positive',
  dropped: 'critical',
  conceded: 'warning',
  turned: 'critical',
  still_contested: 'warning',
  unclear: 'muted',
};

export function buildRoundGraph(detail) {
  const { arguments: args = [], relationships = [], evidence = [], findings = [], speeches = [] } = detail;
  const speechById = new Map(speeches.map((speech) => [speech.id, speech]));
  const argumentById = new Map(args.map((argument) => [argument.id, argument]));

  const findingByArgument = new Map();
  for (const finding of findings) {
    if (!finding.argumentId) continue;
    if (!findingByArgument.has(finding.argumentId)) findingByArgument.set(finding.argumentId, []);
    findingByArgument.get(finding.argumentId).push(finding.id);
  }

  const nodes = args.map((argument) => {
    const speech = speechById.get(argument.introducedSpeechId);
    return {
      id: `arg-${argument.id}`,
      argumentId: argument.id,
      kind: 'argument',
      type: argument.type,
      label: argument.label,
      excerpt: argument.claim,
      detail: argument.warrant && argument.warrant !== 'Not stated' ? argument.warrant : argument.claim,
      side: argument.side,
      status: argument.status,
      statusTone: STATUS_TONE[argument.status] ?? 'muted',
      origin: argument.origin,
      humanEdited: argument.humanEdited,
      speechPosition: speech?.position ?? null,
      speechId: speech?.id ?? null,
      speechType: speech?.speechType ?? null,
      findingIds: findingByArgument.get(argument.id) ?? [],
    };
  });

  for (const record of evidence) {
    const speech = speechById.get(record.speechId);
    nodes.push({
      id: `ev-${record.id}`,
      evidenceId: record.id,
      kind: 'evidence',
      type: 'evidence',
      label: record.citation && record.citation !== 'None' ? record.citation : 'Uncited evidence',
      excerpt: record.passage,
      detail: record.explanation,
      side: speech?.side ?? null,
      assessment: record.assessment,
      speechPosition: speech?.position ?? speech?.position ?? record.speechPosition ?? null,
      speechId: record.speechId,
      speechType: speech?.speechType ?? null,
      findingIds: [],
    });
  }

  const edges = [];
  const seen = new Set();

  for (const relationship of relationships) {
    const key = `arg-${relationship.sourceId}|arg-${relationship.targetId}|${relationship.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `rel-${relationship.id}`,
      relationshipId: relationship.id,
      from: `arg-${relationship.sourceId}`,
      to: `arg-${relationship.targetId}`,
      relation: relationship.relation,
      explanation: relationship.explanation,
      origin: relationship.origin,
      humanEdited: relationship.humanEdited,
    });
  }

  for (const record of evidence) {
    if (!record.argumentId || !argumentById.has(record.argumentId)) continue;
    const key = `ev-${record.id}|arg-${record.argumentId}|supports`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `ev-link-${record.id}`,
      from: `ev-${record.id}`,
      to: `arg-${record.argumentId}`,
      relation: 'supports',
      explanation: record.explanation,
      origin: record.origin ?? 'ai',
      humanEdited: false,
      derived: true,
    });
  }

  const unsubstantiated = args.filter((argument) => argument.origin === 'heuristic').length;

  return {
    nodes,
    edges,
    meta: {
      arguments: args.length,
      evidence: evidence.length,
      relationships: relationships.length,
      edges: edges.length,
      humanEdits: args.filter((argument) => argument.humanEdited).length,
      heuristic: unsubstantiated,
      statuses: args.reduce((accumulator, argument) => {
        accumulator[argument.status] = (accumulator[argument.status] ?? 0) + 1;
        return accumulator;
      }, {}),
    },
  };
}

/**
 * Timeline rows: one entry per speech, listing what the analysis recorded in
 * that speech. Used by the round workspace timeline view.
 */
export function buildRoundTimeline(detail) {
  const { speeches = [], arguments: args = [], evidence = [], findings = [] } = detail;

  return speeches.map((speech) => {
    const introduced = args.filter((argument) => argument.introducedSpeechId === speech.id);
    const touched = args.filter(
      (argument) => argument.introducedSpeechId !== speech.id && argument.latestSpeechId === speech.id
    );
    const speechEvidence = evidence.filter((record) => record.speechId === speech.id);
    const speechFindings = findings.filter((finding) => {
      if (!finding.argumentId) return false;
      const argument = args.find((entry) => entry.id === finding.argumentId);
      return argument?.latestSpeechId === speech.id || argument?.introducedSpeechId === speech.id;
    });

    return {
      speech: {
        id: speech.id,
        position: speech.position,
        side: speech.side,
        speechType: speech.speechType,
        speakerName: speech.speakerName,
        wordCount: speech.wordCount,
      },
      introduced: introduced.map((argument) => ({
        id: argument.id,
        label: argument.label,
        type: argument.type,
        status: argument.status,
      })),
      touched: touched.map((argument) => ({
        id: argument.id,
        label: argument.label,
        status: argument.status,
      })),
      evidence: speechEvidence.map((record) => ({
        id: record.id,
        citation: record.citation,
        assessment: record.assessment,
      })),
      findings: speechFindings.map((finding) => ({ id: finding.id, title: finding.title, category: finding.category })),
    };
  });
}
