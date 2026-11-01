import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { ApiError } from '../utils/errors.js';

export function securityHeaders(config) {
  const directives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    scriptSrc: ["'self'"],
    // Inline style attributes are used for layout (for example chart colours),
    // but inline scripts remain forbidden, which is the meaningful XSS boundary.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    scriptSrcAttr: ["'none'"],
  };

  if (config.isProduction) directives.upgradeInsecureRequests = [];

  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
  });
}

/**
 * Restrict browser cross-origin access to the app's own origin and any
 * explicitly configured trusted origins.
 */
export function corsMiddleware(config) {
  const allowed = new Set(config.allowedOrigins);

  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();

    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === req.get('host');
    } catch {
      sameOrigin = false;
    }

    if (!sameOrigin && !allowed.has(origin)) {
      if (req.method === 'OPTIONS') return res.status(403).end();
      return next(new ApiError(403, 'This origin is not allowed to call the API.', 'origin_forbidden'));
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-csrf-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

const limitHandler = (req, res) => {
  res.status(429).json({
    error: {
      message: 'Too many requests. Please wait a moment and try again.',
      code: 'rate_limited',
    },
  });
};

export function createRateLimiters(config) {
  const base = {
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: limitHandler,
    validate: { xForwardedForHeader: false },
  };

  const globalLimiter = rateLimit({
    ...base,
    windowMs: config.rateLimits.globalWindowMs,
    limit: config.rateLimits.globalMax,
  });

  const authLimiter = rateLimit({
    ...base,
    windowMs: config.rateLimits.authWindowMs,
    limit: config.rateLimits.authMax,
    skipSuccessfulRequests: true,
  });

  const userOrIpKey = (req) =>
    req.session?.userId ? `user:${req.session.userId}` : `ip:${ipKeyGenerator(req.ip)}`;

  const aiLimiter = rateLimit({
    ...base,
    windowMs: config.rateLimits.aiWindowMs,
    limit: config.rateLimits.aiMax,
    keyGenerator: userOrIpKey,
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  });

  const fileLimiter = rateLimit({
    ...base,
    windowMs: config.rateLimits.fileWindowMs,
    limit: config.rateLimits.fileMax,
    keyGenerator: userOrIpKey,
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  });

  return { globalLimiter, authLimiter, aiLimiter, fileLimiter };
}
