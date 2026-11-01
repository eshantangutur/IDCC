import {
  api,
  escapeHtml,
  formatDate,
  formatChip,
  modeChip,
  icons,
  confirmDialog,
  toast,
  debounce,
  emptyState,
  SIDE_LABELS,
} from './core.js';
import { mountShell } from './shell.js';

const shell = await mountShell({
  page: 'history',
  title: 'Analysis history',
  subtitle: 'All your reports',
  actionsHtml: '<a class="btn btn-primary btn-sm" href="/analyzer.html">New analysis</a>',
});

if (shell) {
  const { meta } = shell;
  const body = document.getElementById('historyBody');
  const searchInput = document.getElementById('historySearch');
  const formatFilter = document.getElementById('historyFormatFilter');
  const countLabel = document.getElementById('historyCount');

  formatFilter.innerHTML = '<option value="">All formats</option>' +
    meta.formats.map((format) => `<option value="${format.id}">${escapeHtml(format.name)}</option>`).join('');

  let entries = [];
  let loading = false;

  async function load() {
    if (loading) return;
    loading = true;
    body.innerHTML = '<div class="skeleton" style="height:280px"></div>';
    const query = new URLSearchParams({ limit: '100' });
    const search = searchInput.value.trim();
    if (search) query.set('q', search);
    if (formatFilter.value) query.set('format', formatFilter.value);

    try {
      const data = await api.get(`/api/analyses?${query.toString()}`);
      entries = data.analyses;
      render();
    } catch (error) {
      body.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'Could not load analysis history.')}</span></div>`;
      countLabel.textContent = '';
    } finally {
      loading = false;
    }
  }

  function render() {
    countLabel.textContent = `${entries.length} report${entries.length === 1 ? '' : 's'}`;

    if (!entries.length) {
      const filtered = searchInput.value.trim() || formatFilter.value;
      body.innerHTML = emptyState({
        title: filtered ? 'No reports match your filters' : 'No reports yet',
        message: filtered
          ? 'Try a different search term or clear the format filter.'
          : 'Analyze your first speech to start your history.',
        action: filtered
          ? '<button type="button" class="btn btn-secondary btn-sm" data-clear>Clear filters</button>'
          : '<a class="btn btn-primary btn-sm" href="/analyzer.html">Start a new analysis</a>',
      });
      body.querySelector('[data-clear]')?.addEventListener('click', () => {
        searchInput.value = '';
        formatFilter.value = '';
        load();
      });
      return;
    }

    body.innerHTML = `<div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Report</th>
            <th>Format</th>
            <th>Findings</th>
            <th>Date</th>
            <th>Mode</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry) => {
            const counts = entry.counts || {};
            const critical = counts.critical || 0;
            return `<tr>
              <td class="cell-title">
                <strong title="${escapeHtml(entry.speechTitle || entry.resolution)}">${escapeHtml(entry.speechTitle || entry.resolution)}</strong>
                <span>${escapeHtml(entry.resolution)}</span>
              </td>
              <td>
                ${formatChip(entry.format)}
                <div class="tiny muted" style="margin-top:4px">${escapeHtml(entry.speechType)}${entry.side ? `, ${escapeHtml(SIDE_LABELS[entry.side] || entry.side)}` : ''}</div>
              </td>
              <td>
                <span class="chip ${critical ? 'chip-critical' : 'chip-strength'}">${critical} critical</span>
                <div class="tiny muted" style="margin-top:4px">${counts.findings || 0} total, ${counts.strengths || 0} strengths</div>
              </td>
              <td>
                <span class="small">${escapeHtml(formatDate(entry.createdAt))}</span>
                ${entry.speechVersion ? `<div class="tiny muted">Version ${entry.speechVersion}</div>` : ''}
              </td>
              <td>${modeChip(entry.mode)}</td>
              <td>
                <div class="table__actions">
                  <a class="btn btn-secondary btn-sm" href="/report.html?id=${entry.id}">Open</a>
                  <button type="button" class="btn btn-ghost btn-icon btn-sm" data-delete="${entry.id}" aria-label="Delete report">${icons.trash}</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

    body.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.dataset.delete);
        const confirmed = await confirmDialog({
          title: 'Delete this report?',
          message: 'The report, its findings, and its argument map will be deleted. The speech and its other versions are kept.',
          confirmLabel: 'Delete report',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.delete(`/api/analyses/${id}`);
          toast('Report deleted.', 'success');
          await load();
        } catch (error) {
          toast(error.message || 'Could not delete the report.', 'error');
        }
      });
    });
  }

  searchInput.addEventListener('input', debounce(load, 260));
  formatFilter.addEventListener('change', load);
  await load();
}
