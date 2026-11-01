import { api, escapeHtml, icons, loadMeta, toast } from './core.js';
import { mountThemeToggles } from './theme.js';

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { id: 'dashboard', href: '/dashboard.html', label: 'Dashboard', icon: 'grid' },
      { id: 'analyzer', href: '/analyzer.html', label: 'New analysis', icon: 'plus' },
    ],
  },
  {
    label: 'Library',
    items: [
      { id: 'cases', href: '/cases.html', label: 'Cases', icon: 'folder' },
      { id: 'history', href: '/history.html', label: 'History', icon: 'clock' },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'settings', href: '/settings.html', label: 'Settings', icon: 'settings' },
    ],
  },
];


/**
 * Renders the authenticated application shell. Redirects to the login page
 * when the session is missing or expired.
 */
export async function mountShell({ page, title, subtitle = '', actionsHtml = '' }) {
  const sidebar = document.getElementById('appSidebar');
  const topbar = document.getElementById('appTopbar');
  if (!sidebar || !topbar) throw new Error('Shell mount points are missing.');

  let session;
  let meta;
  let stats = null;
  try {
    [session, meta] = await Promise.all([api.get('/api/auth/me'), loadMeta()]);
  } catch (error) {
    if (error.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${next}`);
      return null;
    }
    throw error;
  }

  try {
    stats = await api.get('/api/stats');
  } catch {
    stats = null;
  }

  const counts = {
    cases: stats?.totals?.cases ?? null,
    analyses: stats?.totals?.analyses ?? null,
  };

  const user = session.user;
  const displayName = user.displayName || user.email.split('@')[0];

  sidebar.innerHTML = `
    <a class="brand" href="/dashboard.html" aria-label="Argument Forensics dashboard">
      <span class="brand__mark">${icons.spark}</span>
      <span>
        <span class="brand__name">Argument Forensics</span>
        <span class="brand__tag">Debate speech analysis</span>
      </span>
    </a>
    <nav class="nav" aria-label="Main navigation">
      ${NAV_GROUPS.map((group) => `
        <div class="nav__label">${escapeHtml(group.label)}</div>
        ${group.items.map((item) => `
          <a class="nav__item ${page === item.id ? 'is-active' : ''}" href="${item.href}" ${page === item.id ? 'aria-current="page"' : ''}>
            ${icons[item.icon]}<span>${item.label}</span>
            ${item.id === 'cases' && counts.cases !== null ? `<span class="nav__count">${counts.cases}</span>` : ''}
            ${item.id === 'history' && counts.analyses !== null ? `<span class="nav__count">${counts.analyses}</span>` : ''}
          </a>`).join('')}
      `).join('')}
    </nav>
    <div class="sidebar__footer">
      <div class="sidebar__user">
        <span class="sidebar__email" title="${escapeHtml(user.email)}">${escapeHtml(displayName)}</span>
        <span class="tiny muted truncate">${escapeHtml(user.email)}</span>
      </div>
      <div class="sidebar__mode">
        ${meta.ai.mode === 'demo'
          ? `<span class="chip chip-demo" title="${escapeHtml(meta.ai.reason || '')}">Demo mode</span>`
          : `<span class="chip chip-live" title="${escapeHtml(meta.ai.model || '')}">Live AI</span>`}
        <button type="button" class="btn btn-ghost btn-sm" data-logout>${icons.logout}<span>Sign out</span></button>
      </div>
      <div class="sidebar__legal">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
        <a href="/index.html#contact">Contact</a>
      </div>
    </div>`;

  topbar.innerHTML = `
    <button type="button" class="btn btn-ghost btn-icon nav-toggle" data-nav-toggle aria-label="Open navigation" aria-expanded="false">${icons.menu}</button>
    <div class="grow" style="min-width:0">
      <div class="topbar__title truncate">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="topbar__sub truncate">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <div class="topbar__actions">
      <button type="button" class="btn btn-ghost btn-icon theme-toggle" data-theme-toggle></button>
      ${actionsHtml}
    </div>`;

  mountThemeToggles(topbar);

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.dataset.navClose = '';
  document.body.appendChild(scrim);

  const toggle = topbar.querySelector('[data-nav-toggle]');
  const closeNav = () => {
    sidebar.classList.remove('is-open');
    scrim.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
  };
  toggle?.addEventListener('click', () => {
    const open = !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  scrim.addEventListener('click', closeNav);
  sidebar.querySelectorAll('.nav__item').forEach((link) => link.addEventListener('click', closeNav));

  document.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.post('/api/auth/logout');
      window.location.replace('/index.html');
    } catch (error) {
      toast(error.message || 'Could not sign out.', 'error');
      button.disabled = false;
    }
  });

  return { user, meta, stats };
}

export function demoBanner(meta) {
  if (!meta || meta.ai.mode !== 'demo') return '';
  return `<div class="banner banner--demo">
    ${icons.alert}
    <div><strong>Demo mode.</strong> No AI key is configured, so reports use the local demo checker. ${meta.ai.reason ? escapeHtml(meta.ai.reason) : 'The site owner can add a key to enable live AI.'}</div>
  </div>`;
}

export function liveBanner(meta) {
  if (!meta || meta.ai.mode !== 'live') return '';
  return `<div class="banner banner--info">
    ${icons.info}
    <div><strong>Live AI.</strong> Findings come from ${escapeHtml(meta.ai.provider)} (${escapeHtml(meta.ai.model || 'configured model')}). They can be wrong, so check each quoted passage.</div>
  </div>`;
}
