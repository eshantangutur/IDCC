import 'dotenv/config';
import express from 'express';

const app = express();
let appPromise = null;

async function buildApp() {
  const [{ loadConfig }, { createApp }, { createLogger }] = await Promise.all([
    import('./src/config.js'),
    import('./src/app.js'),
    import('./src/utils/logger.js'),
  ]);

  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  if (config.session.usingDevSecret) {
    logger.warn('SESSION_SECRET is not set. A development-only secret is in use; set one before deploying.');
  }

  if (config.ai.demoMode) {
    logger.warn('AI demo mode is active', { reason: config.ai.demoReason });
  } else {
    logger.info('Live AI analysis enabled', { provider: config.ai.provider, model: config.ai.model });
  }

  const app = await createApp({ config, logger });
  return { app, config, logger };
}

function getApp() {
  if (!appPromise) {
    appPromise = buildApp().catch((error) => {
      // Do not cache a failed startup forever. A later request can retry after
      // a transient database problem, while configuration errors stay visible.
      appPromise = null;
      throw error;
    });
  }
  return appPromise;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(TURSO_AUTH_TOKEN|SESSION_SECRET|AI_API_KEY|GROQ_API_KEY|GROK_API_KEY|XAI_API_KEY)=\S+/gi, '$1=[redacted]');
}

function sendStartupError(req, res, error) {
  const message = safeErrorMessage(error);
  const code = error?.code || 'startup_failed';
  const wantsHtml = String(req.headers?.accept || '').includes('text/html');

  console.error(
    JSON.stringify({
      level: 'error',
      time: new Date().toISOString(),
      message: 'Application startup failed',
      error: message,
      code,
    })
  );

  res.statusCode = 503;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', wantsHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8');

  if (wantsHtml) {
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Argument Forensics setup required</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 680px; margin: 48px auto; padding: 0 20px; line-height: 1.55; color: #151515; }
    h1 { font-size: 28px; }
    code { background: #f1f1f1; padding: 2px 5px; border-radius: 4px; }
    pre { background: #f1f1f1; padding: 14px; overflow: auto; border-radius: 6px; white-space: pre-wrap; }
    .note { border-left: 3px solid #b42318; padding-left: 14px; }
  </style>
</head>
<body>
  <h1>Argument Forensics needs configuration</h1>
  <p class="note">The server could not start. The exact error is:</p>
  <pre>${escapeHtml(message)}</pre>
  <p>On Vercel, open <strong>Project Settings &rarr; Environment Variables</strong> and add:</p>
  <ul>
    <li><code>TURSO_DATABASE_URL</code></li>
    <li><code>TURSO_AUTH_TOKEN</code></li>
    <li><code>SESSION_SECRET</code> with at least 32 characters</li>
  </ul>
  <p>Add them to Production and Preview, then redeploy the project. The Turso integration creates the first two automatically.</p>
</body>
</html>`);
    return;
  }

  res.end(
    JSON.stringify({
      error: {
        code: 'startup_failed',
        message,
      },
    })
  );
}

// Vercel detects this file because it exports an Express app. Requests are
// delegated to the fully initialized app once configuration and storage load.
app.use(async (req, res, next) => {
  try {
    const { app: realApp, config } = await getApp();
    app.set('trust proxy', config.trustProxy);
    realApp(req, res, next);
  } catch (error) {
    sendStartupError(req, res, error);
  }
});

export default app;

async function startLocalServer() {
  const { app: realApp, config, logger } = await getApp();
  app.set('trust proxy', config.trustProxy);

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Argument Forensics listening on http://localhost:${config.port}`, {
      environment: config.env,
      database: config.databaseUrl ? 'remote libSQL' : config.databasePath,
    });
  });

  server.on('error', (error) => {
    logger.error('HTTP server error', { error: error.message });
    process.exit(1);
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await realApp.locals.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message });
  });
}

if (process.env.VERCEL !== '1') {
  startLocalServer().catch((error) => {
    console.error(`Configuration error: ${safeErrorMessage(error)}`);
    process.exit(1);
  });
}
