import { api, escapeHtml } from './core.js';
import { mountThemeToggles } from './theme.js';

const navToggle = document.getElementById('navToggle');
const siteNav = document.getElementById('siteNav');

navToggle?.addEventListener('click', () => {
  const open = siteNav.classList.toggle('is-open');
  navToggle.setAttribute('aria-expanded', String(open));
});

siteNav?.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    siteNav.classList.remove('is-open');
    navToggle?.setAttribute('aria-expanded', 'false');
  }
});

const yearElement = document.getElementById('year');
if (yearElement) yearElement.textContent = String(new Date().getFullYear());

const modeLabel = document.getElementById('modeLabel');
const modeDot = document.getElementById('modeDot');

async function refreshMode() {
  try {
    const [health, meta] = await Promise.all([api.get('/api/health'), api.get('/api/meta')]);
    if (modeLabel) {
      modeLabel.textContent = health.aiMode === 'demo'
        ? 'Demo mode: no API key needed'
        : `Live AI: ${meta.ai.model || 'configured model'}`;
    }
    if (modeDot) modeDot.style.background = health.aiMode === 'demo' ? '#d97706' : '#10b981';
  } catch {
    if (modeLabel) modeLabel.textContent = 'Debate speech analysis';
  }
}

refreshMode();

// If the visitor already has a session, offer a direct route into the workspace.
(async () => {
  try {
    const session = await api.get('/api/auth/me');
    if (!session?.user) return;
    const actions = document.querySelector('.site-header__actions');
    if (!actions) return;
    actions.innerHTML = `
      <span class="chip chip-live" title="${escapeHtml(session.user.email)}">Signed in</span>
      <a class="btn btn-primary btn-sm" href="/dashboard.html">Open workspace</a>
      <button type="button" class="btn btn-ghost btn-icon theme-toggle" data-theme-toggle></button>`;
    mountThemeToggles(actions);
  } catch {
    /* anonymous visitor */
  }
})();
