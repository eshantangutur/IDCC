import { api, emptyState, escapeHtml, formatChip, icons, relativeTime } from './core.js';
import { mountShell } from './shell.js';

const shell = await mountShell({
  page: 'maps',
  title: 'Argument maps',
  subtitle: 'Graphs from stored analyses',
});

if (shell) {
  const root = document.getElementById('mapsRoot');
  root.innerHTML = '<div class="skeleton" style="height:240px"></div>';

  try {
    const [{ analyses }, { rounds }] = await Promise.all([
      api.get('/api/analyses?limit=50'),
      api.get('/api/rounds?limit=50'),
    ]);

    const speechMaps = analyses.filter((entry) => (entry.counts?.nodes ?? 0) > 0);
    const roundMaps = rounds.filter((entry) => entry.argumentCount > 0);

    if (!speechMaps.length && !roundMaps.length) {
      root.innerHTML = emptyState({
        title: 'No graphs stored yet',
        message:
          'An argument map is created from a completed analysis. Analyse a speech, or run a round analysis once the speeches are entered.',
        action:
          '<div class="row" style="gap:8px;justify-content:center"><a class="btn btn-primary btn-sm" href="/analyzer.html">Analyze a speech</a><a class="btn btn-secondary btn-sm" href="/rounds.html">Open rounds</a></div>',
      });
    } else {
      root.innerHTML = `
        ${roundMaps.length ? section('Round graphs', 'Arguments tracked across every speech in the round.', roundMaps.map((round) => `
          <a class="list__item" href="/round.html?id=${round.id}&view=graph">
            <div class="list__main">
              <div class="list__title">${escapeHtml(round.title)}</div>
              <div class="list__meta">
                ${formatChip(round.format)}
                <span>${round.argumentCount} argument${round.argumentCount === 1 ? '' : 's'}</span>
                <span>·</span>
                <span>${round.speechCount} speech${round.speechCount === 1 ? '' : 'es'}</span>
                <span>·</span>
                <span>${escapeHtml(relativeTime(round.updatedAt))}</span>
              </div>
            </div>
            <div class="list__side">${round.analysisMode === 'demo' ? '<span class="chip chip-demo">Demo</span>' : '<span class="status-chip status-chip--positive">Round</span>'}</div>
          </a>`)) : ''}
        ${speechMaps.length ? section('Speech graphs', 'One argument map per analysed speech.', speechMaps.map((entry) => `
          <a class="list__item" href="/report.html?id=${entry.id}&view=map">
            <div class="list__main">
              <div class="list__title">${escapeHtml(entry.speechTitle || entry.resolution)}</div>
              <div class="list__meta">
                ${formatChip(entry.format)}
                <span>${escapeHtml(entry.speechType)}</span>
                <span>·</span>
                <span>${entry.counts?.nodes ?? 0} nodes</span>
                <span>·</span>
                <span>${entry.counts?.edges ?? 0} edges</span>
                <span>·</span>
                <span>${escapeHtml(relativeTime(entry.createdAt))}</span>
              </div>
            </div>
            <div class="list__side">${entry.isDemo ? '<span class="chip chip-demo">Demo</span>' : '<span class="chip chip-live">Live</span>'}</div>
          </a>`)) : ''}
      `;
    }
  } catch (error) {
    root.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(
      error.message || 'Could not load argument maps.'
    )}</span></div>`;
  }

  function section(title, description, itemsHtml) {
    return `<section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">${escapeHtml(title)}</h2>
          <p class="tiny muted" style="margin:2px 0 0">${escapeHtml(description)}</p>
        </div>
      </div>
      <div class="list">${itemsHtml.join('')}</div>
    </section>`;
  }
}
