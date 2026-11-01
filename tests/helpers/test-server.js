import { once } from 'node:events';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/utils/logger.js';

export class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  storeCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      if (separator === -1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, path, body, { csrf = true, headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    if (csrf) {
      const token = this.cookies.get('af.csrf');
      if (token) requestHeaders['x-csrf-token'] = decodeURIComponent(token);
    }
    if (this.cookies.size > 0) requestHeaders.cookie = this.cookieHeader();

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    this.storeCookies(response);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }

  async postForm(path, formData, { csrf = true, headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (csrf) {
      const token = this.cookies.get('af.csrf');
      if (token) requestHeaders['x-csrf-token'] = decodeURIComponent(token);
    }
    if (this.cookies.size > 0) requestHeaders.cookie = this.cookieHeader();

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: requestHeaders,
      body: formData,
      redirect: 'manual',
    });

    this.storeCookies(response);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }

  get(path, options) {
    return this.request('GET', path, undefined, options);
  }

  post(path, body, options) {
    return this.request('POST', path, body, options);
  }

  put(path, body, options) {
    return this.request('PUT', path, body, options);
  }

  delete(path, body, options) {
    return this.request('DELETE', path, body, options);
  }
}

export async function startTestServer(overrides = {}) {
  const config = loadConfig(
    { NODE_ENV: 'test' },
    {
      databasePath: ':memory:',
      session: { secret: 'test-session-secret-0123456789abcdef', cookieSecure: false },
      rateLimits: { globalMax: 100000, authMax: 10000, aiMax: 10000 },
      ai: { demoMode: true, provider: 'demo', demoReason: 'Automated tests run in demo mode.' },
      ...overrides,
    }
  );

  const logger = createLogger({ level: 'silent' });
  const app = createApp({ config, logger });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  return {
    app,
    config,
    db: app.locals.db,
    baseUrl: `http://127.0.0.1:${port}`,
    client() {
      return new TestClient(this.baseUrl);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
    },
  };
}
