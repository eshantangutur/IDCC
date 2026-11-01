import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/test-server.js';

let ctx;
let alice;
let bob;
const state = {};

const PF_SPEECH = `Resolved: The United States should substantially increase funding for public transit.
First, expanding transit obviously solves congestion. Everyone knows that more trains mean fewer cars, so traffic will disappear.
Second, transit spending clearly creates jobs. This plan is therefore the best use of federal money.`;

const PF_REVISION = `Resolved: The United States should substantially increase funding for public transit.
First, expanding transit reduces congestion: a 2024 study of 14 cities found that each new rail mile cut vehicle hours by 3 percent, because commuters switch modes when service is frequent.
Weighing magnitude, congestion costs the economy $120 billion annually, so even a modest reduction outweighs the program's cost.
Second, transit spending creates jobs; according to a 2023 Federal Transit Administration report, every $1 billion in capital spending supports 24,000 jobs.
Even if opponents argue the money is better spent elsewhere, these jobs are immediate while alternative benefits arrive on a decade timeframe.`;

async function register(client, email, password = 'StrongPass123') {
  const meta = await client.get('/api/meta');
  assert.equal(meta.status, 200);
  return client.post('/api/auth/register', { email, password, displayName: email.split('@')[0] });
}

before(async () => {
  ctx = await startTestServer();
  const stamp = Date.now();
  alice = ctx.client();
  bob = ctx.client();
  state.aliceEmail = `alice.${stamp}@example.com`;
  state.bobEmail = `bob.${stamp}@example.com`;

  const aliceRegistration = await register(alice, state.aliceEmail);
  assert.equal(aliceRegistration.status, 201);
  state.aliceId = aliceRegistration.data.user.id;

  const bobRegistration = await register(bob, state.bobEmail);
  assert.equal(bobRegistration.status, 201);
  state.bobId = bobRegistration.data.user.id;
});

after(async () => {
  await ctx.close();
});

test('meta endpoint describes five distinct debate formats', async () => {
  const response = await alice.get('/api/meta');
  assert.equal(response.status, 200);
  assert.equal(response.data.formats.length, 5);
  assert.deepEqual(
    response.data.formats.map((format) => format.id).sort(),
    ['congress', 'ld', 'pf', 'policy', 'wsd']
  );
  for (const format of response.data.formats) {
    assert.ok(format.rubric.length >= 5, `${format.id} has a rubric`);
    assert.ok(format.speechTypes.length >= 3, `${format.id} has speech types`);
    assert.ok(format.specialTool.label, `${format.id} has a special tool`);
    for (const dimension of format.rubric) assert.ok(dimension.definition.length > 10);
  }
  const rubricKeys = new Set();
  for (const format of response.data.formats) {
    rubricKeys.add(format.rubric.map((entry) => entry.key).join(','));
  }
  assert.equal(rubricKeys.size, 5, 'each format has its own rubric');
  assert.equal(response.data.ai.mode, 'demo');
});

test('health endpoint responds without authentication', async () => {
  const response = await alice.get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.data.status, 'ok');
});

test('state-changing requests require a CSRF token', async () => {
  const client = ctx.client();
  await client.get('/api/meta');
  const response = await client.post('/api/auth/register', {
    email: `nocsrf.${Date.now()}@example.com`,
    password: 'StrongPass123',
  }, { csrf: false });
  assert.equal(response.status, 403);
  assert.equal(response.data.error.code, 'csrf_failed');
});

test('registration validates input and stores only password hashes', async () => {
  const client = ctx.client();
  await client.get('/api/meta');

  const weak = await client.post('/api/auth/register', { email: 'weak@example.com', password: 'short' });
  assert.equal(weak.status, 400);

  const duplicate = await client.post('/api/auth/register', {
    email: state.aliceEmail,
    password: 'StrongPass123',
  });
  assert.equal(duplicate.status, 409);

  const row = ctx.db.get('SELECT password_hash FROM users WHERE email = ?', state.aliceEmail);
  assert.ok(row.password_hash.startsWith('$2'));
  assert.notEqual(row.password_hash, 'StrongPass123');
});

test('sessions persist across requests and logout invalidates them', async () => {
  const client = ctx.client();
  await client.get('/api/meta');
  const login = await client.post('/api/auth/login', { email: state.aliceEmail, password: 'StrongPass123' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, state.aliceId);
  assert.ok(login.data.csrfToken);

  const sessionRow = ctx.db.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', state.aliceId);
  assert.ok(sessionRow.count >= 1, 'session row persisted in SQLite');

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, state.aliceEmail);

  const logout = await client.post('/api/auth/logout', {});
  assert.equal(logout.status, 200);
  const after = await client.get('/api/auth/me');
  assert.equal(after.status, 401);
});

test('invalid credentials are rejected without revealing which field failed', async () => {
  const client = ctx.client();
  await client.get('/api/meta');
  const wrong = await client.post('/api/auth/login', { email: state.aliceEmail, password: 'WrongPassword123' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error.message, 'Invalid email or password.');

  const unknown = await client.post('/api/auth/login', { email: 'nobody@example.com', password: 'WrongPassword123' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error.message, 'Invalid email or password.');
});

test('protected routes reject anonymous callers', async () => {
  const client = ctx.client();
  await client.get('/api/meta');
  for (const path of ['/api/cases', '/api/analyses', '/api/stats']) {
    const response = await client.get(path);
    assert.equal(response.status, 401, `${path} requires auth`);
  }
  const analyze = await client.post('/api/analyze', {
    format: 'pf',
    resolution: 'Resolved: Test the endpoint.',
    side: 'pro',
    speechType: 'Case / Constructive',
    content: PF_SPEECH,
  });
  assert.equal(analyze.status, 401);
});

test('case CRUD works and rejects invalid payloads', async () => {
  const created = await alice.post('/api/cases', {
    title: 'Transit funding case',
    resolution: 'Resolved: The United States should substantially increase funding for public transit.',
    format: 'pf',
    side: 'pro',
    notes: 'Pro case built around congestion and jobs.',
    contentions: [{ title: 'Congestion', body: 'Transit reduces vehicle hours.' }],
  });
  assert.equal(created.status, 201);
  state.caseId = created.data.case.id;
  assert.equal(created.data.case.contentions.length, 1);

  const invalid = await alice.post('/api/cases', {
    title: 'Bad case',
    resolution: 'Resolved: Something.',
    format: 'pf',
    side: 'affirmative',
  });
  assert.equal(invalid.status, 400, 'side must match the format');

  const list = await alice.get('/api/cases');
  assert.equal(list.status, 200);
  assert.ok(list.data.cases.some((entry) => entry.id === state.caseId));

  const search = await alice.get('/api/cases?q=transit');
  assert.ok(search.data.cases.length >= 1);
  const noMatch = await alice.get('/api/cases?q=zzzznotfound');
  assert.equal(noMatch.data.cases.length, 0);

  const updated = await alice.put(`/api/cases/${state.caseId}`, { title: 'Transit funding case v2' });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.case.title, 'Transit funding case v2');

  const detail = await alice.get(`/api/cases/${state.caseId}`);
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.data.speeches));
});

test('analysis runs in demo mode and persists findings, nodes and edges', async () => {
  const response = await alice.post('/api/analyze', {
    format: 'pf',
    resolution: 'Resolved: The United States should substantially increase funding for public transit.',
    side: 'pro',
    speechType: 'Case / Constructive',
    content: PF_SPEECH,
    caseId: state.caseId,
    title: 'Transit constructive',
  });

  assert.equal(response.status, 201);
  assert.equal(response.data.mode, 'demo');
  assert.equal(response.data.isDemo, true);
  assert.ok(response.data.demoReason, 'demo reason surfaced to the client');
  assert.ok(response.data.counts.findings >= 3);
  assert.ok(response.data.counts.nodes >= 3);
  assert.ok(response.data.counts.edges >= 2);

  state.analysisId = response.data.analysisId;
  state.speechId = response.data.speechId;

  const stored = ctx.db.get('SELECT * FROM analyses WHERE id = ?', state.analysisId);
  assert.equal(stored.user_id, state.aliceId);
  assert.equal(stored.is_demo, 1);
  assert.ok(stored.result_json.length > 100);

  const findings = ctx.db.all('SELECT * FROM analysis_findings WHERE analysis_id = ? ORDER BY position', state.analysisId);
  assert.ok(findings.length >= 3);
  const nodeRows = ctx.db.all('SELECT * FROM argument_nodes WHERE analysis_id = ?', state.analysisId);
  const edgeRows = ctx.db.all('SELECT * FROM argument_edges WHERE analysis_id = ?', state.analysisId);
  assert.ok(nodeRows.length >= 3);
  assert.ok(edgeRows.length >= 2);
  const nodeKeys = new Set(nodeRows.map((row) => row.node_key));
  for (const edge of edgeRows) {
    assert.ok(nodeKeys.has(edge.source_key), 'edge source references a stored node');
    assert.ok(nodeKeys.has(edge.target_key), 'edge target references a stored node');
  }
  for (const finding of findings) {
    assert.ok(finding.explanation.length > 10);
    assert.ok(['critical', 'moderate', 'minor', 'improvement', 'strength'].includes(finding.category));
  }

  const fetched = await alice.get(`/api/analyses/${state.analysisId}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.data.analysis.id, state.analysisId);
  assert.equal(fetched.data.analysis.isDemo, true);
  assert.ok(fetched.data.analysis.result.summary.overview.length > 20);
  assert.equal(fetched.data.analysis.result.nodes.length, nodeRows.length);
  assert.equal(fetched.data.analysis.result.edges.length, edgeRows.length);
  assert.equal(fetched.data.analysis.result.rubric.dimensions.length, 5);
  assert.equal(fetched.data.analysis.result.formatSpecific.key, 'weighing');

  const list = await alice.get('/api/analyses');
  assert.equal(list.status, 200);
  assert.ok(list.data.analyses.some((entry) => entry.id === state.analysisId));

  const filtered = await alice.get('/api/analyses?format=pf&q=transit');
  assert.ok(filtered.data.analyses.some((entry) => entry.id === state.analysisId));

  const speech = await alice.get(`/api/speeches/${state.speechId}`);
  assert.equal(speech.status, 200);
  assert.equal(speech.data.versions.length, 1);
  assert.equal(speech.data.analyses.length, 1);
});

test('revision analysis creates a new version and tracks resolved weaknesses', async () => {
  const revised = await alice.post('/api/analyze', {
    format: 'pf',
    resolution: 'Resolved: The United States should substantially increase funding for public transit.',
    side: 'pro',
    speechType: 'Case / Constructive',
    content: PF_REVISION,
    speechId: state.speechId,
  });

  assert.equal(revised.status, 201);
  assert.equal(revised.data.version, 2);
  assert.equal(revised.data.versionCreated, true);
  assert.ok(revised.data.comparison, 'comparison returned for revisions');
  assert.ok(revised.data.comparison.resolvedCount >= 1, 'at least one weakness resolved');
  assert.ok(revised.data.comparison.previousAnalysisId === state.analysisId);

  state.revisionAnalysisId = revised.data.analysisId;

  const versions = await alice.get(`/api/speeches/${state.speechId}/versions`, {});
  assert.equal(versions.data.versions.length, 2);

  const withContent = await alice.get(`/api/speeches/${state.speechId}/versions?include=content`);
  assert.equal(withContent.data.versions[0].content, PF_REVISION);

  const saved = await alice.post(`/api/speeches/${state.speechId}/versions`, {
    content: `${PF_REVISION}\nThird, the plan is auditable.`,
    label: 'Manual revision',
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.data.version.version, 3);

  const duplicate = await alice.post(`/api/speeches/${state.speechId}/versions`, {
    content: `${PF_REVISION}\nThird, the plan is auditable.`,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.created, false);
});

test('users cannot read, modify or analyze another account\'s records', async () => {
  const caseRead = await bob.get(`/api/cases/${state.caseId}`);
  assert.equal(caseRead.status, 404);

  const caseWrite = await bob.put(`/api/cases/${state.caseId}`, { title: 'Hijacked' });
  assert.equal(caseWrite.status, 404);

  const caseDelete = await bob.delete(`/api/cases/${state.caseId}`);
  assert.equal(caseDelete.status, 404);

  const analysisRead = await bob.get(`/api/analyses/${state.analysisId}`);
  assert.equal(analysisRead.status, 404);

  const analysisDelete = await bob.delete(`/api/analyses/${state.analysisId}`);
  assert.equal(analysisDelete.status, 404);

  const speechRead = await bob.get(`/api/speeches/${state.speechId}`);
  assert.equal(speechRead.status, 404);

  const speechVersion = await bob.post(`/api/speeches/${state.speechId}/versions`, { content: PF_SPEECH });
  assert.equal(speechVersion.status, 404);

  const analyzeForeignCase = await bob.post('/api/analyze', {
    format: 'pf',
    resolution: 'Resolved: The United States should substantially increase funding for public transit.',
    side: 'pro',
    speechType: 'Case / Constructive',
    content: PF_SPEECH,
    caseId: state.caseId,
  });
  assert.equal(analyzeForeignCase.status, 404);

  const bobList = await bob.get('/api/analyses');
  assert.equal(bobList.data.analyses.length, 0);

  const bobCases = await bob.get('/api/cases');
  assert.equal(bobCases.data.cases.length, 0);
});

test('analysis validates format, side, speech type and length', async () => {
  const base = {
    format: 'ld',
    resolution: 'Resolved: A just society ought to prioritise individual liberty.',
    side: 'affirmative',
    speechType: 'Affirmative Constructive (AC)',
    content: PF_SPEECH,
  };

  const badFormat = await alice.post('/api/analyze', { ...base, format: 'parliamentary' });
  assert.equal(badFormat.status, 400);

  const badSide = await alice.post('/api/analyze', { ...base, side: 'pro' });
  assert.equal(badSide.status, 400);

  const badSpeechType = await alice.post('/api/analyze', { ...base, speechType: 'Summary' });
  assert.equal(badSpeechType.status, 400, 'PF speech types are not valid for LD');

  const tooShort = await alice.post('/api/analyze', { ...base, content: 'Too short.' });
  assert.equal(tooShort.status, 400);
});

test('each format produces its own format-specific analysis block', async () => {
  const cases = [
    {
      format: 'ld',
      side: 'affirmative',
      speechType: 'Affirmative Constructive (AC)',
      resolution: 'Resolved: A just society ought to prioritise individual liberty over collective security.',
      content: 'The value is justice, and the criterion is protecting individual autonomy. Because coercion destroys autonomy, a state that mandates surveillance fails its own standard. My first contention is that liberty is a precondition for moral agency, which means any policy that treats people as means violates justice.',
      toolKey: 'frameworkCheck',
    },
    {
      format: 'policy',
      side: 'affirmative',
      speechType: '1AC',
      resolution: 'Resolved: The United States federal government should substantially increase its investment in high-speed rail.',
      content: 'The plan is for the Department of Transportation to fund high-speed rail through grants. Harms: current infrastructure is congested and inherency shows the status quo will not fix it. Solvency: the plan funds construction, which solves the bottleneck. Advantage one leads to economic growth. Disadvantage: uniqueness now, the link is that spending causes inflation, with an impact on household costs.',
      toolKey: 'disadvantageChains',
    },
    {
      format: 'congress',
      side: 'affirmative',
      speechType: 'Sponsorship Speech',
      resolution: 'A bill to establish a federal grant program for rural broadband.',
      content: 'This bill shall establish a grant program and shall fund rural broadband deployment. The provision requires the Department of Agriculture to allocate funds to cooperatives. According to a 2024 report, 18 million rural households lack access. I move to suspend the rules and pass the bill.',
      toolKey: 'legislativeAnalysis',
    },
    {
      format: 'wsd',
      side: 'proposition',
      speechType: 'Second Proposition',
      resolution: 'This house believes that social media companies should be liable for user-generated content.',
      content: 'As second proposition, I extend our case with a new argument about enforcement. Because platforms profit from engagement, they will not self-regulate. Compared with the opposition world, our model reduces harm sooner. However, my teammate argued that liability would destroy small platforms, which conflicts with my claim that it helps them.',
      toolKey: 'teamConsistency',
    },
  ];

  for (const entry of cases) {
    const response = await alice.post('/api/analyze', entry);
    assert.equal(response.status, 201, `${entry.format} analysis succeeds`);
    const stored = await alice.get(`/api/analyses/${response.data.analysisId}`);
    assert.equal(stored.data.analysis.format, entry.format);
    const formatSpecific = stored.data.analysis.result.formatSpecific;
    assert.equal(formatSpecific.key, entry.toolKey, `${entry.format} uses its own tool`);
    assert.ok(formatSpecific.data && typeof formatSpecific.data === 'object');
    const instructions = stored.data.analysis.result.rubric.dimensions.map((dimension) => dimension.key);
    assert.equal(instructions.length, 5);
  }
});

test('analyses can be deleted and speech deletion cascades', async () => {
  const deleted = await alice.delete(`/api/analyses/${state.revisionAnalysisId}`);
  assert.equal(deleted.status, 200);
  const gone = await alice.get(`/api/analyses/${state.revisionAnalysisId}`);
  assert.equal(gone.status, 404);

  const speechDelete = await alice.delete(`/api/speeches/${state.speechId}`);
  assert.equal(speechDelete.status, 200);
  const cascade = ctx.db.get('SELECT COUNT(*) AS count FROM analyses WHERE speech_id = ?', state.speechId);
  assert.equal(cascade.count, 0, 'analyses cascade with the speech');
  const speechGone = await alice.get(`/api/speeches/${state.speechId}`);
  assert.equal(speechGone.status, 404);
});

test('settings endpoints require the current password', async () => {
  const wrong = await alice.post('/api/auth/change-password', {
    currentPassword: 'NotMyPassword123',
    newPassword: 'EvenStrongerPass456',
  });
  assert.equal(wrong.status, 400);

  const changed = await alice.post('/api/auth/change-password', {
    currentPassword: 'StrongPass123',
    newPassword: 'EvenStrongerPass456',
  });
  assert.equal(changed.status, 200);

  const oldLogin = ctx.client();
  await oldLogin.get('/api/meta');
  const rejected = await oldLogin.post('/api/auth/login', { email: state.aliceEmail, password: 'StrongPass123' });
  assert.equal(rejected.status, 401);

  const newLogin = ctx.client();
  await newLogin.get('/api/meta');
  const accepted = await newLogin.post('/api/auth/login', { email: state.aliceEmail, password: 'EvenStrongerPass456' });
  assert.equal(accepted.status, 200);
});

test('account deletion removes all owned data', async () => {
  const temp = ctx.client();
  await temp.get('/api/meta');
  const email = `delete.${Date.now()}@example.com`;
  const registration = await temp.post('/api/auth/register', { email, password: 'StrongPass123' });
  assert.equal(registration.status, 201);
  const userId = registration.data.user.id;

  const createdCase = await temp.post('/api/cases', {
    title: 'Temporary case',
    resolution: 'Resolved: Temporary test case.',
    format: 'pf',
    side: 'pro',
  });
  assert.equal(createdCase.status, 201);

  const wrongPassword = await temp.delete('/api/auth/account', { password: 'Nope12345678' });
  assert.equal(wrongPassword.status, 400);

  const removed = await temp.delete('/api/auth/account', { password: 'StrongPass123' });
  assert.equal(removed.status, 200);

  assert.equal(ctx.db.get('SELECT id FROM users WHERE id = ?', userId), null);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS count FROM debate_cases WHERE user_id = ?', userId).count, 0);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', userId).count, 0);

  const me = await temp.get('/api/auth/me');
  assert.equal(me.status, 401);
});

test('stats endpoint reports the signed-in user only', async () => {
  const stats = await alice.get('/api/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.data.totals.analyses >= 1);
  const bobStats = await bob.get('/api/stats');
  assert.equal(bobStats.status, 200);
  assert.equal(bobStats.data.totals.analyses, 0);
});
