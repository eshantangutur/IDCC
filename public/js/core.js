/* Shared client utilities: API access, formatting, toasts, modals. */
import './theme.js';

const ICON_PATHS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  check: '<path d="m20 6-11 11L4 12"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  scale: '<path d="M12 3v18M5 7h14"/><path d="m5 7-3 7h6zM19 7l-3 7h6z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
  spark: '<path d="M4 4h7v7H4z"/><path d="M13 13h7v7h-7z"/><path d="M11 7.5h4.5A1.5 1.5 0 0 1 17 9v4"/>',
  lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};

export const icons = Object.fromEntries(
  Object.entries(ICON_PATHS).map(([name, path]) => [
    name,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`,
  ])
);

export const FORMAT_NAMES = {
  pf: 'Public Forum',
  ld: 'Lincoln-Douglas',
  policy: 'Policy Debate',
  congress: 'Congressional Debate',
  wsd: 'World Schools Debate',
};

export const FORMAT_ABBR = { pf: 'PF', ld: 'LD', policy: 'POLICY', congress: 'CONGRESS', wsd: 'WSD' };

export const CATEGORY_META = {
  critical: { label: 'Critical', heading: 'Critical weaknesses', hint: 'Failures an opponent can win on directly.' },
  moderate: { label: 'Moderate', heading: 'Moderate weaknesses', hint: 'Real weaknesses that cost credibility or leave an argument incomplete.' },
  minor: { label: 'Minor', heading: 'Minor weaknesses', hint: 'Small issues worth fixing in the next revision.' },
  improvement: { label: 'Improvement', heading: 'Potential improvements', hint: 'Optional upside, not a flaw in the current speech.' },
  strength: { label: 'Strength', heading: 'Strong components', hint: 'What is working and should be preserved.' },
};

export const WEAKNESS_LABELS = {
  factual_inaccuracy: 'Factual inaccuracy',
  missing_evidence: 'Missing evidence',
  logical_weakness: 'Logical weakness',
  structural_weakness: 'Structural weakness',
  framework_weakness: 'Framework weakness',
  weighing_weakness: 'Weighing weakness',
  strategic_judgment: 'Strategic judgment',
  clarity: 'Clarity',
};

export const SIDE_LABELS = {
  pro: 'Pro',
  con: 'Con',
  affirmative: 'Affirmative',
  negative: 'Negative',
  proposition: 'Proposition',
  opposition: 'Opposition',
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readCookie(name) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) return decodeURIComponent(entry.slice(prefix.length));
  }
  return null;
}

async function request(method, path, body, { timeout = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = readCookie('af.csrf');
    if (csrf && method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrf;

    const response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const error = new Error(data?.error?.message || `Request failed with status ${response.status}.`);
      error.status = response.status;
      error.code = data?.error?.code;
      error.details = data?.error?.details;
      error.retryable = Boolean(data?.error?.retryable);
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('The request timed out. Check your connection and try again.');
      timeoutError.code = 'timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  request,
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body ?? {}, options),
  put: (path, body, options) => request('PUT', path, body ?? {}, options),
  delete: (path, body, options) => request('DELETE', path, body ?? {}, options),
};

let metaCache = null;
export function loadMeta() {
  if (!metaCache) {
    metaCache = api.get('/api/meta').catch((error) => {
      metaCache = null;
      throw error;
    });
  }
  return metaCache;
}

export function formatDate(value, { time = true } = {}) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  if (time) {
    options.hour = 'numeric';
    options.minute = '2-digit';
  }
  return date.toLocaleString(undefined, options);
}

export function relativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value, { time: false });
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

export function param(name, fallback = null) {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

export function categoryChip(category) {
  const meta = CATEGORY_META[category] || CATEGORY_META.moderate;
  return `<span class="chip chip-${escapeHtml(category)}">${escapeHtml(meta.label)}</span>`;
}

export function weaknessChip(type) {
  return `<span class="chip">${escapeHtml(WEAKNESS_LABELS[type] || type || 'Observation')}</span>`;
}

export function modeChip(mode) {
  return mode === 'demo'
    ? '<span class="chip chip-demo">Demo</span>'
    : '<span class="chip chip-live">Live AI</span>';
}

export function formatChip(format) {
  return `<span class="chip chip-format">${escapeHtml(FORMAT_ABBR[format] || format)}</span>`;
}

export function spinnerHtml(large = false) {
  return `<span class="spinner ${large ? 'spinner--lg' : ''}" aria-hidden="true"></span>`;
}

export function emptyState({ title, message, action = '' }) {
  return `<div class="empty">
    ${icons.file}
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    ${action}
  </div>`;
}

export function setButtonLoading(button, loading, loadingLabel = 'Working...') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${spinnerHtml()}<span>${escapeHtml(loadingLabel)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

let toastStack = null;
export function toast(message, type = 'info', { duration = 4200 } = {}) {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('role', 'status');
    toastStack.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastStack);
  }
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.innerHTML = `${icons[iconName]}<span>${escapeHtml(message)}</span>`;
  toastStack.appendChild(element);
  const remove = () => element.remove();
  setTimeout(remove, duration);
  element.addEventListener('click', remove);
}

export function openModal({ title, body = '', footer = '', wide = false, onClose = null }) {
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal__head">
      <h2 id="modalTitle">${escapeHtml(title)}</h2>
      <button class="modal__close" type="button" aria-label="Close dialog">${icons.x}</button>
    </div>
    <div class="modal__body"></div>
    ${footer ? '<div class="modal__actions"></div>' : ''}
  </div>`;

  const modal = backdrop.querySelector('.modal');
  const bodyElement = backdrop.querySelector('.modal__body');
  if (body instanceof Node) bodyElement.appendChild(body);
  else bodyElement.innerHTML = body;

  const footerElement = backdrop.querySelector('.modal__actions');
  if (footerElement) {
    if (footer instanceof Node) footerElement.appendChild(footer);
    else footerElement.innerHTML = footer;
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    onClose?.();
  }

  backdrop.querySelector('.modal__close').addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(backdrop);

  const focusable = modal.querySelector('input, select, textarea, button:not(.modal__close)');
  focusable?.focus();

  return { root: modal, body: bodyElement, footer: footerElement, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = openModal({
      title,
      body: `<p class="muted" style="font-size:.9rem">${escapeHtml(message)}</p>`,
      footer: `<button type="button" class="btn btn-secondary" data-cancel>${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmLabel)}</button>`,
      onClose: () => finish(false),
    });
    dialog.footer.querySelector('[data-cancel]').addEventListener('click', () => {
      finish(false);
      dialog.close();
    });
    dialog.footer.querySelector('[data-confirm]').addEventListener('click', () => {
      finish(true);
      dialog.close();
    });
  });
}

export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function highlightPassage(text, passage) {
  const safeText = escapeHtml(text);
  if (!passage) return safeText;
  const normalized = String(passage).replace(/\s+/g, ' ').trim();
  const index = String(text).indexOf(normalized.slice(0, 90));
  if (index === -1) return safeText;
  const before = escapeHtml(String(text).slice(0, index));
  const match = escapeHtml(String(text).slice(index, index + Math.min(normalized.length, 600)));
  const after = escapeHtml(String(text).slice(index + Math.min(normalized.length, 600)));
  return `${before}<mark>${match}</mark>${after}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}
