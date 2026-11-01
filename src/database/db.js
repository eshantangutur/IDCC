import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema.js';

function normalizeParams(params) {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return param;
  });
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeValue(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

function rowFromResult(result, index = 0) {
  const row = result.rows[index];
  if (!row) return null;
  const columns = result.columns?.length ? result.columns : Object.keys(row);
  const output = {};
  for (const column of columns) output[column] = normalizeValue(row[column]);
  return output;
}

function rowsFromResult(result) {
  return result.rows.map((_, index) => rowFromResult(result, index));
}

function metaFromResult(result) {
  return {
    changes: toNumber(result.rowsAffected, 0),
    lastInsertRowid: toNumber(result.lastInsertRowid, 0),
  };
}

/**
 * Wrap a remote libSQL executor with the same small surface the application
 * uses for local SQLite. Turso is only loaded when a remote URL is configured,
 * which keeps native SQLite out of the Vercel function bundle.
 */
function remoteExecutor(executor) {
  async function execute(sql, params) {
    return executor.execute({ sql, args: normalizeParams(params) });
  }

  return {
    async run(sql, ...params) {
      return metaFromResult(await execute(sql, params));
    },
    async get(sql, ...params) {
      return rowFromResult(await execute(sql, params));
    },
    async all(sql, ...params) {
      return rowsFromResult(await execute(sql, params));
    },
  };
}

async function createRemoteDatabase({ url, authToken, logger }) {
  const { createClient } = await import('@tursodatabase/serverless/compat');
  const client = createClient({ url, authToken });
  const base = remoteExecutor(client);

  try {
    await client.execute('PRAGMA foreign_keys = ON');
  } catch (error) {
    logger?.warn('Remote foreign key enforcement could not be enabled', { error: error.message });
  }

  await client.executeMultiple(SCHEMA_SQL);

  async function cleanupExpiredSessions() {
    try {
      const result = await base.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      if (result.changes > 0) logger?.debug('Purged expired sessions', { count: result.changes });
    } catch (error) {
      logger?.warn('Session cleanup failed', { error: error.message });
    }
  }

  await cleanupExpiredSessions();
  const cleanupTimer = setInterval(cleanupExpiredSessions, 15 * 60 * 1000);
  cleanupTimer.unref?.();

  async function transaction(fn) {
    const tx = await client.transaction('write');
    const scoped = remoteExecutor(tx);
    try {
      const result = await fn(scoped);
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {
        /* rollback is best effort */
      }
      throw error;
    } finally {
      try {
        tx.close();
      } catch {
        /* already closed */
      }
    }
  }

  return {
    raw: client,
    filename: url,
    ...base,
    transaction,
    async close() {
      clearInterval(cleanupTimer);
      try {
        client.close();
      } catch {
        /* already closed */
      }
    },
  };
}

async function createLocalDatabase({ filename, logger }) {
  const { DatabaseSync } = await import('node:sqlite');
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  if (filename !== ':memory:') {
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA synchronous = NORMAL');
  }
  raw.exec(SCHEMA_SQL);

  const statementCache = new Map();

  function prepare(sql) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = raw.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  }

  async function run(sql, ...params) {
    const result = prepare(sql).run(...normalizeParams(params));
    return {
      changes: toNumber(result.changes, 0),
      lastInsertRowid: toNumber(result.lastInsertRowid, 0),
    };
  }

  async function get(sql, ...params) {
    return prepare(sql).get(...normalizeParams(params)) ?? null;
  }

  async function all(sql, ...params) {
    return prepare(sql).all(...normalizeParams(params));
  }

  async function transaction(fn) {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn({ run, get, all });
      raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        raw.exec('ROLLBACK');
      } catch {
        /* rollback is best effort */
      }
      throw error;
    }
  }

  async function cleanupExpiredSessions() {
    try {
      const result = await run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      if (result.changes > 0) logger?.debug('Purged expired sessions', { count: result.changes });
    } catch (error) {
      logger?.warn('Session cleanup failed', { error: error.message });
    }
  }

  await cleanupExpiredSessions();
  const cleanupTimer = setInterval(cleanupExpiredSessions, 15 * 60 * 1000);
  cleanupTimer.unref?.();

  return {
    raw,
    filename,
    run,
    get,
    all,
    transaction,
    async close() {
      clearInterval(cleanupTimer);
      try {
        raw.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * Remote libSQL (Turso) is used when a database URL is configured. Otherwise
 * the app uses a local SQLite file, which is what tests and local development
 * rely on.
 */
export async function createDatabase({ config, logger }) {
  if (config.databaseUrl) {
    if (!config.databaseAuthToken) {
      throw new Error('TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set.');
    }
    logger?.info('Using remote libSQL storage');
    return createRemoteDatabase({
      url: config.databaseUrl,
      authToken: config.databaseAuthToken,
      logger,
    });
  }

  logger?.info('Using local SQLite storage', { path: config.databasePath });
  return createLocalDatabase({ filename: config.databasePath, logger });
}
