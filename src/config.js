import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseTrustProxy(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const raw = String(value).trim();
  // Express treats a numeric string like "1" as an IP address, not a hop
  // count. That leaves req.secure false behind Vercel's proxy, so Express
  // silently drops the Secure session cookie. Normalize hop counts to numbers.
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

const DEV_SESSION_SECRET = 'argument-forensics-development-secret-change-me';

/**
 * Load and validate configuration from environment variables.
 * Secrets are read here only and never leave the server process.
 */
export function loadConfig(env = process.env, overrides = {}) {
  const onVercel = bool(env.VERCEL, false);
  const isProduction = env.NODE_ENV === 'production' || onVercel;
  const secret = String(env.SESSION_SECRET || '').trim();
  const databaseUrl = String(env.TURSO_DATABASE_URL || '').trim();
  const databaseAuthToken = String(env.TURSO_AUTH_TOKEN || '').trim();

  if (databaseUrl && !databaseAuthToken) {
    throw new Error('TURSO_AUTH_TOKEN must be set when TURSO_DATABASE_URL points at a remote database.');
  }

  if (onVercel && !databaseUrl) {
    throw new Error(
      'TURSO_DATABASE_URL is missing. Serverless functions cannot write a local SQLite file. ' +
        'In Vercel, open Project Settings -> Environment Variables, add the Turso integration, ' +
        'connect the database to Production and Preview, then redeploy.'
    );
  }

  if (isProduction && secret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to at least 32 characters in production and on Vercel. ' +
        'Add it in Vercel Project Settings -> Environment Variables for Production and Preview, then redeploy.'
    );
  }

  const provider = String(env.AI_PROVIDER || 'grok').toLowerCase();
  const supportedProviders = new Set(['grok', 'groq', 'openai-compatible', 'demo']);
  if (!supportedProviders.has(provider)) {
    throw new Error(
      `Unsupported AI_PROVIDER "${provider}". Use "grok", "groq", "openai-compatible" or "demo".`
    );
  }

  // Keep provider credentials separate: an xAI key must never be sent to Groq,
  // and a Groq key must never be sent to xAI.
  const keyCandidates =
    provider === 'groq'
      ? [env.GROQ_API_KEY, env.AI_API_KEY]
      : provider === 'grok'
        ? [env.GROK_API_KEY, env.XAI_API_KEY, env.AI_API_KEY]
        : [env.AI_API_KEY, env.GROK_API_KEY, env.XAI_API_KEY, env.GROQ_API_KEY];
  const apiKey = String(keyCandidates.find((value) => String(value || '').trim()) || '').trim();

  const providerDefaults = {
    grok: { baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
    'openai-compatible': { baseUrl: '', model: '' },
    demo: { baseUrl: '', model: '' },
  };
  const providerDefault = providerDefaults[provider];

  const forcedDemo = bool(env.AI_DEMO_MODE, false) || provider === 'demo';
  const demoMode = forcedDemo || !apiKey;

  let demoReason = null;
  if (forcedDemo) {
    demoReason = 'AI_DEMO_MODE is enabled or AI_PROVIDER=demo.';
  } else if (!apiKey) {
    const keyName = provider === 'groq' ? 'GROQ_API_KEY' : provider === 'grok' ? 'GROK_API_KEY' : 'AI_API_KEY';
    demoReason = `Set ${keyName} in your .env file to enable live analysis.`;
  }

  const baseUrl = String(env.AI_BASE_URL || providerDefault.baseUrl).replace(/\/+$/, '');
  const model = String(env.AI_MODEL || env.GROK_MODEL || providerDefault.model).trim();
  if (!demoMode && (!baseUrl || !model)) {
    throw new Error(`AI_PROVIDER=${provider} requires AI_BASE_URL and AI_MODEL.`);
  }
  // Refuse the most likely provider mix-up instead of sending one provider's
  // key to the other provider's endpoint.
  if (provider === 'groq' && baseUrl.includes('api.x.ai')) {
    throw new Error(
      'AI_PROVIDER=groq cannot use the xAI base URL. Set AI_BASE_URL=https://api.groq.com/openai/v1 or remove it.'
    );
  }
  if (provider === 'grok' && baseUrl.includes('api.groq.com')) {
    throw new Error(
      'AI_PROVIDER=grok cannot use the Groq base URL. Set AI_BASE_URL=https://api.x.ai/v1 or remove it.'
    );
  }

  const config = {
    env: isProduction ? 'production' : 'development',
    isProduction,
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    projectRoot: PROJECT_ROOT,
    publicDir: path.join(PROJECT_ROOT, 'public'),
    databasePath: env.DATABASE_PATH
      ? path.resolve(PROJECT_ROOT, env.DATABASE_PATH)
      : path.join(PROJECT_ROOT, 'data', 'argument-forensics.sqlite'),
    databaseUrl,
    databaseAuthToken,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction ? 1 : 'loopback'),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    logLevel: env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    bcryptRounds: Math.min(Math.max(int(env.BCRYPT_ROUNDS, 12), 10), 15),
    session: {
      name: 'af.sid',
      secret: secret || DEV_SESSION_SECRET,
      ttlMs: Math.max(int(env.SESSION_TTL_HOURS, 168), 1) * 60 * 60 * 1000,
      cookieSecure: bool(env.COOKIE_SECURE, isProduction),
      sameSite: 'lax',
      usingDevSecret: !secret,
    },
    ai: {
      provider,
      apiKey,
      baseUrl,
      model,
      timeoutMs: Math.min(Math.max(int(env.AI_TIMEOUT_MS, 60000), 5000), 180000),
      maxOutputTokens: Math.min(Math.max(int(env.AI_MAX_OUTPUT_TOKENS, 4500), 1000), 16000),
      temperature: Number(env.AI_TEMPERATURE || 0.2),
      jsonMode: bool(env.AI_JSON_MODE, true),
      demoMode,
      demoReason,
      maxSpeechChars: 20000,
    },
    upload: {
      maxBytes: Math.min(Math.max(int(env.UPLOAD_MAX_BYTES, 5 * 1024 * 1024), 1024), 20 * 1024 * 1024),
    },
    evidence: {
      // No provider ships with the app. Without EVIDENCE_SEARCH_URL every
      // evidence record is reported as unverified instead of pretending a
      // source was retrieved.
      provider: String(env.EVIDENCE_PROVIDER || 'http').toLowerCase(),
      searchUrl: String(env.EVIDENCE_SEARCH_URL || '').trim(),
      apiKey: String(env.EVIDENCE_API_KEY || '').trim(),
      timeoutMs: Math.min(Math.max(int(env.EVIDENCE_TIMEOUT_MS, 8000), 1000), 30000),
    },
    rateLimits: {
      globalWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      globalMax: int(env.RATE_LIMIT_MAX, 600),
      authWindowMs: int(env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      authMax: int(env.AUTH_RATE_LIMIT_MAX, 20),
      aiWindowMs: int(env.AI_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
      aiMax: int(env.AI_RATE_LIMIT_MAX, 30),
      fileWindowMs: int(env.FILE_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      fileMax: int(env.FILE_RATE_LIMIT_MAX, 40),
    },
  };

  return deepMerge(config, overrides);
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      output[key] = deepMerge(target[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

const AI_PROVIDER_LABELS = {
  grok: 'xAI Grok',
  groq: 'Groq',
  'openai-compatible': 'OpenAI-compatible',
};

export function publicAiStatus(config) {
  return {
    mode: config.ai.demoMode ? 'demo' : 'live',
    provider: config.ai.demoMode
      ? 'local-heuristic'
      : AI_PROVIDER_LABELS[config.ai.provider] || config.ai.provider,
    model: config.ai.demoMode ? null : config.ai.model,
    reason: config.ai.demoReason,
  };
}
