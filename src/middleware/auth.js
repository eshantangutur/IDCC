import { unauthorized } from '../utils/errors.js';

/** Rejects unauthenticated requests to protected endpoints. */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) return next(unauthorized());
  const user = req.app.locals.db.get(
    'SELECT id, email, display_name, created_at FROM users WHERE id = ?',
    req.session.userId
  );
  if (!user) {
    return req.session.destroy(() => next(unauthorized('Your session is no longer valid. Sign in again.')));
  }
  req.user = {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    createdAt: user.created_at,
  };
  next();
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.display_name ?? null,
    createdAt: user.createdAt ?? user.created_at,
  };
}
