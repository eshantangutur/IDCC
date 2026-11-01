import {
  api,
  escapeHtml,
  formatChip,
  formatDate,
  relativeTime,
  icons,
  param,
  openModal,
  confirmDialog,
  toast,
  emptyState,
  debounce,
  setButtonLoading,
  SIDE_LABELS,
} from './core.js';
import { mountShell } from './shell.js';

const shell = await mountShell({
  page: 'cases',
  title: 'My cases',
  subtitle: 'Saved resolutions, contentions and linked analyses',
  actionsHtml: '<button class="btn btn-primary btn-sm" id="topbarNewCase" type="button">New case</button>',
});

if (shell) {
  const { meta } = shell;
  const grid = document.getElementById('caseGrid');
  const searchInput = document.getElementById('caseSearch');
  const formatFilter = document.getElementById('caseFormatFilter');
  const countLabel = document.getElementById('caseCount');

  formatFilter.innerHTML = '<option value="">All formats</option>' +
    meta.formats.map((format) => `<option value="${format.id}">${escapeHtml(format.name)}</option>`).join('');

  let currentCases = [];
  let loading = false;

  async function loadCases() {
    if (loading) return;
    loading = true;
    grid.innerHTML = '<div class="skeleton" style="height:190px"></div><div class="skeleton" style="height:190px"></div><div class="skeleton" style="height:190px"></div>';
    const query = new URLSearchParams();
    const search = searchInput.value.trim();
    if (search) query.set('q', search);
    if (formatFilter.value) query.set('format', formatFilter.value);
    try {
      const data = await api.get(`/api/cases?${query.toString()}`);
      currentCases = data.cases;
      renderCases();
    } catch (error) {
      grid.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'Could not load cases.')}</span></div>`;
      countLabel.textContent = '';
    } finally {
      loading = false;
    }
  }

  function renderCases() {
    countLabel.textContent = `${currentCases.length} case${currentCases.length === 1 ? '' : 's'}`;
    if (!currentCases.length) {
      const hasFilters = searchInput.value.trim() || formatFilter.value;
      grid.innerHTML = `<div style="grid-column:1/-1">${emptyState({
        title: hasFilters ? 'No cases match your filters' : 'Your case library is empty',
        message: hasFilters
          ? 'Try a different search term or clear the format filter.'
          : 'Create a case to store a resolution, side and contentions, then attach analysed speeches to it.',
        action: hasFilters ? '<button type="button" class="btn btn-secondary btn-sm" data-clear-filters>Clear filters</button>' : '<button type="button" class="btn btn-primary btn-sm" data-new-case>Create your first case</button>',
      })}</div>`;
      grid.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
        searchInput.value = '';
        formatFilter.value = '';
        loadCases();
      });
      grid.querySelector('[data-new-case]')?.addEventListener('click', () => openCaseEditor(null));
      return;
    }

    grid.innerHTML = currentCases.map((entry) => `
      <article class="card case-card">
        <div class="case-card__head">
          <div>
            <h3>${escapeHtml(entry.title)}</h3>
            <div class="row" style="gap:6px;margin-top:6px">
              ${formatChip(entry.format)}
              <span class="chip">${escapeHtml(SIDE_LABELS[entry.side] || entry.side)}</span>
            </div>
          </div>
        </div>
        <p class="case-card__resolution">${escapeHtml(entry.resolution)}</p>
        <div class="case-card__meta">
          <span>${entry.contentions.length} contention${entry.contentions.length === 1 ? '' : 's'}</span>
          <span>${entry.speechCount} speech${entry.speechCount === 1 ? '' : 'es'}</span>
          <span>${entry.analysisCount} report${entry.analysisCount === 1 ? '' : 's'}</span>
        </div>
        <div class="case-card__actions">
          <button type="button" class="btn btn-secondary btn-sm" data-open-case="${entry.id}">Open</button>
          <a class="btn btn-ghost btn-sm" href="/analyzer.html?caseId=${entry.id}">Analyze</a>
          <button type="button" class="btn btn-ghost btn-sm" data-edit-case="${entry.id}">${icons.edit}<span>Edit</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-delete-case="${entry.id}" aria-label="Delete case">${icons.trash}</button>
        </div>
        <div class="tiny muted">Updated ${escapeHtml(relativeTime(entry.updatedAt))}</div>
      </article>`).join('');

    grid.querySelectorAll('[data-open-case]').forEach((button) => {
      button.addEventListener('click', () => openCaseDetail(Number(button.dataset.openCase)));
    });
    grid.querySelectorAll('[data-edit-case]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = currentCases.find((candidate) => candidate.id === Number(button.dataset.editCase));
        if (entry) openCaseEditor(entry);
      });
    });
    grid.querySelectorAll('[data-delete-case]').forEach((button) => {
      button.addEventListener('click', () => deleteCase(Number(button.dataset.deleteCase)));
    });
  }

  function caseFormHtml(entry) {
    return `<form id="caseForm" class="stack" novalidate>
      <div class="field">
        <label for="caseTitle">Case title</label>
        <input class="input" id="caseTitle" name="title" type="text" maxlength="160" required value="${escapeHtml(entry?.title || '')}" placeholder="e.g. Transit funding — Pro">
      </div>
      <div class="field">
        <label for="caseResolution">Resolution</label>
        <textarea class="textarea" id="caseResolution" name="resolution" maxlength="500" required placeholder="Resolved: …">${escapeHtml(entry?.resolution || '')}</textarea>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="caseFormat">Format</label>
          <select class="select" id="caseFormat" name="format">
            ${meta.formats.map((format) => `<option value="${format.id}" ${entry?.format === format.id ? 'selected' : ''}>${escapeHtml(format.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="caseSide">Side</label>
          <select class="select" id="caseSide" name="side"></select>
        </div>
      </div>
      <div class="field">
        <label for="caseNotes">Notes <span class="muted tiny">(optional)</span></label>
        <textarea class="textarea" id="caseNotes" name="notes" maxlength="8000" placeholder="Strategy notes, judge preferences, blocks to prepare…">${escapeHtml(entry?.notes || '')}</textarea>
      </div>
      <div class="field">
        <div class="row-between">
          <span class="label">Contentions</span>
          <button type="button" class="btn btn-ghost btn-sm" data-add-contention>${icons.plus}<span>Add contention</span></button>
        </div>
        <div class="stack-sm" id="contentionRows"></div>
        <span class="hint">Each contention needs a short title and its text.</span>
      </div>
      <div class="banner banner--error" data-form-error hidden><span></span></div>
    </form>`;
  }

  function openCaseEditor(entry) {
    const modal = openModal({
      title: entry ? 'Edit case' : 'New case',
      body: caseFormHtml(entry),
      footer: `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>${entry ? 'Save changes' : 'Create case'}</button>`,
      wide: true,
    });

    const form = modal.body.querySelector('#caseForm');
    const formatSelect = form.querySelector('#caseFormat');
    const sideSelect = form.querySelector('#caseSide');
    const rows = form.querySelector('#contentionRows');

    function syncSides(preserve = true) {
      const format = meta.formats.find((candidate) => candidate.id === formatSelect.value);
      const previous = preserve ? sideSelect.value : null;
      sideSelect.innerHTML = (format?.sides || []).map((side) => `<option value="${side.id}">${escapeHtml(side.label)}</option>`).join('');
      if (previous && [...sideSelect.options].some((option) => option.value === previous)) sideSelect.value = previous;
      else if (entry?.side && format?.sides.some((side) => side.id === entry.side) && preserve) sideSelect.value = entry.side;
    }

    function addRow(contention = { title: '', body: '' }) {
      const row = document.createElement('div');
      row.className = 'contention-row';
      row.innerHTML = `
        <input class="input" type="text" maxlength="160" data-contention-title placeholder="Contention title" value="${escapeHtml(contention.title || '')}">
        <textarea class="textarea" maxlength="4000" data-contention-body placeholder="Contention text" style="min-height:64px">${escapeHtml(contention.body || '')}</textarea>
        <button type="button" class="btn btn-ghost btn-icon" data-remove-contention aria-label="Remove contention">${icons.x}</button>`;
      row.querySelector('[data-remove-contention]').addEventListener('click', () => row.remove());
      rows.appendChild(row);
    }

    formatSelect.value = entry?.format || meta.formats[0].id;
    syncSides(true);
    (entry?.contentions || []).forEach((contention) => addRow(contention));
    if (!entry?.contentions?.length) addRow();

    formatSelect.addEventListener('change', () => syncSides(false));
    form.querySelector('[data-add-contention]').addEventListener('click', () => addRow());

    modal.footer.querySelector('[data-cancel]').addEventListener('click', () => modal.close());

    const saveButton = modal.footer.querySelector('[data-save]');
    saveButton.addEventListener('click', async () => {
      const errorBox = form.querySelector('[data-form-error]');
      errorBox.hidden = true;
      const title = form.querySelector('#caseTitle').value.trim();
      const resolution = form.querySelector('#caseResolution').value.trim();
      const contentions = [...rows.querySelectorAll('.contention-row')]
        .map((row) => ({
          title: row.querySelector('[data-contention-title]').value.trim(),
          body: row.querySelector('[data-contention-body]').value.trim(),
        }))
        .filter((contention) => contention.title || contention.body);

      const fail = (message) => {
        errorBox.querySelector('span').textContent = message;
        errorBox.hidden = false;
      };

      if (!title) return fail('Give the case a title.');
      if (resolution.length < 3) return fail('Enter the resolution this case argues.');
      if (contentions.some((contention) => !contention.title || !contention.body)) {
        return fail('Every contention needs both a title and text, or remove the row.');
      }

      const payload = {
        title,
        resolution,
        format: formatSelect.value,
        side: sideSelect.value,
        notes: form.querySelector('#caseNotes').value.trim() || null,
        contentions,
      };

      setButtonLoading(saveButton, true, 'Saving…');
      try {
        if (entry) await api.put(`/api/cases/${entry.id}`, payload);
        else await api.post('/api/cases', payload);
        modal.close();
        toast(entry ? 'Case updated.' : 'Case created.', 'success');
        await loadCases();
      } catch (error) {
        setButtonLoading(saveButton, false);
        fail(error.message || 'Could not save the case.');
      }
    });
  }

  async function openCaseDetail(caseId) {
    try {
      const data = await api.get(`/api/cases/${caseId}`);
      const { case: entry, speeches } = data;
      const modal = openModal({
        title: entry.title,
        wide: true,
        body: `<div class="stack">
          <div class="row">${formatChip(entry.format)}<span class="chip">${escapeHtml(SIDE_LABELS[entry.side] || entry.side)}</span><span class="tiny muted">Updated ${escapeHtml(formatDate(entry.updatedAt))}</span></div>
          <div>
            <span class="eyebrow">Resolution</span>
            <p class="small" style="margin-top:4px;color:var(--text-soft)">${escapeHtml(entry.resolution)}</p>
          </div>
          ${entry.notes ? `<div><span class="eyebrow">Notes</span><p class="small" style="margin-top:4px;color:var(--text-soft);white-space:pre-wrap">${escapeHtml(entry.notes)}</p></div>` : ''}
          <div>
            <span class="eyebrow">Contentions (${entry.contentions.length})</span>
            ${entry.contentions.length
              ? `<div class="stack-sm" style="margin-top:8px">${entry.contentions.map((contention, index) => `
                <div class="component-item">
                  <div class="component-item__head"><span class="tiny muted">Contention ${index + 1}</span></div>
                  <p class="component-item__text">${escapeHtml(contention.title)}</p>
                  <p class="small muted" style="white-space:pre-wrap">${escapeHtml(contention.body)}</p>
                </div>`).join('')}</div>`
              : '<p class="small muted" style="margin-top:6px">No contentions stored for this case.</p>'}
          </div>
          <div>
            <span class="eyebrow">Speeches &amp; analyses (${speeches.length})</span>
            ${speeches.length
              ? `<div class="stack-sm" style="margin-top:8px">${speeches.map((speech) => `
                <div class="component-item">
                  <div class="component-item__head">
                    <span class="component-item__text">${escapeHtml(speech.title)}</span>
                    <span class="chip">v${speech.latestVersion}</span>
                  </div>
                  <p class="tiny muted">${escapeHtml(speech.speechType)} · ${speech.analysisCount} report${speech.analysisCount === 1 ? '' : 's'} · ${escapeHtml(relativeTime(speech.updatedAt))}</p>
                  <div class="row" style="gap:6px">
                    ${speech.lastAnalysisId ? `<a class="btn btn-secondary btn-sm" href="/report.html?id=${speech.lastAnalysisId}">Latest report</a>` : ''}
                    <a class="btn btn-ghost btn-sm" href="/revise.html?id=${speech.id}">Revise</a>
                    <a class="btn btn-ghost btn-sm" href="/analyzer.html?speechId=${speech.id}">Analyze</a>
                  </div>
                </div>`).join('')}</div>`
              : '<p class="small muted" style="margin-top:6px">No speeches are attached to this case yet. Analyse a speech and select this case to attach it.</p>'}
          </div>
        </div>`,
        footer: `<button type="button" class="btn btn-ghost btn-sm" data-delete>${icons.trash}<span>Delete case</span></button>
          <span class="grow"></span>
          <a class="btn btn-secondary" href="/analyzer.html?caseId=${entry.id}">Analyse a speech</a>
          <button type="button" class="btn btn-primary" data-edit>Edit case</button>`,
      });

      modal.footer.querySelector('[data-edit]').addEventListener('click', () => {
        modal.close();
        openCaseEditor(entry);
      });
      modal.footer.querySelector('[data-delete]').addEventListener('click', async () => {
        modal.close();
        await deleteCase(entry.id);
      });
    } catch (error) {
      toast(error.message || 'Could not open the case.', 'error');
    }
  }

  async function deleteCase(caseId) {
    const entry = currentCases.find((candidate) => candidate.id === caseId);
    const confirmed = await confirmDialog({
      title: 'Delete this case?',
      message: `“${entry?.title || 'This case'}” and its speech links will be removed. Analyses of its speeches are deleted with them. This cannot be undone.`,
      confirmLabel: 'Delete case',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.delete(`/api/cases/${caseId}`);
      toast('Case deleted.', 'success');
      await loadCases();
    } catch (error) {
      toast(error.message || 'Could not delete the case.', 'error');
    }
  }

  document.getElementById('newCaseButton').addEventListener('click', () => openCaseEditor(null));
  document.getElementById('topbarNewCase')?.addEventListener('click', () => openCaseEditor(null));
  searchInput.addEventListener('input', debounce(loadCases, 260));
  formatFilter.addEventListener('change', loadCases);

  await loadCases();

  const openId = param('open');
  if (openId) {
    await openCaseDetail(Number(openId));
    const url = new URL(window.location.href);
    url.searchParams.delete('open');
    window.history.replaceState({}, '', url);
  }
}
