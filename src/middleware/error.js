import { ApiError } from '../utils/errors.js';

export function apiNotFound(req, res) {
  res.status(404).json({
    error: {
      message: `No API route matches ${req.method} ${req.originalUrl}.`,
      code: 'not_found',
    },
  });
}

export function errorHandler(config, logger) {
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    let status = error instanceof ApiError ? error.status : 500;
    let code = error instanceof ApiError ? error.code : 'internal_error';
    let message = error instanceof ApiError ? error.message : 'Something went wrong on the server.';
    let details = error instanceof ApiError ? error.details : null;

    if (error?.type === 'entity.parse.failed') {
      status = 400;
      code = 'invalid_json';
      message = 'The request body was not valid JSON.';
    } else if (error?.type === 'entity.too.large') {
      status = 413;
      code = 'payload_too_large';
      message = 'The request body is too large.';
    } else if (error?.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(error?.message || '')) {
      status = 409;
      code = 'conflict';
      message = 'That record already exists.';
    }

    if (status >= 500) {
      logger.error('Unhandled request error', {
        method: req.method,
        path: req.path,
        error: error?.message,
        stack: config.isProduction ? undefined : error?.stack,
      });
    } else {
      logger.debug('Request rejected', { method: req.method, path: req.path, code, status });
    }

    if (res.headersSent) return res.end();

    const payload = { error: { message, code } };
    if (details) payload.error.details = details;
    if (error?.retryable) payload.error.retryable = true;

    res.status(status).json(payload);
  };
}
