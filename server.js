import 'dotenv/config';
import { loadConfig } from './src/config.js';
import { createApp } from './src/app.js';
import { createLogger } from './src/utils/logger.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  if (process.env.VERCEL !== '1') process.exit(1);
  throw error;
}

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

// Vercel imports this module and uses the default export as the function handler.
export default app;

if (process.env.VERCEL !== '1') {
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
      await app.locals.db.close();
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
