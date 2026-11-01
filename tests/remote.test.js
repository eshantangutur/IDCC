import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/test-server.js';

const remoteUrl = process.env.TURSO_TEST_URL;
const remoteToken = process.env.TURSO_TEST_TOKEN || 'test-token';

const SPEECH = `Resolved: The United States should substantially increase funding for public transit.
First, expanding transit reduces congestion because commuters switch modes when service is frequent.
Second, transit spending creates construction and operations jobs across the region.`;

test('remote libSQL storage supports accounts, analysis and deletion', { skip: !remoteUrl }, async () => {
  const ctx = await startTestServer({
    databaseUrl: remoteUrl,
    databaseAuthToken: remoteToken,
  });

  try {
    const client = ctx.client();
    const email = `remote.${Date.now()}@example.com`;

    await client.get('/api/meta');
    const registration = await client.post('/api/auth/register', {
      email,
      password: 'StrongPass123',
      displayName: 'Remote Tester',
    });
    assert.equal(registration.status, 201);
    const userId = registration.data.user.id;

    const createdCase = await client.post('/api/cases', {
      title: 'Remote transit case',
      resolution: 'Resolved: The United States should substantially increase funding for public transit.',
      format: 'pf',
      side: 'pro',
    });
    assert.equal(createdCase.status, 201);

    const analysis = await client.post('/api/analyze', {
      format: 'pf',
      resolution: 'Resolved: The United States should substantially increase funding for public transit.',
      side: 'pro',
      speechType: 'Case / Constructive',
      content: SPEECH,
      caseId: createdCase.data.case.id,
    });
    assert.equal(analysis.status, 201);

    const stored = await ctx.db.get('SELECT id, user_id FROM analyses WHERE id = ?', analysis.data.analysisId);
    assert.equal(stored.user_id, userId);

    const removed = await client.delete('/api/auth/account', { password: 'StrongPass123' });
    assert.equal(removed.status, 200);
    assert.equal(await ctx.db.get('SELECT id FROM users WHERE id = ?', userId), null);
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS count FROM analyses WHERE user_id = ?', userId)).count, 0);
  } finally {
    await ctx.close();
  }
});
