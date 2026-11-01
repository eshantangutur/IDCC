import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { ApiError, unauthorized } from '../utils/errors.js';
import { email as validateEmail, password as validatePassword, optionalString, requiredString } from '../utils/validate.js';
import { requireAuth, publicUser } from '../middleware/auth.js';
import { destroyUserSessions } from '../database/session-store.js';
import { issueCsrfToken } from '../middleware/csrf.js';

export function createAuthRouter({ db, config, logger }) {
  const router = Router();
  const dummyHash = bcrypt.hashSync(randomBytes(18).toString('hex'), config.bcryptRounds);

  const regenerateSession = (req) =>
    new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
  const saveSession = (req) =>
    new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
  const destroySession = (req) =>
    new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));

  function loadUser(userId) {
    return db.get('SELECT id, email, display_name, created_at FROM users WHERE id = ?', userId);
  }

  function clearAuthCookies(res) {
    res.clearCookie(config.session.name, { path: '/' });
    res.clearCookie('af.csrf', { path: '/' });
  }

  router.post('/register', async (req, res) => {
    const email = validateEmail(req.body?.email);
    const password = validatePassword(req.body?.password);
    const displayName = optionalString(req.body?.displayName ?? req.body?.display_name, 'Name', { max: 80 });

    const existing = db.get('SELECT id FROM users WHERE email = ?', email);
    if (existing) throw new ApiError(409, 'An account with that email already exists.', 'email_taken');

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    let result;
    try {
      result = db.run(
        'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)',
        email,
        passwordHash,
        displayName
      );
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error.message || '')) {
        throw new ApiError(409, 'An account with that email already exists.', 'email_taken');
      }
      throw error;
    }

    await regenerateSession(req);
    req.session.userId = result.lastInsertRowid;
    req.session.csrfToken = randomBytes(32).toString('hex');
    await saveSession(req);
    issueCsrfToken(res, config, req.session.csrfToken);

    const user = loadUser(result.lastInsertRowid);
    logger.info('User registered', { userId: user.id });
    res.status(201).json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  });

  router.post('/login', async (req, res) => {
    const email = validateEmail(req.body?.email);
    const password = requiredString(req.body?.password, 'Password', { min: 1, max: 200 });

    const user = db.get('SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = ?', email);
    const valid = await bcrypt.compare(password, user?.password_hash ?? dummyHash);

    if (!user || !valid) {
      logger.warn('Failed login attempt', { userId: user?.id ?? null });
      throw unauthorized('Invalid email or password.');
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.csrfToken = randomBytes(32).toString('hex');
    await saveSession(req);
    issueCsrfToken(res, config, req.session.csrfToken);

    res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  });

  router.post('/logout', async (req, res) => {
    if (req.session) {
      const userId = req.session.userId ?? null;
      await destroySession(req);
      if (userId) logger.info('User signed out', { userId });
    }
    clearAuthCookies(res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: { message: 'Not signed in.', code: 'unauthenticated' } });
    }
    const user = loadUser(req.session.userId);
    if (!user) {
      return req.session.destroy(() => {
        res.status(401).json({ error: { message: 'Session expired. Sign in again.', code: 'unauthenticated' } });
      });
    }
    res.json({ user: publicUser(user), csrfToken: req.session.csrfToken ?? null });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const currentPassword = requiredString(req.body?.currentPassword, 'Current password', { min: 1, max: 200 });
    const newPassword = validatePassword(req.body?.newPassword, { field: 'New password' });

    const stored = db.get('SELECT id, password_hash FROM users WHERE id = ?', req.user.id);
    if (!stored) throw unauthorized();

    const valid = await bcrypt.compare(currentPassword, stored.password_hash);
    if (!valid) throw new ApiError(400, 'Your current password is incorrect.', 'invalid_credentials');

    if (currentPassword === newPassword) {
      throw new ApiError(400, 'Choose a new password that differs from your current one.', 'password_reused');
    }

    const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    db.run(
      "UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      passwordHash,
      req.user.id
    );

    const currentSid = req.sessionID;
    destroyUserSessions(db, req.user.id, currentSid);
    await regenerateSession(req);
    req.session.userId = req.user.id;
    req.session.csrfToken = randomBytes(32).toString('hex');
    await saveSession(req);
    issueCsrfToken(res, config, req.session.csrfToken);

    logger.info('Password changed', { userId: req.user.id });
    res.json({ ok: true, csrfToken: req.session.csrfToken });
  });

  router.delete('/account', requireAuth, async (req, res) => {
    const password = requiredString(req.body?.password, 'Password', { min: 1, max: 200 });
    const stored = db.get('SELECT id, password_hash FROM users WHERE id = ?', req.user.id);
    if (!stored) throw unauthorized();

    const valid = await bcrypt.compare(password, stored.password_hash);
    if (!valid) throw new ApiError(400, 'Password confirmation failed.', 'invalid_credentials');

    db.run('DELETE FROM users WHERE id = ?', req.user.id);
    logger.info('Account deleted', { userId: req.user.id });

    if (req.session) await destroySession(req);
    clearAuthCookies(res);
    res.json({ ok: true });
  });

  return router;
}
