const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/**
 * Minimal structured logger. Callers pass opaque metadata only; request bodies,
 * passwords, session ids and API keys must never be logged.
 */
export function createLogger({ level = 'info' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, message, meta) {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    const line = {
      level: lvl,
      time: new Date().toISOString(),
      message,
      ...(meta && typeof meta === 'object' ? meta : {}),
    };
    const target = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    target(JSON.stringify(line));
  }

  return {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
  };
}
