import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/test-server.js';
import { normalizeRoundAnalysis } from '../src/services/ai/round-normalize.js';
import { getFormat } from '../src/services/formats.js';

let ctx;
let alice;
let bob;
const state = {};

const RESOLUTION = 'Resolved: The United States should substantially increase funding for public transit.';

const PRO_CASE = `Expanding transit reduces congestion because commuters switch modes when service is frequent. According to a 2024 study of 14 cities, each new rail mile cut vehicle hours by 3 percent. Congestion costs the economy 120 billion dollars annually, so even a modest reduction produces a large economic impact.`;

const CON_CASE = `Transit funding does not reduce congestion because the money is redirected from road maintenance. According to a 2023 report, cities that expanded rail saw vehicle hours rise by 2 percent. The plan also creates a budget shortfall that harms other services, which means the economic impact is negative.`;

const CON_REBUTTAL = `The pro case claims transit funding reduces congestion because commuters switch modes. That evidence is a 2024 study of 14 cities, but the same study found vehicle hours rose in three of them. Their congestion cost figure of 120 billion dollars does not establish that rail spending captures any of it.`;

const PRO_SUMMARY = `Extend the congestion argument: transit funding reduces congestion because commuters switch modes when service is frequent, and the 2024 study of 14 cities supports the mechanism. We concede the road maintenance point is a real tradeoff, but the economic impact of congestion still outweighs it.`;

async function register(client, email) {
  await client.get('/api/meta');
  return client.post('/api/auth/register', { email, password: 'StrongPass123', displayName: email.split('@')[0] });
}

before(async () => {
  ctx = await startTestServer();
  const stamp = Date.now();
  alice = ctx.client();
  bob = ctx.client();
  const a = await register(alice, `rounds.alice.${stamp}@example.com`);
  const b = await register(bob, `rounds.bob.${stamp}@example.com`);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  state.aliceId = a.data.user.id;
});

after(async () => {
  await ctx.close();
});

test('meta exposes round structures that differ by format', async () => {
  const response = await alice.get('/api/meta');
  assert.equal(response.status, 200);
  assert.equal(response.data.formats.length, 5);
  const pf = response.data.formats.find((format) => format.id === 'pf');
  const ld = response.data.formats.find((format) => format.id === 'ld');
  const policy = response.data.formats.find((format) => format.id === 'policy');
  const congress = response.data.formats.find((format) => format.id === 'congress');
  assert.equal(pf.roundStructure.slots.length, 8);
  assert.equal(ld.roundStructure.slots.length, 5);
  assert.equal(policy.roundStructure.slots.length, 8);
  assert.equal(congress.roundStructure.flexibleOrder, true);
  assert.notEqual(
    pf.roundStructure.slots.map((slot) => slot.role).join(','),
    ld.roundStructure.slots.map((slot) => slot.role).join(',')
  );
  assert.ok(response.data.argumentStatuses.length >= 8);
  assert.ok(response.data.evidenceAssessments.length === 6);
  assert.equal(response.data.evidenceVerificationAvailable, false);
});

test('a round can be created, filled with ordered speeches and reopened', async () => {
  const created = await alice.post('/api/rounds', {
    title: 'Transit round vs. Central',
    format: 'pf',
    resolution: RESOLUTION,
    side: 'pro',
    notes: 'Practice round.',
    participants: [
      { name: 'Alice', team: 'North', side: 'pro' },
      { name: 'Ravi', team: 'Central', side: 'con' },
    ],
    speeches: [],
  });
  assert.equal(created.status, 201);
  state.roundId = created.data.round.id;
  assert.equal(created.data.round.format, 'pf');
  assert.equal(created.data.round.status, 'draft');

  const first = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'pro',
    speechType: 'Case / Constructive',
    speakerName: 'Alice',
    content: PRO_CASE,
    position: 1,
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.speech.position, 1);

  const second = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'con',
    speechType: 'Case / Constructive',
    speakerName: 'Ravi',
    content: CON_CASE,
    position: 2,
  });
  assert.equal(second.status, 201);
  assert.equal(second.data.speech.position, 2);

  const third = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'con',
    speechType: 'Rebuttal',
    speakerName: 'Ravi',
    content: CON_REBUTTAL,
    position: 3,
  });
  assert.equal(third.status, 201);

  const fourth = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'pro',
    speechType: 'Summary',
    speakerName: 'Alice',
    content: PRO_SUMMARY,
    position: 4,
  });
  assert.equal(fourth.status, 201);

  state.speechIds = [first, second, third, fourth].map((entry) => entry.data.speech.id);

  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.round.speechCount, 4);
  assert.equal(detail.data.speeches.length, 4);
  assert.deepEqual(detail.data.speeches.map((speech) => speech.position), [1, 2, 3, 4]);
  assert.equal(detail.data.speeches[2].speechType, 'Rebuttal');
  assert.equal(detail.data.participants.length, 2);
  assert.equal(detail.data.analysis, null);
  assert.equal(detail.data.roundStructure.slots.length, 8);

  // Inserting in the middle renumbers the later speeches.
  const inserted = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'pro',
    speechType: 'Rebuttal',
    content: 'We answer the road maintenance point directly in this rebuttal speech, because the tradeoff is small.',
    position: 3,
  });
  assert.equal(inserted.status, 201);
  const renumbered = await alice.get(`/api/rounds/${state.roundId}`);
  assert.deepEqual(
    renumbered.data.speeches.map((speech) => speech.position),
    [1, 2, 3, 4, 5]
  );

  const removed = await alice.delete(`/api/rounds/${state.roundId}/speeches/${inserted.data.speech.id}`);
  assert.equal(removed.status, 200);
  const afterRemoval = await alice.get(`/api/rounds/${state.roundId}`);
  assert.equal(afterRemoval.data.speeches.length, 4);
});

test('round analysis persists arguments, lineage, evidence, findings and skills', async () => {
  const response = await alice.post(`/api/rounds/${state.roundId}/analyze`, {});
  assert.equal(response.status, 201, JSON.stringify(response.data));
  assert.equal(response.data.mode, 'demo');
  assert.equal(response.data.isDemo, true);
  assert.ok(response.data.demoReason);
  assert.ok(response.data.counts.arguments >= 2);
  assert.ok(response.data.counts.findings >= 1);

  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.round.status, 'analyzed');
  assert.ok(detail.data.analysis);
  assert.equal(detail.data.analysis.mode, 'demo');
  assert.ok(detail.data.analysis.report.summary.overview.length > 20);
  assert.ok(detail.data.arguments.length >= 2);
  assert.ok(detail.data.findings.length >= 1);
  assert.ok(detail.data.skills.length >= 1);
  assert.ok(detail.data.evidence.length >= 1);

  const statuses = new Set(detail.data.arguments.map((argument) => argument.status));
  for (const status of statuses) {
    assert.ok(
      ['introduced', 'answered', 'partially_answered', 'extended', 'dropped', 'conceded', 'turned', 'still_contested', 'unclear'].includes(
        status
      ),
      `unexpected status ${status}`
    );
  }
  // The heuristic must never invent a drop from a transcript alone.
  assert.equal(statuses.has('dropped'), false);

  for (const argument of detail.data.arguments) {
    assert.ok(argument.introducedSpeechPosition >= 1);
    assert.ok(argument.label.length > 0);
  }

  // Evidence rows carry an assessment and no fabricated verification.
  for (const record of detail.data.evidence) {
    assert.ok(record.passage.length > 10);
    assert.equal(record.verification, null);
    assert.ok(
      ['supported', 'unsupported_claim', 'misrepresented_evidence', 'potentially_inaccurate', 'correlation_not_causation', 'missing_context'].includes(
        record.assessment
      )
    );
  }

  // Every stored passage must still exist in a recorded speech.
  const speechText = detail.data.speeches.map((speech) => speech.content).join(' ');
  for (const record of detail.data.evidence) {
    assert.ok(speechText.includes(record.passage.slice(0, 40)));
  }

  const graph = await alice.get(`/api/rounds/${state.roundId}/graph`);
  assert.equal(graph.status, 200);
  const argumentNodeIds = new Set(
    graph.data.graph.nodes.filter((node) => node.kind === 'argument').map((node) => node.id)
  );
  assert.ok(argumentNodeIds.size >= 2);
  assert.ok(graph.data.graph.nodes.some((node) => node.kind === 'evidence'));
  assert.ok(
    graph.data.graph.edges.length >= 1,
    'the graph is built from stored relationships or evidence links, not left edgeless'
  );
  assert.ok(
    graph.data.graph.edges.some((edge) => edge.relationshipId),
    'at least one edge is a real argument-to-argument relationship, not only an evidence link'
  );
  for (const edge of graph.data.graph.edges) {
    assert.ok(
      argumentNodeIds.has(edge.from) || argumentNodeIds.has(edge.to),
      'every edge touches an argument node'
    );
  }

  const timeline = await alice.get(`/api/rounds/${state.roundId}/timeline`);
  assert.equal(timeline.status, 200);
  assert.equal(timeline.data.timeline.length, 4);
  assert.ok(timeline.data.timeline.some((entry) => entry.introduced.length > 0));

  const skills = await ctx.db.all(
    'SELECT * FROM skill_assessments WHERE round_id = ? AND user_id = ?',
    state.roundId,
    state.aliceId
  );
  assert.ok(skills.length >= 1);
  for (const skill of skills) {
    assert.ok(skill.level >= 1 && skill.level <= 5);
    assert.ok(skill.explanation.length > 5);
    assert.ok(skill.recommendation.length > 5);
  }
});

test('argument history, manual status corrections and annotations are preserved', async () => {
  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  const argument = detail.data.arguments[0];
  state.argumentId = argument.id;

  const history = await alice.get(`/api/rounds/${state.roundId}/arguments/${argument.id}`);
  assert.equal(history.status, 200);
  assert.ok(history.data.history.length >= 1);
  assert.equal(history.data.history[0].status, 'introduced');

  const updated = await alice.put(`/api/rounds/${state.roundId}/arguments/${argument.id}`, {
    status: 'conceded',
    note: 'The other side granted this point in crossfire.',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.argument.status, 'conceded');
  assert.equal(updated.data.argument.humanEdited, true);

  const annotations = await alice.get(`/api/rounds/${state.roundId}`);
  assert.ok(annotations.data.annotations.length >= 1);
  const annotation = annotations.data.annotations.find((entry) => entry.targetType === 'round_argument');
  assert.ok(annotation);
  assert.ok(annotation.aiValue);
  assert.ok(annotation.humanValue.includes('conceded'));

  const historyAfter = await alice.get(`/api/rounds/${state.roundId}/arguments/${argument.id}`);
  assert.ok(historyAfter.data.history.some((entry) => entry.status === 'conceded' && entry.origin === 'human'));

  // A re-analysis replaces AI rows but must keep the human correction.
  const reanalyzed = await alice.post(`/api/rounds/${state.roundId}/analyze`, {});
  assert.equal(reanalyzed.status, 201);
  const after = await alice.get(`/api/rounds/${state.roundId}`);
  const preserved = after.data.arguments.find((entry) => entry.id === argument.id);
  assert.ok(preserved, 'the human-edited argument survives re-analysis');
  assert.equal(preserved.status, 'conceded');
  assert.equal(preserved.humanEdited, true);

  const invalid = await alice.put(`/api/rounds/${state.roundId}/arguments/${argument.id}`, { status: 'invented' });
  assert.equal(invalid.status, 400);
});

test('graph relationships can be added, edited and removed, and survive reload', async () => {
  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  assert.ok(detail.data.arguments.length >= 2);
  const [first, second] = detail.data.arguments;

  const created = await alice.post(`/api/rounds/${state.roundId}/relationships`, {
    sourceId: second.id,
    targetId: first.id,
    relation: 'challenges',
    explanation: 'Manual link added during review.',
  });
  assert.equal(created.status, 201);
  state.relationshipId = created.data.id;

  const duplicate = await alice.post(`/api/rounds/${state.roundId}/relationships`, {
    sourceId: second.id,
    targetId: first.id,
    relation: 'challenges',
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.created, false);

  const invalid = await alice.post(`/api/rounds/${state.roundId}/relationships`, {
    sourceId: first.id,
    targetId: first.id,
    relation: 'supports',
  });
  assert.equal(invalid.status, 400);

  const edited = await alice.put(`/api/rounds/${state.roundId}/relationships/${state.relationshipId}`, {
    relation: 'turns',
    explanation: 'Corrected relation.',
  });
  assert.equal(edited.status, 200);

  const reloaded = await alice.get(`/api/rounds/${state.roundId}`);
  const stored = reloaded.data.relationships.find((entry) => entry.id === state.relationshipId);
  assert.equal(stored.relation, 'turns');
  assert.equal(stored.humanEdited, true);
  assert.ok(reloaded.data.graph.edges.some((edge) => edge.relationshipId === state.relationshipId));

  const removed = await alice.delete(`/api/rounds/${state.roundId}/relationships/${state.relationshipId}`);
  assert.equal(removed.status, 200);
  const after = await alice.get(`/api/rounds/${state.roundId}`);
  assert.equal(after.data.relationships.some((entry) => entry.id === state.relationshipId), false);
});

test('evidence verification refuses to claim a source it never retrieved', async () => {
  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  assert.ok(detail.data.evidence.length >= 1);
  const evidence = detail.data.evidence[0];

  const verified = await alice.post(`/api/evidence/${evidence.id}/verify`, {});
  assert.equal(verified.status, 200);
  assert.equal(verified.data.verification.status, 'unavailable');
  assert.equal(verified.data.verification.provider, null);
  assert.match(verified.data.verification.message, /not been checked/i);

  const listing = await alice.get(`/api/rounds/${state.roundId}/evidence`);
  assert.equal(listing.status, 200);
  assert.equal(listing.data.verificationAvailable, false);
  const stored = listing.data.evidence.find((entry) => entry.id === evidence.id);
  assert.equal(stored.verification.status, 'unavailable');
  assert.equal(stored.verification.sourceUrl, null);

  const foreign = await bob.post(`/api/evidence/${evidence.id}/verify`, {});
  assert.equal(foreign.status, 404);
});

test('finding feedback is stored separately and can be changed', async () => {
  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  const finding = detail.data.findings[0];

  const created = await alice.post('/api/feedback', {
    targetType: 'round_finding',
    targetId: finding.id,
    rating: 'inaccurate',
    comment: 'The passage is a summary of our case, not a dropped argument.',
    suggestedCorrection: 'Mark this as partially answered.',
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.feedback.rating, 'inaccurate');

  const changed = await alice.post('/api/feedback', {
    targetType: 'round_finding',
    targetId: finding.id,
    rating: 'partially_accurate',
    comment: 'Re-read the summary speech.',
  });
  assert.equal(changed.status, 201);
  assert.equal(changed.data.feedback.rating, 'partially_accurate');

  const listed = await alice.get(`/api/feedback?roundId=${state.roundId}`);
  assert.equal(listed.status, 200);
  const rows = listed.data.feedback.filter((entry) => entry.targetId === finding.id);
  assert.equal(rows.length, 1, 'feedback upserts instead of duplicating');
  assert.equal(rows[0].rating, 'partially_accurate');

  // The original AI finding is untouched.
  const after = await alice.get(`/api/rounds/${state.roundId}`);
  const unchanged = after.data.findings.find((entry) => entry.id === finding.id);
  assert.equal(unchanged.title, finding.title);
  assert.equal(unchanged.explanation, finding.explanation);

  const foreign = await bob.post('/api/feedback', {
    targetType: 'round_finding',
    targetId: finding.id,
    rating: 'accurate',
  });
  assert.equal(foreign.status, 404);
});

test('benchmark examples are private by default and never trained on', async () => {
  const created = await alice.post('/api/benchmarks', {
    title: 'Transit pro constructive',
    format: 'pf',
    speechText: PRO_CASE,
    speechType: 'Case / Constructive',
    resolution: RESOLUTION,
    side: 'pro',
    expected: { claims: ['Transit reduces congestion'] },
    notes: 'Reviewed by a coach.',
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.benchmark.isShared, false);
  state.benchmarkId = created.data.benchmark.id;

  const listed = await alice.get('/api/benchmarks');
  assert.ok(listed.data.benchmarks.some((entry) => entry.id === state.benchmarkId));

  const bobList = await bob.get('/api/benchmarks');
  assert.equal(bobList.data.benchmarks.length, 0);

  const bobUpdate = await bob.put(`/api/benchmarks/${state.benchmarkId}`, { title: 'Hijacked' });
  assert.equal(bobUpdate.status, 404);
  const bobDelete = await bob.delete(`/api/benchmarks/${state.benchmarkId}`);
  assert.equal(bobDelete.status, 404);

  const invalid = await alice.post('/api/benchmarks', {
    title: 'Bad benchmark',
    format: 'pf',
    speechText: 'Too short.',
  });
  assert.equal(invalid.status, 400);
});

test('progress requires history before showing a trend', async () => {
  const first = await alice.get('/api/progress');
  assert.equal(first.status, 200);
  assert.ok(first.data.totals.assessments >= 1);
  assert.equal(first.data.note.includes('two assessments'), true);

  // The round has been analysed twice, so round-sourced skills have history.
  const roundSkills = first.data.skills.filter((skill) => skill.assessments.some((a) => a.sourceType === 'round'));
  assert.ok(roundSkills.length >= 1, 'round-sourced assessments exist');
  assert.ok(roundSkills.length >= 1);
  for (const skill of roundSkills) {
    if (skill.count >= 2) {
      assert.equal(skill.insufficientData, false);
      assert.ok(skill.latest >= 1 && skill.latest <= 5);
    }
  }

  const filtered = await alice.get('/api/progress?format=ld');
  assert.equal(filtered.status, 200);
  assert.equal(filtered.data.skills.length, 0, 'a format with no history reports nothing');

  const bobProgress = await bob.get('/api/progress');
  assert.equal(bobProgress.data.totals.assessments, 0);
  assert.equal(bobProgress.data.insufficientData, true);
});

test('rounds are isolated between accounts', async () => {
  const read = await bob.get(`/api/rounds/${state.roundId}`);
  assert.equal(read.status, 404);

  const write = await bob.put(`/api/rounds/${state.roundId}`, { title: 'Hijacked' });
  assert.equal(write.status, 404);

  const speech = await bob.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'pro',
    speechType: 'Case / Constructive',
    content: 'This should never be accepted because the round belongs to someone else.',
  });
  assert.equal(speech.status, 404);

  const analyze = await bob.post(`/api/rounds/${state.roundId}/analyze`, {});
  assert.equal(analyze.status, 404);

  const argument = await bob.put(`/api/rounds/${state.roundId}/arguments/${state.argumentId}`, { status: 'dropped' });
  assert.equal(argument.status, 404);

  const relationship = await bob.post(`/api/rounds/${state.roundId}/relationships`, {
    sourceId: 1,
    targetId: 2,
    relation: 'supports',
  });
  assert.equal(relationship.status, 404);

  const evidenceList = await bob.get(`/api/rounds/${state.roundId}/evidence`);
  assert.equal(evidenceList.status, 404);

  const deleteRound = await bob.delete(`/api/rounds/${state.roundId}`);
  assert.equal(deleteRound.status, 404);

  const bobRounds = await bob.get('/api/rounds');
  assert.equal(bobRounds.data.rounds.length, 0);
});

test('round input is validated', async () => {
  const badFormat = await alice.post('/api/rounds', {
    title: 'Bad',
    format: 'parliamentary',
    resolution: 'Resolved: Something.',
  });
  assert.equal(badFormat.status, 400);

  const badSide = await alice.post('/api/rounds', {
    title: 'Bad side',
    format: 'pf',
    resolution: 'Resolved: Something.',
    side: 'affirmative',
  });
  assert.equal(badSide.status, 400);

  const badSpeechType = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'pro',
    speechType: 'Affirmative Constructive (AC)',
    content: 'A valid length speech body that should still be rejected for the wrong format.',
  });
  assert.equal(badSpeechType.status, 400);

  const tooLong = await alice.post(`/api/rounds/${state.roundId}/speeches`, {
    side: 'pro',
    speechType: 'Rebuttal',
    content: 'x'.repeat(128001),
  });
  assert.equal(tooLong.status, 400);

  const anonymous = ctx.client();
  await anonymous.get('/api/meta');
  const hidden = await anonymous.get(`/api/rounds/${state.roundId}`);
  assert.equal(hidden.status, 401);
});

test('every debate format can create a round with its own speech structure', async () => {
  const payloads = [
    { format: 'ld', side: 'affirmative', slot: 0 },
    { format: 'policy', side: 'affirmative', slot: 0 },
    { format: 'congress', side: 'affirmative', slot: null },
    { format: 'wsd', side: 'proposition', slot: 2 },
  ];

  for (const payload of payloads) {
    const response = await alice.post('/api/rounds', {
      title: `${payload.format} test round`,
      format: payload.format,
      resolution: 'This is a test resolution for the format structure check.',
      side: payload.side,
      speeches: [],
    });
    assert.equal(response.status, 201, `${payload.format} round created`);
    const structure = response.data.roundStructure;
    if (payload.format === 'congress') assert.equal(structure.flexibleOrder, true);
    else assert.ok(structure.slots.length >= 5);

    const detail = await alice.get(`/api/rounds/${response.data.round.id}`);
    assert.equal(detail.data.roundStructure.slots.length, structure.slots.length);
  }
});

test('the normaliser rejects invented relationships and unverifiable quotations', () => {
  const formatSpec = getFormat('pf');
  const speeches = [
    { id: 1, position: 1, side: 'pro', speechType: 'Case / Constructive', content: PRO_CASE },
    { id: 2, position: 2, side: 'con', speechType: 'Case / Constructive', content: CON_CASE },
    { id: 3, position: 3, side: 'con', speechType: 'Rebuttal', content: CON_REBUTTAL },
  ];

  assert.throws(
    () => normalizeRoundAnalysis({ arguments: [] }, { formatSpec, speeches }),
    /did not identify any arguments/
  );

  const analysis = normalizeRoundAnalysis(
    {
      summary: { overview: 'A round.' },
      arguments: [
        {
          key: 'A1',
          side: 'pro',
          type: 'claim',
          label: 'Transit cuts congestion',
          claim: 'Transit funding reduces congestion because commuters switch modes.',
          introducedSpeech: 1,
          latestSpeech: 3,
          status: 'dropped',
          statusConfidence: 'high',
          statusReason: 'Never answered.',
          appearances: [
            { speech: 1, kind: 'introduced', passage: 'Expanding transit reduces congestion because commuters switch modes' },
            { speech: 3, kind: 'answered', passage: 'This sentence never appeared in the speech at all' },
          ],
        },
        {
          key: 'A2',
          side: 'con',
          type: 'rebuttal',
          label: 'Evidence dispute',
          claim: 'The study does not support the claim.',
          introducedSpeech: 3,
          status: 'answered',
          statusConfidence: 'high',
        },
      ],
      relationships: [
        { from: 'A2', to: 'A1', relation: 'responds_to', explanation: 'Direct answer.' },
        { from: 'A2', to: 'A9', relation: 'supports', explanation: 'Invented key.' },
      ],
      evidence: [
        { speech: 3, passage: 'This quotation was invented by the model', assessment: 'supported' },
      ],
      findings: [
        { category: 'critical', weaknessType: 'logical_weakness', title: 'Invented quote', passage: 'Not in the text', explanation: 'x' },
      ],
    },
    { formatSpec, speeches }
  );

  assert.equal(analysis.arguments.length, 2);
  assert.equal(analysis.relationships.length, 1, 'unknown node keys are dropped');
  assert.equal(analysis.evidence.length, 0, 'evidence attributed to no real passage is dropped');
  const invented = analysis.findings.find((finding) => finding.title === 'Invented quote');
  assert.equal(invented.passage, '', 'unverifiable quotation is removed');
  assert.equal(invented.confidence, 'low');
  const answer = analysis.arguments[0].appearances.find((entry) => entry.kind === 'answered');
  assert.equal(answer.passage, '');
  assert.equal(analysis.arguments[0].statusConfidence, 'high');
  assert.equal(analysis.arguments[0].status, 'dropped', 'a confident explicit status is preserved');
});

test('arguments can be deleted with the round and leave no orphan rows', async () => {
  const detail = await alice.get(`/api/rounds/${state.roundId}`);
  const roundId = detail.data.round.id;
  const removed = await alice.delete(`/api/rounds/${roundId}`);
  assert.equal(removed.status, 200);

  assert.equal(await ctx.db.get('SELECT id FROM rounds WHERE id = ?', roundId), null);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM round_arguments WHERE round_id = ?', roundId)).count, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM argument_relationships WHERE round_id = ?', roundId)).count, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM round_findings WHERE round_id = ?', roundId)).count, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM evidence_records WHERE round_id = ?', roundId)).count, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM skill_assessments WHERE round_id = ?', roundId)).count, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM finding_feedback WHERE round_id = ?', roundId)).count, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM human_annotations WHERE round_id = ?', roundId)).count, 0);
});
