import session from 'express-session';

/**
 * Persistent SQLite session store backed by the `sessions` table.
 * Session payloads are stored as JSON and expire alongside the cookie.
 */
export function createSqliteSessionStore({ db, defaultTtlMs }) {
  class SqliteSessionStore extends session.Store {
    async get(sid, callback) {
      try {
        const row = await db.get('SELECT data, expires_at FROM sessions WHERE sid = ?', sid);
        if (!row) return callback(null, null);
        if (row.expires_at < Date.now()) {
          await db.run('DELETE FROM sessions WHERE sid = ?', sid);
          return callback(null, null);
        }
        callback(null, JSON.parse(row.data));
      } catch (error) {
        callback(error);
      }
    }

    async set(sid, sessionData, callback) {
      try {
        const expiresAt = sessionData?.cookie?.expires
          ? Date.parse(sessionData.cookie.expires)
          : Date.now() + defaultTtlMs;
        await db.run(
          `INSERT INTO sessions (sid, user_id, data, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             user_id = excluded.user_id,
             data = excluded.data,
             expires_at = excluded.expires_at`,
          sid,
          Number.isInteger(sessionData?.userId) ? sessionData.userId : null,
          JSON.stringify(sessionData),
          Number.isFinite(expiresAt) ? expiresAt : Date.now() + defaultTtlMs
        );
        callback(null);
      } catch (error) {
        callback(error);
      }
    }

    async touch(sid, sessionData, callback) {
      try {
        const expiresAt = sessionData?.cookie?.expires
          ? Date.parse(sessionData.cookie.expires)
          : Date.now() + defaultTtlMs;
        await db.run('UPDATE sessions SET expires_at = ? WHERE sid = ?', expiresAt, sid);
        callback(null);
      } catch (error) {
        callback(error);
      }
    }

    async destroy(sid, callback) {
      try {
        await db.run('DELETE FROM sessions WHERE sid = ?', sid);
        callback(null);
      } catch (error) {
        callback(error);
      }
    }

    async length(callback) {
      try {
        const row = await db.get('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?', Date.now());
        callback(null, row?.count ?? 0);
      } catch (error) {
        callback(error);
      }
    }

    async clear(callback) {
      try {
        await db.run('DELETE FROM sessions');
        callback(null);
      } catch (error) {
        callback(error);
      }
    }
  }

  return new SqliteSessionStore();
}

export async function destroyUserSessions(db, userId, exceptSid = null) {
  if (exceptSid) {
    const result = await db.run('DELETE FROM sessions WHERE user_id = ? AND sid != ?', userId, exceptSid);
    return result.changes;
  }
  const result = await db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  return result.changes;
}
