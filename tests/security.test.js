import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/test-server.js';
import { normalizeRoundAnalysis } from '../src/services/ai/round-normalize.js';
import { parseJsonLoose } from '../src/services/ai/normalize.js';
import { getFormat } from '../src/services/formats.js';

let ctx;
let alice;
let bob;
const state = {};

async function register(client, email) {
  await client.get('/api/meta');
  return client.post('/api/auth/register', { email, password: 'StrongPass123', displayName: email.split('@')[0] });
}

before(async () => {
  ctx = await startTestServer();
  const stamp = Date.now();
  alice = ctx.client();
  bob = ctx.client();
  await register(alice, `sec.alice.${stamp}@example.com`);
  await register(bob, `sec.bob.${stamp}@example.com`);
});

after(async () => {
  await ctx.close();
});

test('anonymous callers cannot reach any round intelligence endpoint', async () => {
  const client = ctx.client();
  await client.get('/api/meta');
  const paths = ['/api/rounds', '/api/progress', '/api/benchmarks', '/api/evidence?roundId=1'];
  for (const path of paths) {
    const response = await client.get(path);
    assert.equal(response.status, 401, `${path} requires authentication`);
  }
  const analyze = await client.post('/api/rounds/1/analyze', {});
  assert.equal(analyze.status, 401);
  const verify = await client.post('/api/evidence/1/verify', {});
  assert.equal(verify.status, 401);
  const feedback = await client.post('/api/feedback', { targetType: 'round_finding', targetId: 1, rating: 'accurate' });
  assert.equal(feedback.status, 401);
});

test('invalid and unknown ids are rejected without leaking rows', async () => {
  const invalid = await alice.get('/api/rounds/not-a-number');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error.code, 'invalid_request');

  const missing = await alice.get('/api/rounds/999999');
  assert.equal(missing.status, 404);

  const missingArgument = await alice.get('/api/rounds/1/arguments/999999');
  assert.equal(missingArgument.status, 404);

  const negative = await alice.get('/api/rounds/-3');
  assert.equal(negative.status, 400);
});

test('SQL injection payloads are stored as text and never executed', async () => {
  const payload = `'; DROP TABLE rounds; --`;

  const created = await alice.post('/api/rounds', {
    title: payload,
    format: 'pf',
    resolution: 'Resolved: A test resolution for injection handling.',
    side: 'pro',
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.round.title, payload);
  state.injectionRoundId = created.data.round.id;

  // The table still exists and the row is readable.
  const detail = await alice.get(`/api/rounds/${state.injectionRoundId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.round.title, payload);

  const sqliteMaster = await ctx.db.get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'rounds'");
  assert.equal(sqliteMaster.count, 1, 'the rounds table was not dropped');

  // A LIKE search with wildcard characters must not match everything.
  const search = await alice.get('/api/rounds?q=%25');
  assert.equal(search.status, 200);
  assert.equal(
    search.data.rounds.some((round) => round.title === 'Not a wildcard match'),
    false
  );

  const unknownId = await alice.get('/api/rounds/1%20OR%201=1');
  assert.equal(unknownId.status, 400);
});

test('stored XSS payloads round-trip as data and JSON responses are not cached', async () => {
  const xss = `<img src=x onerror="alert(1)"><script>alert('xss')</script>`;
  const created = await alice.post('/api/rounds', {
    title: xss,
    format: 'ld',
    resolution: 'Resolved: A test resolution for cross site scripting handling.',
    side: 'affirmative',
  });
  assert.equal(created.status, 201);

  const detail = await alice.get(`/api/rounds/${created.data.round.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.round.title, xss, 'the API returns the raw text; the UI escapes it');
  assert.equal(detail.headers.get('content-type')?.includes('application/json'), true);
  assert.equal(detail.headers.get('cache-control')?.includes('no-store'), true);
  assert.equal(detail.headers.get('x-content-type-options'), 'nosniff');
});

test('oversized bodies and oversized speech text are rejected', async () => {
  const huge = await alice.request('POST', '/api/rounds', {
    title: 'Big',
    format: 'pf',
    resolution: 'Resolved: A test resolution.',
    notes: 'x'.repeat(2 * 1024 * 1024 + 4096),
  });
  assert.equal(huge.status, 413);
  assert.equal(huge.data.error.code, 'payload_too_large');

  const round = await alice.post('/api/rounds', {
    title: 'Speech limit',
    format: 'pf',
    resolution: 'Resolved: A test resolution for speech size limits.',
  });
  const tooLong = await alice.post(`/api/rounds/${round.data.round.id}/speeches`, {
    side: 'pro',
    speechType: 'Case / Constructive',
    content: 'a'.repeat(128001),
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.data.error.details.field, 'content');
});

test('a tampered session cookie is treated as signed out', async () => {
  const client = ctx.client();
  await client.get('/api/meta');
  await register(client, `tamper.${Date.now()}@example.com`);
  const ok = await client.get('/api/auth/me');
  assert.equal(ok.status, 200);

  const sid = client.cookies.get('af.sid');
  client.cookies.set('af.sid', `${sid}tampered`);
  const rejected = await client.get('/api/auth/me');
  assert.equal(rejected.status, 401);
});

test('malformed AI output is rejected instead of being stored', () => {
  const formatSpec = getFormat('pf');
  const speeches = [
    {
      id: 1,
      position: 1,
      side: 'pro',
      speechType: 'Case / Constructive',
      content: 'Transit funding reduces congestion because commuters switch modes when service is frequent.',
    },
  ];

  assert.throws(() => parseJsonLoose(''), /empty response/i);
  assert.throws(() => parseJsonLoose('I cannot help with that.'), /did not return JSON/i);
  assert.throws(() => parseJsonLoose('{"summary": {'), /did not return JSON/i);
  assert.throws(() => parseJsonLoose('{"summary": ,}'), /malformed JSON/i);

  assert.throws(() => normalizeRoundAnalysis('not an object', { formatSpec, speeches }), /JSON object/i);
  assert.throws(
    () => normalizeRoundAnalysis({ arguments: 'nope' }, { formatSpec, speeches }),
    /did not identify any arguments/i
  );

  // Out-of-range speech positions are dropped rather than inventing a speech.
  const analysis = normalizeRoundAnalysis(
    {
      arguments: [
        {
          key: 'A1',
          side: 'pro',
          type: 'claim',
          label: 'Transit',
          claim: 'Transit reduces congestion.',
          introducedSpeech: 99,
          status: 'invented-status',
          appearances: [{ speech: 99, kind: 'introduced', passage: 'not real' }],
        },
      ],
      relationships: [{ from: 'A1', to: 'A1', relation: 'supports' }],
      evidence: [{ speech: 99, passage: 'nope', assessment: 'supported' }],
      skills: [{ key: 'not_a_skill', level: 9 }],
    },
    { formatSpec, speeches }
  );

  assert.equal(analysis.arguments.length, 1);
  assert.equal(analysis.arguments[0].introducedSpeechId, null, 'unknown speech references are dropped');
  assert.equal(analysis.arguments[0].status, 'unclear', 'unknown statuses fall back to unclear');
  assert.equal(analysis.relationships.length, 0, 'self relationships are rejected');
  assert.equal(analysis.evidence.length, 0, 'evidence on a missing speech is rejected');
  assert.equal(analysis.skills.length, 0, 'unknown skills and invalid levels are rejected');
});

test('AI endpoints are rate limited per user', async () => {
  const limited = await startTestServer({
    rateLimits: { aiMax: 2, aiWindowMs: 60_000, globalMax: 100000, authMax: 10000 },
  });
  try {
    const client = limited.client();
    const email = `ratelimit.${Date.now()}@example.com`;
    const registration = await register(client, email);
    assert.equal(registration.status, 201);

    const round = await client.post('/api/rounds', {
      title: 'Rate limit round',
      format: 'pf',
      resolution: 'Resolved: A test resolution for rate limiting.',
    });
    assert.equal(round.status, 201);

    await client.post(`/api/rounds/${round.data.round.id}/speeches`, {
      side: 'pro',
      speechType: 'Case / Constructive',
      content: 'Transit funding reduces congestion because commuters switch modes when service is frequent.',
    });

    const first = await client.post(`/api/rounds/${round.data.round.id}/analyze`, {});
    const second = await client.post(`/api/rounds/${round.data.round.id}/analyze`, {});
    const third = await client.post(`/api/rounds/${round.data.round.id}/analyze`, {});
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 429);
    assert.equal(third.data.error.code, 'rate_limited');
  } finally {
    await limited.close();
  }
});

test('one user cannot reach another user\'s benchmarks, annotations or feedback', async () => {
  const round = await alice.post('/api/rounds', {
    title: 'Isolation round',
    format: 'pf',
    resolution: 'Resolved: A test resolution for cross user isolation.',
  });
  await alice.post(`/api/rounds/${round.data.round.id}/speeches`, {
    side: 'pro',
    speechType: 'Case / Constructive',
    content:
      'Transit funding reduces congestion because commuters switch modes when service is frequent, according to a 2024 study.',
  });
  await alice.post(`/api/rounds/${round.data.round.id}/analyze`, {});

  const detail = await alice.get(`/api/rounds/${round.data.round.id}`);
  const finding = detail.data.findings[0];
  assert.ok(finding);

  const annotation = await bob.post('/api/feedback/annotations', {
    targetType: 'round_finding',
    targetId: finding.id,
    humanValue: 'Foreign correction attempt.',
  });
  assert.equal(annotation.status, 404);

  const bobAnnotations = await bob.get(`/api/feedback/annotations?roundId=${round.data.round.id}`);
  assert.equal(bobAnnotations.status, 200);
  assert.equal(bobAnnotations.data.annotations.length, 0);

  const benchmark = await alice.post('/api/benchmarks', {
    title: 'Private example',
    format: 'pf',
    speechText: 'Transit funding reduces congestion because commuters switch modes when service is frequent.',
  });
  assert.equal(benchmark.status, 201);

  const bobRead = await bob.get(`/api/benchmarks/${benchmark.data.benchmark.id}`);
  assert.equal(bobRead.status, 404);
  const bobList = await bob.get('/api/benchmarks');
  assert.equal(bobList.data.benchmarks.length, 0);

  const bobRoundFeedback = await bob.get(`/api/feedback?roundId=${round.data.round.id}`);
  assert.equal(bobRoundFeedback.status, 200);
  assert.equal(bobRoundFeedback.data.feedback.length, 0);
});
