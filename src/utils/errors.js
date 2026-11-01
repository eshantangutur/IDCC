export class ApiError extends Error {
  constructor(status, message, code = 'error', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class AiUnavailableError extends ApiError {
  constructor(message, details = null) {
    super(502, message, 'ai_unavailable', details);
    this.retryable = true;
  }
}

export class AiResponseError extends ApiError {
  constructor(message, details = null) {
    super(502, message, 'ai_invalid_response', details);
    this.retryable = true;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, 'invalid_request', details);
export const unauthorized = (message = 'You must be signed in to do that.') => new ApiError(401, message, 'unauthenticated');
export const forbidden = (message = 'You do not have access to that resource.') => new ApiError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new ApiError(404, message, 'not_found');
