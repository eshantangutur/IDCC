import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, forbidden } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfCookieOptions(config) {
  return {
    httpOnly: false,
    sameSite: config.session.sameSite,
    secure: config.session.cookieSecure,
    path: '/',
    maxAge: config.session.ttlMs,
  };
}

export function issueCsrfToken(res, config, token) {
  res.cookie('af.csrf', token, csrfCookieOptions(config));
  return token;
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function originAllowed(req, config) {
  const origin = req.get('origin');
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/**
 * Session-bound CSRF protection using the double-submit pattern:
 * the token lives in the session and is echoed through a readable cookie
 * which the client sends back in the X-CSRF-Token header.
 */
export function csrfProtection(config) {
  return (req, res, next) => {
    if (!req.session) return next(new ApiError(500, 'Session unavailable.', 'session_unavailable'));

    if (!req.session.csrfToken) {
      req.session.csrfToken = randomBytes(32).toString('hex');
    }
    issueCsrfToken(res, config, req.session.csrfToken);

    if (SAFE_METHODS.has(req.method)) return next();

    if (!originAllowed(req, config)) {
      return next(forbidden('Cross-origin request rejected.'));
    }

    const headerToken = req.get('x-csrf-token');
    const bodyToken = req.body && typeof req.body === 'object' ? req.body._csrf : null;
    const provided = headerToken || bodyToken;

    if (!tokensMatch(provided, req.session.csrfToken)) {
      return next(new ApiError(403, 'Invalid or missing CSRF token. Reload the page and try again.', 'csrf_failed'));
    }

    next();
  };
}
