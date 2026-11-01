/* Light/dark theme control. The initial value is applied by theme-init.js. */

const STORAGE_KEY = 'af-theme';

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';

function current() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function paint(button) {
  const light = current() === 'light';
  button.innerHTML = light ? SUN : MOON;
  const label = light ? 'Switch to dark theme' : 'Switch to light theme';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-pressed', String(light));
}

export function applyTheme(theme, { persist = true } = {}) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage can be unavailable in private modes; the theme still applies */
    }
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(paint);
}

export function mountThemeToggles(scope = document) {
  scope.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    paint(button);
    if (button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', () => {
      applyTheme(current() === 'light' ? 'dark' : 'light');
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => mountThemeToggles());
} else {
  mountThemeToggles();
}

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && (event.newValue === 'light' || event.newValue === 'dark')) {
    applyTheme(event.newValue, { persist: false });
  }
});
