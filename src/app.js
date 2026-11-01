import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { createDatabase } from './database/db.js';
import { createSqliteSessionStore } from './database/session-store.js';
import { createLogger } from './utils/logger.js';
import { securityHeaders, corsMiddleware, createRateLimiters } from './middleware/security.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiNotFound, errorHandler } from './middleware/error.js';
import { createAuthRouter } from './routes/auth.js';
import { createMetaRouter } from './routes/meta.js';
import { createCasesRouter } from './routes/cases.js';
import { createSpeechesRouter } from './routes/speeches.js';
import { createAnalysesRouter } from './routes/analyses.js';
import { createAnalyzeRouter } from './routes/analyze.js';
import { createExtractRouter } from './routes/extract.js';
import { createStatsRouter } from './routes/stats.js';
import { createAiService } from './services/ai/index.js';
import { createAnalysisService } from './services/analysis-service.js';

export function createApp({ config, logger = createLogger({ level: config.logLevel }) }) {
  const db = createDatabase({ filename: config.databasePath, logger });
  const ai = createAiService({ config, logger });
  const analysisService = createAnalysisService({ db, logger, ai });

  const app = express();
  app.locals.db = db;
  app.locals.config = config;
  app.locals.logger = logger;
  app.locals.ai = ai;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders(config));
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '300kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(cookieParser());
  app.use(
    session({
      name: config.session.name,
      secret: config.session.secret,
      store: createSqliteSessionStore({ db, defaultTtlMs: config.session.ttlMs }),
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: config.session.sameSite,
        secure: config.session.cookieSecure,
        maxAge: config.session.ttlMs,
        path: '/',
      },
    })
  );

  const { globalLimiter, authLimiter, aiLimiter, fileLimiter } = createRateLimiters(config);

  // API responses contain private data and must never be cached.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  app.use('/api', csrfProtection(config));
  app.use('/api', globalLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth/change-password', authLimiter);
  app.use('/api/analyze', aiLimiter);
  app.use('/api/extract', fileLimiter);

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      aiMode: config.ai.demoMode ? 'demo' : 'live',
      environment: config.env,
    });
  });

  app.use('/api/meta', createMetaRouter({ config }));
  app.use('/api/auth', createAuthRouter({ db, config, logger }));
  app.use('/api/cases', createCasesRouter({ db }));
  app.use('/api/speeches', createSpeechesRouter({ db, config }));
  app.use('/api/analyses', createAnalysesRouter({ db }));
  app.use('/api/analyze', createAnalyzeRouter({ config, analysisService }));
  app.use('/api/extract', createExtractRouter({ config, logger }));
  app.use('/api/stats', createStatsRouter({ db }));
  app.use('/api', apiNotFound);

  const notFoundPage = path.join(config.publicDir, '404.html');
  app.use(
    express.static(config.publicDir, {
      extensions: ['html'],
      index: 'index.html',
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use((req, res) => {
    res.status(404);
    if (fs.existsSync(notFoundPage)) return res.sendFile(notFoundPage);
    res.type('text/plain').send('Not found');
  });

  app.use(errorHandler(config, logger));

  return app;
}
