import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

function normalizeParams(params) {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return param;
  });
}

/**
 * Thin wrapper around Node's built-in SQLite driver. Every query in the
 * application goes through cached prepared statements with bound parameters.
 */
export function createDatabase({ filename, logger }) {
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
  raw.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const statementCache = new Map();

  function prepare(sql) {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = raw.prepare(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  }

  function run(sql, ...params) {
    const result = prepare(sql).run(...normalizeParams(params));
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowid: Number(result.lastInsertRowid ?? 0),
    };
  }

  function get(sql, ...params) {
    return prepare(sql).get(...normalizeParams(params)) ?? null;
  }

  function all(sql, ...params) {
    return prepare(sql).all(...normalizeParams(params));
  }

  function transaction(fn) {
    raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
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

  function cleanupExpiredSessions() {
    try {
      const result = run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
      if (result.changes > 0) logger?.debug('Purged expired sessions', { count: result.changes });
    } catch (error) {
      logger?.warn('Session cleanup failed', { error: error.message });
    }
  }

  cleanupExpiredSessions();
  const cleanupTimer = setInterval(cleanupExpiredSessions, 15 * 60 * 1000);
  cleanupTimer.unref?.();

  return {
    raw,
    filename,
    run,
    get,
    all,
    transaction,
    close() {
      clearInterval(cleanupTimer);
      try {
        raw.close();
      } catch {
        /* already closed */
      }
    },
  };
}
