import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, publicAiStatus } from '../src/config.js';

const baseEnv = { NODE_ENV: 'test' };

test('built-in Groq provider uses Groq defaults and its own key', () => {
  const config = loadConfig({ ...baseEnv, AI_PROVIDER: 'groq', GROQ_API_KEY: 'test-groq-key' });

  assert.equal(config.ai.provider, 'groq');
  assert.equal(config.ai.demoMode, false);
  assert.equal(config.ai.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(config.ai.model, 'openai/gpt-oss-120b');

  const status = publicAiStatus(config);
  assert.equal(status.mode, 'live');
  assert.equal(status.provider, 'Groq');
  assert.equal(status.model, 'openai/gpt-oss-120b');
});

test('Groq never receives an xAI key', () => {
  const config = loadConfig({ ...baseEnv, AI_PROVIDER: 'groq', GROK_API_KEY: 'xai-test-key' });

  assert.equal(config.ai.demoMode, true);
  assert.match(config.ai.demoReason, /GROQ_API_KEY/);
});

test('Groq without a key stays in demo mode with a provider-specific reason', () => {
  const config = loadConfig({ ...baseEnv, AI_PROVIDER: 'groq' });

  assert.equal(config.ai.demoMode, true);
  assert.equal(publicAiStatus(config).provider, 'local-heuristic');
  assert.match(config.ai.demoReason, /GROQ_API_KEY/);
  assert.doesNotMatch(config.ai.demoReason, /GROK_API_KEY/);
});

test('xAI Grok defaults remain unchanged', () => {
  const config = loadConfig({ ...baseEnv, AI_PROVIDER: 'grok', GROK_API_KEY: 'xai-test-key' });

  assert.equal(config.ai.demoMode, false);
  assert.equal(config.ai.baseUrl, 'https://api.x.ai/v1');
  assert.equal(config.ai.model, 'grok-4.7');
  assert.equal(publicAiStatus(config).provider, 'xAI Grok');
});

test('custom OpenAI-compatible providers must declare a base URL and model', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'test-key' }),
    /AI_BASE_URL and AI_MODEL/
  );
});

test('provider and base URL mismatches are rejected', () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        AI_PROVIDER: 'groq',
        GROQ_API_KEY: 'test-groq-key',
        AI_BASE_URL: 'https://api.x.ai/v1',
      }),
    /cannot use the xAI base URL/
  );
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        AI_PROVIDER: 'grok',
        GROK_API_KEY: 'test-xai-key',
        AI_BASE_URL: 'https://api.groq.com/openai/v1',
      }),
    /cannot use the Groq base URL/
  );
});
