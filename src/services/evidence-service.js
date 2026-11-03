import { badRequest, notFound } from '../utils/errors.js';
import { EVIDENCE_ASSESSMENTS } from './formats.js';

/**
 * Modular evidence verification.
 *
 * The application ships WITHOUT a search or retrieval provider. That is not a
 * missing feature hidden behind a fake success state: when no provider is
 * configured, verification records an explicit "unavailable" result and the
 * UI says the evidence was not checked.
 *
 * To add a provider, register a function that accepts { claim, citation,
 * passage } and returns { status, title, url, excerpt, publishedAt,
 * relationship } or throws. Nothing in the rest of the app needs to change.
 */
const PROVIDERS = new Map();

export function registerVerificationProvider(name, verify) {
  if (!name || typeof verify !== 'function') {
    throw new Error('A verification provider needs a name and a verify function.');
  }
  PROVIDERS.set(name, { name, verify });
}

/**
 * The optional generic HTTP provider. It is only active when
 * EVIDENCE_SEARCH_URL is configured; the API key stays on the server.
 */
registerVerificationProvider('http', async ({ claim, citation, passage }, { url, apiKey, timeoutMs = 8000 }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ claim, citation, passage }),
      signal: controller.signal,
    });
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) {
      throw new Error(`Verification provider returned HTTP ${response.status}.`);
    }
    const body = await response.json();
    return {
      status: body?.found === false ? 'not_found' : 'verified',
      title: body?.title ?? null,
      url: body?.url ?? null,
      excerpt: body?.excerpt ?? null,
      publishedAt: body?.publishedAt ?? null,
      relationship: body?.relationship ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
});

export function resolveVerificationProvider(config) {
  const url = String(config?.evidence?.searchUrl || '').trim();
  if (!url) return null;
  const name = String(config?.evidence?.provider || 'http').toLowerCase();
  const provider = PROVIDERS.get(name);
  if (!provider) return null;
  return {
    name: provider.name,
    verify: (input) =>
      provider.verify(input, {
        url,
        apiKey: config?.evidence?.apiKey || '',
        timeoutMs: config?.evidence?.timeoutMs || 8000,
      }),
  };
}

export async function verifyEvidence({ db, config, logger, userId, evidenceId }) {
  const record = await db.get(
    'SELECT * FROM evidence_records WHERE id = ? AND user_id = ?',
    evidenceId,
    userId
  );
  if (!record) throw notFound('That evidence record does not exist in your workspace.');

  const provider = resolveVerificationProvider(config);

  if (!provider) {
    const notes =
      'No evidence-verification provider is configured. This passage has not been checked against any external source.';
    await db.run(
      `INSERT INTO evidence_verifications (evidence_id, status, provider, notes)
       VALUES (?, 'unavailable', NULL, ?)`,
      evidenceId,
      notes
    );
    return {
      evidenceId,
      status: 'unavailable',
      provider: null,
      message: notes,
      checkedAt: new Date().toISOString(),
    };
  }

  let result;
  try {
    result = await provider.verify({
      claim: record.supported_claim || '',
      citation: record.citation || '',
      passage: record.passage,
    });
  } catch (error) {
    logger?.warn('Evidence verification failed', { evidenceId, error: error.message });
    const notes = `The verification provider could not be reached. ${error.message}`;
    await db.run(
      `INSERT INTO evidence_verifications (evidence_id, status, provider, notes)
       VALUES (?, 'error', ?, ?)`,
      evidenceId,
      provider.name,
      notes
    );
    return {
      evidenceId,
      status: 'error',
      provider: provider.name,
      message: notes,
      checkedAt: new Date().toISOString(),
    };
  }

  const status = ['verified', 'not_found'].includes(result.status) ? result.status : 'not_found';
  await db.run(
    `INSERT INTO evidence_verifications
      (evidence_id, status, provider, source_title, source_url, excerpt, published_at, relationship, discrepancy, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    evidenceId,
    status,
    provider.name,
    result.title ?? null,
    result.url ?? null,
    result.excerpt ?? null,
    result.publishedAt ?? null,
    result.relationship ?? null,
    result.discrepancy ?? null,
    result.notes ?? null
  );

  return {
    evidenceId,
    status,
    provider: provider.name,
    sourceTitle: result.title ?? null,
    sourceUrl: result.url ?? null,
    excerpt: result.excerpt ?? null,
    publishedAt: result.publishedAt ?? null,
    relationship: result.relationship ?? null,
    discrepancy: result.discrepancy ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function latestVerifications(db, evidenceIds) {
  if (!evidenceIds.length) return new Map();
  const placeholders = evidenceIds.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT v.* FROM evidence_verifications v
     JOIN (
       SELECT evidence_id, MAX(id) AS max_id FROM evidence_verifications
       WHERE evidence_id IN (${placeholders})
       GROUP BY evidence_id
     ) latest ON latest.max_id = v.id`,
    ...evidenceIds
  );
  return new Map(
    rows.map((row) => [
      row.evidence_id,
      {
        status: row.status,
        provider: row.provider,
        sourceTitle: row.source_title,
        sourceUrl: row.source_url,
        excerpt: row.excerpt,
        publishedAt: row.published_at,
        relationship: row.relationship,
        discrepancy: row.discrepancy,
        notes: row.notes,
        checkedAt: row.checked_at,
      },
    ])
  );
}

export function assertAssessment(value) {
  if (!EVIDENCE_ASSESSMENTS.includes(value)) {
    throw badRequest('Unknown evidence assessment.', { field: 'assessment' });
  }
  return value;
}
