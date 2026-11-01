import {
  api,
  escapeHtml,
  emptyState,
  formatChip,
  relativeTime,
  SIDE_LABELS,
  categoryChip,
  modeChip,
  icons,
  toast,
} from './core.js';
import { mountShell, demoBanner, liveBanner } from './shell.js';
import { sparkline, donut } from './charts.js';

const shell = await mountShell({
  page: 'dashboard',
  title: 'Dashboard',
  subtitle: 'Your reports, cases, and activity',
  actionsHtml: '<a class="btn btn-secondary btn-sm" href="/analyzer.html">Analyze a speech</a>',
});

if (shell) {
  const { user, meta, stats } = shell;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = user.displayName || user.email.split('@')[0];
  document.getElementById('welcomeHeading').textContent = `${greeting}, ${name}.`;
  document.getElementById('welcomeSub').textContent = stats?.totals?.analyses
    ? `${stats.totals.analyses} report${stats.totals.analyses === 1 ? '' : 's'} across ${stats.totals.cases} case${stats.totals.cases === 1 ? '' : 's'}.`
    : 'Start with one speech. The report will show you where the reasoning is weak.';

  const demoSlot = document.getElementById('demoSlot');
  demoSlot.innerHTML = meta.ai.mode === 'demo' ? demoBanner(meta) : liveBanner(meta);

  renderStats(stats, meta);
  renderFormats(meta);
  await loadRecent();
  await loadCases();
  renderTrend(stats);
  renderMix(stats);
}

function renderStats(stats, meta) {
  const totals = stats?.totals ?? { analyses: 0, cases: 0, critical: 0, strengths: 0 };
  const cards = [
    { label: 'Reports', value: totals.analyses, hint: 'Reports stored' },
    { label: 'Cases', value: totals.cases, hint: 'Saved cases' },
    { label: 'Critical findings', value: totals.critical, hint: 'Across all reports' },
    { label: 'Strengths', value: totals.strengths, hint: 'Worth keeping' },
  ];
  document.getElementById('statsRow').innerHTML = cards.map((card) => `
    <div class="kpi">
      <span class="kpi__value">${Number(card.value) || 0}</span>
      <span class="kpi__label">${escapeHtml(card.label)}</span>
      <span class="tiny muted">${escapeHtml(card.hint)}</span>
    </div>`).join('') + `
    <div class="kpi" style="background:rgba(59,130,246,.07);border-color:rgba(59,130,246,.3)">
      <span class="kpi__label">Mode</span>
      <span style="font-size:.95rem;font-weight:600;margin-top:4px">${meta.ai.mode === 'demo' ? 'Demo checker' : 'Live AI'}</span>
      <span class="tiny muted">${escapeHtml(meta.ai.mode === 'demo' ? 'No AI key configured' : (meta.ai.model || 'configured model'))}</span>
    </div>`;
}

function renderFormats(meta) {
  const grid = document.getElementById('formatGrid');
  grid.innerHTML = meta.formats.map((format) => `
    <a class="format-card" href="/analyzer.html?format=${encodeURIComponent(format.id)}">
      <span class="format-card__abbr">${escapeHtml(format.abbreviation.toUpperCase())}</span>
      <h4>${escapeHtml(format.name)}</h4>
      <p>${escapeHtml(format.tagline)}</p>
    </a>`).join('');
}

async function loadRecent() {
  const container = document.getElementById('recentList');
  container.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    const { analyses } = await api.get('/api/analyses?limit=6');
    if (!analyses.length) {
      container.innerHTML = emptyState({
        title: 'No analyses yet',
        message: 'Paste a speech into the analyzer to get a report.',
        action: '<a class="btn btn-primary btn-sm" href="/analyzer.html">Start a new analysis</a>',
      });
      return;
    }
    container.innerHTML = `<div class="list">${analyses.map((entry) => {
      const counts = entry.counts || {};
      const critical = counts.critical || 0;
      return `<a class="list__item" href="/report.html?id=${entry.id}">
        <div class="list__main">
          <div class="list__title">${escapeHtml(entry.speechTitle || entry.resolution)}</div>
          <div class="list__meta">
            ${formatChip(entry.format)}
            <span>${escapeHtml(entry.speechType)}</span>
            <span>·</span>
            <span>${escapeHtml(relativeTime(entry.createdAt))}</span>
            ${entry.isDemo ? '<span class="chip chip-demo">Demo</span>' : ''}
          </div>
        </div>
        <div class="list__side">${critical ? `<span class="chip chip-critical">${critical} critical</span>` : `<span class="chip chip-strength">${counts.findings || 0} findings</span>`}</div>
      </a>`;
    }).join('')}</div>`;
  } catch (error) {
    container.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'Could not load recent analyses.')}</span></div>`;
  }
}

async function loadCases() {
  const container = document.getElementById('casesList');
  container.innerHTML = '<div class="skeleton" style="height:110px"></div>';
  try {
    const { cases } = await api.get('/api/cases?limit=4');
    if (!cases.length) {
      container.innerHTML = emptyState({
        title: 'No saved cases',
        message: 'Save a resolution, side and contentions so you can attach speeches and revisit analyses.',
        action: '<a class="btn btn-secondary btn-sm" href="/cases.html">Create a case</a>',
      });
      return;
    }
    container.innerHTML = `<div class="list">${cases.map((entry) => `
      <a class="list__item" href="/cases.html?open=${entry.id}">
        <div class="list__main">
          <div class="list__title">${escapeHtml(entry.title)}</div>
          <div class="list__meta">
            ${formatChip(entry.format)}
            <span>${escapeHtml(SIDE_LABELS[entry.side] || entry.side)}</span>
            <span>·</span>
            <span>${entry.speechCount} speech${entry.speechCount === 1 ? '' : 'es'}</span>
            <span>·</span>
            <span>${entry.analysisCount} report${entry.analysisCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div class="list__side">${escapeHtml(relativeTime(entry.updatedAt))}</div>
      </a>`).join('')}</div>`;
  } catch (error) {
    container.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'Could not load saved cases.')}</span></div>`;
  }
}

function renderTrend(stats) {
  const points = stats?.trend ?? [];
  const map = new Map(points.map((point) => [point.day, point.count]));
  const series = [];
  for (let index = 13; index >= 0; index -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - index);
    const key = day.toISOString().slice(0, 10);
    series.push({ day: key, count: map.get(key) || 0 });
  }
  const total = series.reduce((sum, point) => sum + point.count, 0);
  document.getElementById('trendChart').innerHTML = `
    <div class="row-between" style="margin-bottom:10px">
      <span class="small muted">Volume</span>
      <span class="small">${total} in 14 days</span>
    </div>
    ${sparkline(series, { width: 420, height: 100 })}
    <div class="row-between tiny muted" style="margin-top:6px">
      <span>${escapeHtml(series[0].day.slice(5))}</span>
      <span>${escapeHtml(series[series.length - 1].day.slice(5))}</span>
    </div>`;
}

function renderMix(stats) {
  const colors = {
    critical: '#f87171',
    moderate: '#f59e0b',
    minor: '#94a3b8',
    improvement: '#60a5fa',
    strength: '#34d399',
  };
  const labels = { critical: 'Critical', moderate: 'Moderate', minor: 'Minor', improvement: 'Improvement', strength: 'Strength' };
  const rows = stats?.byCategory ?? [];
  const segments = rows.map((row) => ({
    label: labels[row.category] || row.category,
    value: row.count,
    color: colors[row.category] || '#94a3b8',
  }));
  document.getElementById('findingsMix').innerHTML = donut(segments);
  if (segments.length === 0) {
    document.getElementById('findingsMix').innerHTML = '<p class="small muted">No findings yet. Analyze a speech to fill this chart.</p>';
  }
}
