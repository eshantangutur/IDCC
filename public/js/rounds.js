import {
  api,
  debounce,
  emptyState,
  escapeHtml,
  formatChip,
  formatDate,
  icons,
  loadMeta,
  openModal,
  relativeTime,
  setButtonLoading,
  SIDE_LABELS,
  toast,
} from './core.js';
import { mountShell, demoBanner } from './shell.js';

const shell = await mountShell({
  page: 'rounds',
  title: 'Rounds',
  subtitle: 'Round-level argument intelligence',
  actionsHtml: '<button type="button" class="btn btn-secondary btn-sm" id="newRoundTop">New round</button>',
});

if (shell) {
  const { meta } = shell;
  const state = { rounds: [], query: '', format: '' };

  document.getElementById('newRoundBtn')?.addEventListener('click', () => openCreateRound(meta));
  document.getElementById('newRoundTop')?.addEventListener('click', () => openCreateRound(meta));

  const formatSelect = document.getElementById('roundFormat');
  formatSelect.innerHTML = `<option value="">All formats</option>${meta.formats
    .map((format) => `<option value="${escapeHtml(format.id)}">${escapeHtml(format.name)}</option>`)
    .join('')}`;
  formatSelect.addEventListener('change', () => {
    state.format = formatSelect.value;
    loadRounds();
  });

  const search = document.getElementById('roundSearch');
  search.addEventListener(
    'input',
    debounce(() => {
      state.query = search.value.trim();
      loadRounds();
    }, 250)
  );

  await loadRounds();

  async function loadRounds() {
    const list = document.getElementById('roundsList');
    list.innerHTML = '<div class="skeleton" style="height:160px"></div>';
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.format) params.set('format', state.format);
    try {
      const { rounds } = await api.get(`/api/rounds?${params.toString()}`);
      state.rounds = rounds;
      document.getElementById('roundCount').textContent = `${rounds.length} round${rounds.length === 1 ? '' : 's'}`;
      if (!rounds.length) {
        list.innerHTML = emptyState({
          title: state.query || state.format ? 'No rounds match that filter' : 'No rounds yet',
          message: state.query || state.format
            ? 'Clear the search or format filter to see everything.'
            : 'Create a round, add the speeches in order, then run the round analysis.',
          action: '<button type="button" class="btn btn-primary btn-sm" data-create>New round</button>',
        });
        list.querySelector('[data-create]')?.addEventListener('click', () => openCreateRound(meta));
        return;
      }
      list.innerHTML = `<div class="list">${rounds
        .map(
          (round) => `<a class="list__item" href="/round.html?id=${round.id}">
            <div class="list__main">
              <div class="list__title">${escapeHtml(round.title)}</div>
              <div class="list__meta">
                ${formatChip(round.format)}
                ${round.side ? `<span>${escapeHtml(SIDE_LABELS[round.side] || round.side)}</span>` : '<span>Neutral</span>'}
                <span>·</span>
                <span>${round.speechCount} speech${round.speechCount === 1 ? '' : 'es'}</span>
                <span>·</span>
                <span>${round.argumentCount} argument${round.argumentCount === 1 ? '' : 's'}</span>
                <span>·</span>
                <span>${escapeHtml(relativeTime(round.updatedAt))}</span>
              </div>
              <div class="tiny muted truncate" style="margin-top:4px">${escapeHtml(round.resolution)}</div>
            </div>
            <div class="list__side">
              ${round.status === 'analyzed'
                ? '<span class="status-chip status-chip--positive">Analysed</span>'
                : round.status === 'ready'
                  ? '<span class="status-chip status-chip--warning">Ready</span>'
                  : '<span class="status-chip status-chip--muted">Draft</span>'}
              ${round.analysisMode === 'demo' ? '<span class="chip chip-demo">Demo</span>' : ''}
            </div>
          </a>`
        )
        .join('')}</div>`;
    } catch (error) {
      list.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(
        error.message || 'Could not load rounds.'
      )}</span></div>`;
    }
  }

  function openCreateRound(metaData) {
    const formatOptions = metaData.formats
      .map((format) => `<option value="${escapeHtml(format.id)}">${escapeHtml(format.name)}</option>`)
      .join('');

    const dialog = openModal({
      title: 'New round',
      wide: true,
      body: `<form id="roundForm" class="stack">
        ${demoBanner(metaData)}
        <div class="form-grid">
          <label class="field"><span class="label">Round title</span>
            <input class="input" name="title" required maxlength="160" placeholder="Quarterfinal vs. Central">
          </label>
          <label class="field"><span class="label">Format</span>
            <select class="select" name="format" required>${formatOptions}</select>
          </label>
        </div>
        <label class="field"><span class="label">Resolution or topic</span>
          <input class="input" name="resolution" required minlength="5" maxlength="500">
        </label>
        <div class="form-grid">
          <label class="field"><span class="label">Side</span>
            <select class="select" name="side"></select>
          </label>
          <label class="field"><span class="label">Notes (optional)</span>
            <input class="input" name="notes" maxlength="4000" placeholder="Judge, room, tournament">
          </label>
        </div>
        <div class="field">
          <span class="label">Speeches</span>
          <p class="tiny muted" style="margin:2px 0 8px">The order below follows the format. Paste text now or later.</p>
          <div id="speechSlots" class="stack-sm"></div>
        </div>
        <div id="roundFormError" class="error-text" hidden></div>
      </form>`,
      footer: `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary" form="roundForm">Create round</button>`,
    });

    const form = dialog.body.querySelector('#roundForm');
    const formatField = form.elements.format;
    const sideField = form.elements.side;
    const slots = dialog.body.querySelector('#speechSlots');

    function formatSpec(id) {
      return metaData.formats.find((entry) => entry.id === id);
    }

    function renderFormat() {
      const spec = formatSpec(formatField.value);
      sideField.innerHTML =
        '<option value="">Neutral observer</option>' +
        spec.sides.map((side) => `<option value="${escapeHtml(side.id)}">${escapeHtml(side.label)}</option>`).join('');

      const structure = spec.roundStructure;
      if (structure.flexibleOrder) {
        slots.innerHTML = `<div class="muted-box">Congressional Debate has no fixed speech order. Speeches can be added after the round is created, in the order they occurred.</div>`;
        return;
      }
      slots.innerHTML = structure.slots
        .map(
          (slot) => `<div class="contention-row">
            <div class="row" style="gap:8px;align-items:flex-start">
              <div style="min-width:0;flex:1">
                <div class="small" style="font-weight:600">${slot.order}. ${escapeHtml(slot.role)}</div>
                <div class="tiny muted">${escapeHtml(spec.speechTypes.includes(slot.speechType) ? slot.speechType : '')}</div>
              </div>
              <span class="side-tag side-tag--${escapeHtml(slot.side)}">${escapeHtml(SIDE_LABELS[slot.side] || slot.side)}</span>
            </div>
            <input class="input" data-slot="${slot.order - 1}" placeholder="Speaker name (optional)" maxlength="120">
            <textarea class="textarea" rows="2" data-content="${slot.order - 1}" placeholder="Paste this speech (optional)"></textarea>
          </div>`
        )
        .join('');
    }

    formatField.addEventListener('change', renderFormat);
    renderFormat();

    dialog.footer.querySelector('[data-cancel]').addEventListener('click', dialog.close);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = dialog.body.querySelector('#roundFormError');
      errorBox.hidden = true;
      const submit = dialog.footer.querySelector('button[type="submit"]');
      setButtonLoading(submit, true, 'Creating...');

      const spec = formatSpec(formatField.value);
      const slotsData = spec.roundStructure.flexibleOrder
        ? []
        : spec.roundStructure.slots.map((slot, index) => ({
            side: slot.side,
            speechType: slot.speechType,
            speakerName: dialog.body.querySelector(`[data-slot="${index}"]`)?.value?.trim() || '',
            content: dialog.body.querySelector(`[data-content="${index}"]`)?.value || '',
          }));

      try {
        const response = await api.post('/api/rounds', {
          title: form.elements.title.value.trim(),
          format: formatField.value,
          resolution: form.elements.resolution.value.trim(),
          side: sideField.value || undefined,
          notes: form.elements.notes.value.trim() || undefined,
          speeches: slotsData,
        });
        toast('Round created.', 'success');
        window.location.href = `/round.html?id=${response.round.id}`;
      } catch (error) {
        errorBox.textContent = error.message || 'Could not create the round.';
        errorBox.hidden = false;
        setButtonLoading(submit, false);
      }
    });
  }
}
