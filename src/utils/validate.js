import { badRequest } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function requiredString(value, field, { min = 1, max = 5000 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} is required.`, { field });
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw badRequest(
      min === 1 ? `${field} is required.` : `${field} must be at least ${min} characters.`,
      { field }
    );
  }
  if (trimmed.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`, { field });
  return trimmed;
}

export function optionalString(value, field, { max = 5000 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`, { field });
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`, { field });
  return trimmed;
}

export function email(value) {
  const raw = requiredString(value, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(raw)) throw badRequest('Enter a valid email address.', { field: 'email' });
  return raw;
}

export function password(value, { field = 'Password' } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} is required.`, { field: 'password' });
  if (value.length < 10) throw badRequest(`${field} must be at least 10 characters.`, { field: 'password' });
  if (value.length > 200) throw badRequest(`${field} must be 200 characters or fewer.`, { field: 'password' });
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw badRequest(`${field} must include at least one letter and one number.`, { field: 'password' });
  }
  return value;
}

export function enumValue(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, { field });
  }
  return value;
}

export function idParam(value, field = 'id') {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  const raw = String(value ?? '');
  if (!/^\d{1,12}$/.test(raw) || Number(raw) <= 0) throw badRequest(`Invalid ${field}.`, { field });
  return Number(raw);
}

export function optionalId(value, field = 'id') {
  if (value === undefined || value === null || value === '') return null;
  return idParam(value, field);
}

export function ensureArray(value, field, { max = 50 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be a list.`, { field });
  if (value.length > max) throw badRequest(`${field} may contain at most ${max} items.`, { field });
  return value;
}
