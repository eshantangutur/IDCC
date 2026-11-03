import {
  api,
  categoryChip,
  escapeHtml,
  formatChip,
  formatDate,
  icons,
  openModal,
  param,
  relativeTime,
  setButtonLoading,
  SIDE_LABELS,
  toast,
  spinnerHtml,
} from './core.js';
import { mountShell, demoBanner } from './shell.js';
import { createArgumentMap, mapLegendHtml, TYPE_LABELS_EXPORT } from './map.js';

const roundId = Number(param('id'));
const shell = await mountShell({
  page: 'rounds',
  title: 'Round workspace',
  subtitle: 'Loading round...',
});

if (!roundId) {
  document.getElementById('roundPage').innerHTML =
    '<div class="banner banner--error">This page needs a round id. Open a round from the rounds list.</div>';
} else if (shell) {
  const { meta } = shell;
  const state = {
    detail: null,
    view: param('view') || 'timeline',
    selectedSpeechId: null,
    selectedArgumentId: null,
    selectedEvidenceId: null,
    selectedFindingId: null,
    graph: null,
    feedbackBusy: false,
  };

  await load();

  function statusChip(status) {
    const tone = {
      answered: 'positive',
      extended: 'positive',
      partially_answered: 'warning',
      conceded: 'warning',
      turned: 'critical',
      dropped: 'critical',
      still_contested: 'warning',
      unclear: 'muted',
      introduced: 'neutral',
    }[status] || 'muted';
    return `<span class="status-chip status-chip--${tone}">${escapeHtml(String(status).replace(/_/g, ' '))}</span>`;
  }

  function sideTag(side) {
    return `<span class="side-tag side-tag--${escapeHtml(side)}">${escapeHtml(SIDE_LABELS[side] || side)}</span>`;
  }

  function argumentById(id) {
    return state.detail.arguments.find((argument) => argument.id === id) ?? null;
  }

  async function load() {
    const root = document.getElementById('roundPage');
    root.innerHTML = '<div class="skeleton" style="height:360px"></div>';
    try {
      const detail = await api.get(`/api/rounds/${roundId}`);
      state.detail = detail;
      state.selectedSpeechId = state.selectedSpeechId ?? detail.speeches[0]?.id ?? null;
      render();
    } catch (error) {
      if (error.status === 404) {
        root.innerHTML = `<div class="banner banner--error">${icons.alert}<span>That round is not in your workspace.</span></div>`;
        return;
      }
      root.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(
        error.message || 'Could not load this round.'
      )}</span></div>`;
    }
  }

  function render() {
    const { round, speeches } = state.detail;
    document.getElementById('appTopbar').querySelector('.topbar__title').textContent = round.title;
    document.getElementById('appTopbar').querySelector('.topbar__sub').textContent = `${meta.formats.find((entry) => entry.id === round.format)?.name || round.format} · ${round.resolution}`;

    const actions = document.getElementById('appTopbar').querySelector('.topbar__actions');
    actions.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm" data-add-speech>${icons.plus}<span>Add speech</span></button>
      <button type="button" class="btn btn-primary btn-sm" data-analyze ${speeches.some((speech) => speech.content.trim().length >= 20) ? '' : 'disabled'}>
        ${icons.spark}<span>${round.status === 'analyzed' ? 'Re-run analysis' : 'Analyze round'}</span>
      </button>`;
    actions.querySelector('[data-add-speech]').addEventListener('click', openSpeechModal);
    actions.querySelector('[data-analyze]').addEventListener('click', runAnalysis);

    document.getElementById('roundPage').innerHTML = `
      ${demoBanner(meta)}
      <div class="row-between" style="margin:14px 0 10px">
        <div class="pill-row">
          ${formatChip(round.format)}
          ${round.side ? sideTag(round.side) : '<span class="chip">Neutral observer</span>'}
          ${round.status === 'analyzed' ? '<span class="status-chip status-chip--positive">Analysed</span>' : `<span class="status-chip status-chip--muted">${escapeHtml(round.status)}</span>`}
          ${state.detail.analysis ? `<span class="chip ${state.detail.analysis.mode === 'demo' ? 'chip-demo' : 'chip-live'}">${state.detail.analysis.mode === 'demo' ? 'Demo analysis' : 'Live AI'}</span>` : ''}
        </div>
        <div class="tiny muted">${state.detail.analysis ? `Analysed ${escapeHtml(relativeTime(state.detail.analysis.createdAt))}` : 'Not analysed yet'}</div>
      </div>

      <div class="round-workspace">
        <section class="round-col">
          <div class="round-col__head">Round information</div>
          <div class="round-col__body">
            <dl class="round-meta">
              <div><dt>Resolution</dt><dd>${escapeHtml(round.resolution)}</dd></div>
              <div><dt>Format</dt><dd>${escapeHtml(meta.formats.find((entry) => entry.id === round.format)?.name || round.format)}</dd></div>
              <div><dt>Speeches</dt><dd>${speeches.length} of ${formatLimit()}</dd></div>
              <div><dt>Participants</dt><dd>${state.detail.participants.length ? state.detail.participants.map((entry) => escapeHtml(entry.name)).join(', ') : 'None recorded'}</dd></div>
              ${round.notes ? `<div><dt>Notes</dt><dd>${escapeHtml(round.notes)}</dd></div>` : ''}
            </dl>
          </div>
          <div class="round-col__head">Speech timeline</div>
          <ul class="speech-timeline round-col__scroll" id="speechTimeline">
            ${speeches.map((speech) => `
              <li>
                <button type="button" class="speech-timeline__item ${speech.id === state.selectedSpeechId ? 'is-active' : ''} ${speech.content.trim() ? '' : 'is-empty'}" data-speech="${speech.id}">
                  <span class="speech-timeline__num">${speech.position}</span>
                  <span>
                    <span class="speech-timeline__type">${escapeHtml(speech.speechType)}</span>
                    <span class="speech-timeline__meta">
                      ${sideTag(speech.side)}
                      <span>${escapeHtml(speech.speakerName || 'No speaker')}</span>
                      <span>·</span>
                      <span>${speech.wordCount} words</span>
                    </span>
                  </span>
                </button>
              </li>`).join('') || '<div class="empty-inline">No speeches yet.</div>'}
          </ul>
        </section>

        <section class="round-col">
          <div class="round-view-tabs">
            ${[
              ['timeline', 'Timeline'],
              ['graph', 'Argument graph'],
              ['report', 'Report'],
              ['speeches', 'Speeches'],
              ['evidence', 'Evidence'],
            ].map(([id, label]) => `<button type="button" class="btn ${state.view === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-view="${id}">${label}</button>`).join('')}
          </div>
          <div id="roundView"></div>
        </section>

        <aside class="round-col round-workspace__aside">
          <div class="round-col__head">Detail</div>
          <div class="round-col__body" id="roundDetail"></div>
        </aside>
      </div>`;

    document.querySelectorAll('[data-view]').forEach((button) =>
      button.addEventListener('click', () => {
        state.view = button.dataset.view;
        render();
      })
    );
    document.querySelectorAll('[data-speech]').forEach((button) =>
      button.addEventListener('click', () => {
        state.selectedSpeechId = Number(button.dataset.speech);
        state.view = 'speeches';
        render();
      })
    );

    renderView();
    renderDetail();
  }

  function formatLimit() {
    const structure = state.detail.roundStructure;
    if (!structure || structure.flexibleOrder) return 30;
    return Math.max(structure.slots.length, state.detail.speeches.length);
  }

  function renderView() {
    const container = document.getElementById('roundView');
    if (!container) return;

    if (state.view === 'timeline') return renderTimeline(container);
    if (state.view === 'graph') return renderGraph(container);
    if (state.view === 'report') return renderReport(container);
    if (state.view === 'speeches') return renderSpeeches(container);
    return renderEvidence(container);
  }

  function renderTimeline(container) {
    const timeline = state.detail.timeline;
    if (!timeline.length) {
      container.innerHTML = '<div class="empty-inline">Add speeches to build the round timeline.</div>';
      return;
    }
    container.innerHTML = `<div class="round-col__scroll">${timeline
      .map(
        (entry) => `<article class="timeline-entry">
          <div class="timeline-entry__head">
            <span class="timeline-entry__title">Speech ${entry.speech.position} · ${escapeHtml(entry.speech.speechType)}</span>
            <span class="tiny muted">${escapeHtml(SIDE_LABELS[entry.speech.side] || entry.speech.side)} · ${entry.speech.wordCount} words</span>
          </div>
          ${entry.introduced.length ? group('Arguments introduced', entry.introduced.map((item) => `<button type="button" class="btn btn-ghost btn-sm" data-arg="${item.id}">${escapeHtml(item.label)}</button>`)) : ''}
          ${entry.touched.length ? group('Arguments touched', entry.touched.map((item) => `<button type="button" class="btn btn-ghost btn-sm" data-arg="${item.id}">${escapeHtml(item.label)} ${statusChip(item.status)}</button>`)) : ''}
          ${entry.evidence.length ? group('Evidence recorded', entry.evidence.map((item) => `<span class="tiny">${escapeHtml(item.citation || 'Uncited')}</span>`)) : ''}
          ${entry.findings.length ? group('Findings', entry.findings.map((item) => `<button type="button" class="btn btn-ghost btn-sm" data-finding="${item.id}">${escapeHtml(item.title)}</button>`)) : ''}
          ${!entry.introduced.length && !entry.touched.length && !entry.evidence.length && !entry.findings.length ? '<p class="tiny muted">Nothing recorded for this speech yet. Run the round analysis.</p>' : ''}
        </article>`
      )
      .join('')}</div>`;

    wireArgumentButtons(container);
    container.querySelectorAll('[data-finding]').forEach((button) =>
      button.addEventListener('click', () => {
        state.selectedFindingId = Number(button.dataset.finding);
        state.view = 'report';
        render();
      })
    );
  }

  function group(title, items) {
    return `<div class="timeline-entry__group"><h5>${escapeHtml(title)}</h5><div class="pill-row">${items.join('')}</div></div>`;
  }

  function wireArgumentButtons(container) {
    container.querySelectorAll('[data-arg]').forEach((button) =>
      button.addEventListener('click', () => {
        state.selectedArgumentId = Number(button.dataset.arg);
        state.selectedEvidenceId = null;
        state.selectedFindingId = null;
        renderDetail();
        state.graph?.highlightNode(`arg-${state.selectedArgumentId}`);
      })
    );
  }

  function renderGraph(container) {
    const graph = state.detail.graph;
    if (!graph || !graph.nodes.length) {
      container.innerHTML = `<div class="empty-inline">
        ${state.detail.analysis ? 'This analysis stored no graph data.' : 'Run the round analysis to build the argument graph.'}
      </div>`;
      return;
    }

    container.innerHTML = `
      <div class="graph-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" data-zoom-in>${icons.zoomIn}<span>Zoom in</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-zoom-out>${icons.zoomOut}<span>Zoom out</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-fit>${icons.reset}<span>Fit</span></button>
        <span class="spacer"></span>
        <select class="select" data-type-filter aria-label="Filter by node type">
          <option value="">All node types</option>
          ${[...new Set(graph.nodes.map((node) => node.type))].map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(TYPE_LABELS_EXPORT[type] || type)}</option>`).join('')}
        </select>
      </div>
      <div class="graph-shell" id="graphCanvas"></div>
      <div class="graph-legend">
        ${mapLegendHtml([...new Set(graph.nodes.map((node) => node.type))])}
        <span class="tiny muted">${graph.meta.arguments} arguments · ${graph.meta.evidence} evidence · ${graph.meta.edges} edges</span>
      </div>
      <div class="round-col__body" style="border-top:1px solid var(--border)">
        <p class="tiny muted">Click a node to inspect it. Drag to pan, use the mouse wheel or the buttons to zoom. Edges are stored relationships, not layout guesses.</p>
      </div>`;

    const mapNodes = graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      excerpt: node.excerpt,
      strength: node.status ?? node.assessment ?? null,
    }));
    const mapEdges = graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      explanation: edge.explanation,
      supported: true,
    }));

    state.graph = createArgumentMap(container.querySelector('#graphCanvas'), {
      nodes: mapNodes,
      edges: mapEdges,
      onSelectNode: (payload) => {
        if (payload.kind === 'node') {
          const node = graph.nodes.find((entry) => entry.id === payload.node.id);
          if (!node) return;
          if (node.kind === 'evidence') {
            state.selectedEvidenceId = node.evidenceId;
            state.selectedArgumentId = null;
          } else {
            state.selectedArgumentId = node.argumentId;
            state.selectedEvidenceId = null;
          }
          state.selectedFindingId = null;
          renderDetail();
          return;
        }
        const relationship = graph.edges.find(
          (edge) => edge.from === payload.from?.id && edge.to === payload.to?.id && edge.relation === payload.relation
        );
        if (relationship) renderRelationshipDetail(relationship);
      },
    });

    container.querySelector('[data-zoom-in]').addEventListener('click', () => state.graph?.zoomIn());
    container.querySelector('[data-zoom-out]').addEventListener('click', () => state.graph?.zoomOut());
    container.querySelector('[data-fit]').addEventListener('click', () => state.graph?.resetView());
    container.querySelector('[data-type-filter]').addEventListener('change', (event) => {
      state.graph?.setTypeFilter(event.target.value || null);
    });

    if (state.selectedArgumentId) state.graph.highlightNode(`arg-${state.selectedArgumentId}`);
    if (state.selectedEvidenceId) state.graph.highlightNode(`ev-${state.selectedEvidenceId}`);
  }

  function renderReport(container) {
    const { analysis, findings, skills } = state.detail;
    if (!analysis || !analysis.report) {
      container.innerHTML = `<div class="empty-inline">
        No round report yet. Add speeches and run the analysis.
        ${state.detail.speeches.length ? '<div style="margin-top:10px"><button type="button" class="btn btn-primary btn-sm" data-analyze-inline>Analyze round</button></div>' : ''}
      </div>`;
      container.querySelector('[data-analyze-inline]')?.addEventListener('click', runAnalysis);
      return;
    }

    const report = analysis.report;
    const grouped = [
      ['critical', 'Critical weaknesses'],
      ['moderate', 'Moderate weaknesses'],
      ['minor', 'Minor weaknesses'],
      ['improvement', 'Potential improvements'],
      ['strength', 'Working well'],
    ];

    container.innerHTML = `<div class="round-col__scroll">
      <div class="report-block">
        <h4>Round overview</h4>
        <p>${escapeHtml(report.summary?.overview || 'No overview returned.')}</p>
        ${report.summary?.developmentSummary ? `<p>${escapeHtml(report.summary.developmentSummary)}</p>` : ''}
        ${report.summary?.clashSummary ? `<p><strong>Clash:</strong> ${escapeHtml(report.summary.clashSummary)}</p>` : ''}
      </div>
      <div class="report-block">
        <h4>Each side</h4>
        <p><strong>${escapeHtml(meta.formats.find((entry) => entry.id === state.detail.round.format)?.sides[0]?.label || 'First side')}:</strong> ${escapeHtml(report.summary?.pro || 'Not assessed.')}</p>
        <p><strong>${escapeHtml(meta.formats.find((entry) => entry.id === state.detail.round.format)?.sides[1]?.label || 'Second side')}:</strong> ${escapeHtml(report.summary?.con || 'Not assessed.')}</p>
        ${report.summary?.strategicNotes?.length ? `<p class="tiny muted">${report.summary.strategicNotes.map((note) => escapeHtml(note)).join(' ')}</p>` : ''}
      </div>
      ${report.summary?.remainingClash?.length ? `<div class="report-block">
        <h4>Remaining clash</h4>
        <ul class="timeline-entry__list">${report.summary.remainingClash.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>` : ''}
      ${grouped
        .map(([category, heading]) => {
          const items = findings.filter((finding) => finding.category === category);
          if (!items.length) return '';
          return `<div class="report-block">
            <h4>${escapeHtml(heading)} <span class="tiny muted">(${items.length})</span></h4>
            ${items.map((finding) => findingCard(finding)).join('')}
          </div>`;
        })
        .join('')}
      ${skills.length ? `<div class="report-block">
        <h4>Skill ratings from this round</h4>
        ${skills.map((skill) => `<div class="skill-row">
          <div class="skill-row__head"><span class="skill-row__name">${escapeHtml(skill.name)}</span><span class="skill-row__value">${skill.level}/5</span></div>
          <div class="skill-row__meter"><span class="${skill.level <= 2 ? 'is-low' : skill.level === 3 ? 'is-mid' : 'is-high'}" style="width:${(skill.level / 5) * 100}%"></span></div>
          <div class="skill-row__note">${escapeHtml(skill.explanation || '')}${skill.recommendation ? ` <strong>Next step:</strong> ${escapeHtml(skill.recommendation)}` : ''}</div>
        </div>`).join('')}
      </div>` : ''}
      <div class="round-col__body">
        <p class="tiny muted">AI findings can be wrong. Use the buttons under each finding to record whether it is accurate. Your correction is stored beside the original.</p>
      </div>
    </div>`;

    wireArgumentButtons(container);
    container.querySelectorAll('[data-finding]').forEach((button) =>
      button.addEventListener('click', () => {
        state.selectedFindingId = Number(button.dataset.finding);
        renderDetail();
      })
    );
    container.querySelectorAll('[data-feedback]').forEach((button) =>
      button.addEventListener('click', async () => submitFeedback(Number(button.dataset.target), button.dataset.feedback, button))
    );
    container.querySelectorAll('[data-show-argument]').forEach((button) =>
      button.addEventListener('click', () => {
        state.selectedArgumentId = Number(button.dataset.showArgument);
        state.selectedFindingId = null;
        state.view = 'graph';
        render();
      })
    );
  }

  function findingCard(finding) {
    const rating = finding.feedback?.rating ?? null;
    return `<div class="finding-card finding--${escapeHtml(finding.category)}" id="finding-${finding.id}">
      <div class="finding-card__head">
        <button type="button" class="btn btn-ghost btn-sm" data-finding="${finding.id}" style="text-align:left;padding:0">${escapeHtml(finding.title)}</button>
        ${categoryChip(finding.category)}
      </div>
      ${finding.passage ? `<blockquote class="finding-card__quote">${escapeHtml(finding.passage)}</blockquote>` : '<p class="tiny muted">No verifiable passage was returned for this finding.</p>'}
      <div class="finding-card__body">${escapeHtml(finding.explanation)}</div>
      ${finding.suggestion ? `<div class="finding-card__body"><strong>Suggested fix:</strong> ${escapeHtml(finding.suggestion)}</div>` : ''}
      <div class="finding-card__feedback">
        ${[['accurate', 'Accurate'], ['partially_accurate', 'Partly'], ['inaccurate', 'Wrong']]
          .map(([value, label]) => `<button type="button" class="btn ${rating === value ? 'btn-primary' : 'btn-secondary'}" data-feedback="${value}" data-target="${finding.id}">${label}</button>`)
          .join('')}
        ${finding.argumentId ? `<button type="button" class="btn btn-ghost btn-sm" data-show-argument="${finding.argumentId}">View argument</button>` : ''}
        ${finding.origin === 'heuristic' ? '<span class="chip chip-demo">Heuristic</span>' : ''}
      </div>
    </div>`;
  }

  async function submitFeedback(targetId, rating) {
    if (state.feedbackBusy) return;
    state.feedbackBusy = true;
    try {
      await api.post('/api/feedback', {
        targetType: 'round_finding',
        targetId,
        rating,
        comment: state.detail.findings.find((finding) => finding.id === targetId)?.feedback?.comment ?? undefined,
      });
      const finding = state.detail.findings.find((entry) => entry.id === targetId);
      if (finding) finding.feedback = { ...(finding.feedback || {}), rating };
      toast('Feedback saved.', 'success');
      renderView();
    } catch (error) {
      toast(error.message || 'Could not save feedback.', 'error');
    } finally {
      state.feedbackBusy = false;
    }
  }

  function renderSpeeches(container) {
    const speech = state.detail.speeches.find((entry) => entry.id === state.selectedSpeechId) ?? state.detail.speeches[0];
    if (!speech) {
      container.innerHTML = '<div class="empty-inline">No speeches yet. Use "Add speech".</div>';
      return;
    }
    state.selectedSpeechId = speech.id;
    const formatSpec = meta.formats.find((entry) => entry.id === state.detail.round.format);
    container.innerHTML = `<div class="round-col__body">
      <div class="form-grid">
        <label class="field"><span class="label">Speech ${speech.position}</span>
          <select class="select" data-field="side">
            ${formatSpec.sides.map((side) => `<option value="${side.id}" ${side.id === speech.side ? 'selected' : ''}>${escapeHtml(side.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span class="label">Speech type</span>
          <select class="select" data-field="speechType">
            ${formatSpec.speechTypes.map((type) => `<option value="${escapeHtml(type)}" ${type === speech.speechType ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="field"><span class="label">Speaker</span>
        <input class="input" data-field="speakerName" value="${escapeHtml(speech.speakerName || '')}" maxlength="120">
      </label>
      <label class="field"><span class="label">Speech text</span>
        <textarea class="textarea speech-editor__body" data-field="content" placeholder="Paste the speech text here.">${escapeHtml(speech.content)}</textarea>
      </label>
      <div class="row" style="gap:8px;align-items:center">
        <button type="button" class="btn btn-primary btn-sm" data-save-speech>${icons.save}<span>Save speech</span></button>
        <button type="button" class="btn btn-danger btn-sm" data-delete-speech>${icons.trash}<span>Delete</span></button>
        <span class="grow"></span>
        <span class="tiny muted">${speech.wordCount} words stored</span>
      </div>
    </div>`;

    container.querySelector('[data-save-speech]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setButtonLoading(button, true, 'Saving...');
      try {
        await api.put(`/api/rounds/${roundId}/speeches/${speech.id}`, {
          side: container.querySelector('[data-field="side"]').value,
          speechType: container.querySelector('[data-field="speechType"]').value,
          speakerName: container.querySelector('[data-field="speakerName"]').value.trim(),
          content: container.querySelector('[data-field="content"]').value,
        });
        toast('Speech saved.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not save the speech.', 'error');
        setButtonLoading(button, false);
      }
    });

    container.querySelector('[data-delete-speech]').addEventListener('click', async () => {
      try {
        await api.delete(`/api/rounds/${roundId}/speeches/${speech.id}`);
        state.selectedSpeechId = null;
        toast('Speech removed.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not delete the speech.', 'error');
      }
    });
  }

  function renderEvidence(container) {
    const { evidence } = state.detail;
    if (!evidence.length) {
      container.innerHTML = `<div class="empty-inline">
        No evidence records yet. Evidence is extracted when the round analysis runs.
      </div>`;
      return;
    }
    const labels = Object.fromEntries((meta.evidenceAssessments || []).map((entry) => [entry.id, entry.label]));
    container.innerHTML = `<div class="round-col__scroll">
      ${evidence
        .map(
          (record) => `<article class="finding-card" style="margin:10px 12px">
            <div class="finding-card__head">
              <span class="finding-card__title">${escapeHtml(record.citation || 'Uncited evidence')}</span>
              <span class="chip">${escapeHtml(labels[record.assessment] || record.assessment)}</span>
            </div>
            <blockquote class="finding-card__quote">${escapeHtml(record.passage)}</blockquote>
            <div class="finding-card__body">
              ${record.supportedClaim ? `<div><strong>Claim:</strong> ${escapeHtml(record.supportedClaim)}</div>` : ''}
              ${record.explanation ? `<div style="margin-top:5px">${escapeHtml(record.explanation)}</div>` : ''}
              <div class="tiny muted" style="margin-top:5px">
                Speech ${record.speechPosition ?? '?'} · author: ${escapeHtml(record.author || 'Not stated')} · date: ${escapeHtml(record.publishedAt || 'Not stated')}
              </div>
            </div>
            <div class="finding-card__feedback">
              <button type="button" class="btn btn-secondary btn-sm" data-verify="${record.id}">${icons.search}<span>Check source</span></button>
              <span class="tiny ${record.verification ? 'muted' : ''}">
                ${record.verification
                  ? record.verification.status === 'verified'
                    ? `Verified via ${escapeHtml(record.verification.provider || 'provider')}`
                    : record.verification.status === 'unavailable'
                      ? 'Not verified: no provider configured'
                      : `Verification: ${escapeHtml(record.verification.status)}`
                  : 'Not checked against any external source'}
              </span>
            </div>
          </article>`
        )
        .join('')}
      <div class="round-col__body">
        <p class="tiny muted">The app never claims a source was verified unless a retrieval provider actually returned it. Assessments above describe the text, not the truth of the source.</p>
      </div>
    </div>`;

    container.querySelectorAll('[data-verify]').forEach((button) =>
      button.addEventListener('click', async () => {
        setButtonLoading(button, true, 'Checking...');
        try {
          const response = await api.post(`/api/evidence/${button.dataset.verify}/verify`, {});
          const verification = response.verification;
          if (verification.status === 'unavailable') {
            toast('No verification provider is configured, so nothing was retrieved.', 'error');
          } else if (verification.status === 'verified') {
            toast('Source retrieved.', 'success');
          } else {
            toast(`Verification result: ${verification.status}.`, 'info');
          }
          await load();
          state.view = 'evidence';
          render();
        } catch (error) {
          toast(error.message || 'Could not verify this source.', 'error');
          setButtonLoading(button, false);
        }
      })
    );
  }

  function renderDetail() {
    const container = document.getElementById('roundDetail');
    if (!container) return;

    if (state.selectedFindingId) return renderFindingDetail(container);
    if (state.selectedEvidenceId) return renderEvidenceDetail(container);
    if (state.selectedArgumentId) return renderArgumentDetail(container);

    container.innerHTML = `<div class="empty-inline">
      Select an argument, evidence record, finding or edge to inspect it here.
    </div>`;
  }

  function renderRelationshipDetail(edge) {
    const container = document.getElementById('roundDetail');
    const stored = state.detail.graph.edges.find((entry) => entry.id === edge.id);
    if (!stored) return;
    const relationship = state.detail.relationships.find((entry) => entry.id === stored.relationshipId);
    container.innerHTML = `<div class="empty-inline" style="text-align:left">
      <div class="small" style="color:var(--text-soft)">${escapeHtml(stored.relation.replace(/_/g, ' '))}</div>
      <p class="tiny muted">${escapeHtml(stored.explanation || 'No explanation stored.')}</p>
      ${relationship?.origin === 'human' ? '<span class="chip">Manual link</span>' : '<span class="chip chip-demo">AI link</span>'}
      ${relationship ? `<div style="margin-top:10px"><button type="button" class="btn btn-danger btn-sm" data-remove-rel="${relationship.id}">Remove link</button></div>` : ''}
    </div>`;
    container.querySelector('[data-remove-rel]')?.addEventListener('click', async (event) => {
      try {
        await api.delete(`/api/rounds/${roundId}/relationships/${event.currentTarget.dataset.removeRel}`);
        toast('Relationship removed.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not remove the relationship.', 'error');
      }
    });
  }

  async function renderArgumentDetail(container) {
    const argument = argumentById(state.selectedArgumentId);
    if (!argument) {
      container.innerHTML = '<div class="empty-inline">That argument is no longer in this round.</div>';
      return;
    }
    const related = state.detail.relationships.filter(
      (relationship) => relationship.sourceId === argument.id || relationship.targetId === argument.id
    );
    const findings = state.detail.findings.filter((finding) => finding.argumentId === argument.id);

    container.innerHTML = `
      <div class="pill-row" style="margin-bottom:8px">
        ${statusChip(argument.status)}
        <span class="chip">${escapeHtml(argument.type)}</span>
        ${sideTag(argument.side)}
        ${argument.humanEdited ? '<span class="chip chip-improvement">Edited by you</span>' : ''}
      </div>
      <dl class="round-meta">
        <div><dt>Label</dt><dd>${escapeHtml(argument.label)}</dd></div>
        <div><dt>Claim</dt><dd>${escapeHtml(argument.claim || 'Not stated')}</dd></div>
        <div><dt>Warrant</dt><dd>${escapeHtml(argument.warrant || 'Not stated')}</dd></div>
        <div><dt>Evidence</dt><dd>${escapeHtml(argument.evidence || 'None offered')}</dd></div>
        <div><dt>Impact</dt><dd>${escapeHtml(argument.impact || 'Not stated')}</dd></div>
        <div><dt>Assumptions</dt><dd>${escapeHtml(argument.assumptions || 'None recorded')}</dd></div>
        <div><dt>First appearance</dt><dd>Speech ${argument.introducedSpeechPosition ?? '?'}</dd></div>
        <div><dt>Latest appearance</dt><dd>Speech ${argument.latestSpeechPosition ?? '?'}</dd></div>
        <div><dt>Status basis</dt><dd>${escapeHtml(argument.statusReason || 'Not explained')} <span class="tiny muted">(${escapeHtml(argument.statusConfidence)} confidence)</span></dd></div>
      </dl>

      <div class="field" style="margin-top:12px">
        <span class="label">Correct the status</span>
        <div class="row" style="gap:6px">
          <select class="select" id="argStatus">
            ${meta.argumentStatuses.map((status) => `<option value="${status.id}" ${status.id === argument.status ? 'selected' : ''}>${escapeHtml(status.label)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="saveArgStatus">Save</button>
        </div>
        <p class="tiny muted" style="margin-top:6px">Your correction is stored separately from the AI finding and survives re-analysis.</p>
      </div>

      <div class="field" style="margin-top:12px">
        <span class="label">Relationships</span>
        ${related.length
          ? `<div class="stack-sm">${related
              .map(
                (relationship) => `<div class="row-between tiny" style="gap:8px">
                  <span>${escapeHtml(relationship.relation.replace(/_/g, ' '))} ${relationship.sourceId === argument.id ? '→' : '←'} ${escapeHtml(
                    argumentById(relationship.sourceId === argument.id ? relationship.targetId : relationship.sourceId)?.label || 'argument'
                  )}</span>
                  <button type="button" class="btn btn-ghost btn-sm" data-remove-rel="${relationship.id}" aria-label="Remove relationship">${icons.x}</button>
                </div>`
              )
              .join('')}</div>`
          : '<p class="tiny muted">No relationships recorded.</p>'}
        <div class="stack-sm" style="margin-top:8px">
          <select class="select" id="relTarget">
            <option value="">Add a link to...</option>
            ${state.detail.arguments
              .filter((entry) => entry.id !== argument.id)
              .map((entry) => `<option value="${entry.id}">${escapeHtml(entry.label)}</option>`)
              .join('')}
          </select>
          <select class="select" id="relType">
            ${meta.argumentRelations.map((relation) => `<option value="${relation}">${escapeHtml(relation.replace(/_/g, ' '))}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="addRel">Add relationship</button>
        </div>
      </div>

      <div class="field" style="margin-top:12px">
        <span class="label">Findings on this argument</span>
        ${findings.length
          ? findings.map((finding) => `<button type="button" class="btn btn-ghost btn-sm" style="display:block;text-align:left;width:100%" data-open-finding="${finding.id}">${escapeHtml(finding.title)}</button>`).join('')
          : '<p class="tiny muted">None recorded.</p>'}
      </div>

      <button type="button" class="btn btn-secondary btn-sm" style="margin-top:10px;width:100%" id="showHistory">Load full history</button>
      <div id="argHistory" class="stack-sm" style="margin-top:8px"></div>`;

    wireArgumentButtons(container);
    container.querySelectorAll('[data-open-finding]').forEach((button) =>
      button.addEventListener('click', () => {
        state.selectedFindingId = Number(button.dataset.openFinding);
        renderDetail();
      })
    );
    container.querySelectorAll('[data-remove-rel]').forEach((button) =>
      button.addEventListener('click', async () => {
        try {
          await api.delete(`/api/rounds/${roundId}/relationships/${button.dataset.removeRel}`);
          toast('Relationship removed.', 'success');
          await load();
        } catch (error) {
          toast(error.message || 'Could not remove the relationship.', 'error');
        }
      })
    );

    container.querySelector('#saveArgStatus').addEventListener('click', async (event) => {
      setButtonLoading(event.currentTarget, true, 'Saving...');
      try {
        await api.put(`/api/rounds/${roundId}/arguments/${argument.id}`, {
          status: container.querySelector('#argStatus').value,
        });
        toast('Status corrected.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not save the correction.', 'error');
        setButtonLoading(event.currentTarget, false);
      }
    });

    container.querySelector('#addRel').addEventListener('click', async (event) => {
      const targetId = Number(container.querySelector('#relTarget').value);
      if (!targetId) return toast('Choose an argument to link.', 'error');
      setButtonLoading(event.currentTarget, true, 'Adding...');
      try {
        await api.post(`/api/rounds/${roundId}/relationships`, {
          sourceId: argument.id,
          targetId,
          relation: container.querySelector('#relType').value,
          explanation: 'Added during review.',
        });
        toast('Relationship added.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not add the relationship.', 'error');
        setButtonLoading(event.currentTarget, false);
      }
    });

    container.querySelector('#showHistory').addEventListener('click', async (event) => {
      setButtonLoading(event.currentTarget, true, 'Loading...');
      try {
        const history = await api.get(`/api/rounds/${roundId}/arguments/${argument.id}`);
        container.querySelector('#argHistory').innerHTML = history.history.length
          ? history.history
              .map(
                (entry) => `<div class="detail-row">
                  <dt>Speech ${entry.speechPosition ?? '?'} · ${escapeHtml(entry.status.replace(/_/g, ' '))} ${entry.origin === 'human' ? '(your correction)' : ''}</dt>
                  <dd>${escapeHtml(entry.reason || 'No reason recorded.')}</dd>
                </div>`
              )
              .join('')
          : '<p class="tiny muted">No status history recorded.</p>';
        setButtonLoading(event.currentTarget, false);
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = 'History loaded';
      } catch (error) {
        toast(error.message || 'Could not load history.', 'error');
        setButtonLoading(event.currentTarget, false);
      }
    });
  }

  function renderEvidenceDetail(container) {
    const record = state.detail.evidence.find((entry) => entry.id === state.selectedEvidenceId);
    if (!record) {
      container.innerHTML = '<div class="empty-inline">That evidence record is no longer in this round.</div>';
      return;
    }
    const labels = Object.fromEntries((meta.evidenceAssessments || []).map((entry) => [entry.id, entry.label]));
    container.innerHTML = `
      <div class="pill-row" style="margin-bottom:8px"><span class="chip">${escapeHtml(labels[record.assessment] || record.assessment)}</span></div>
      <blockquote class="finding-card__quote">${escapeHtml(record.passage)}</blockquote>
      <dl class="round-meta">
        <div><dt>Claim it supports</dt><dd>${escapeHtml(record.supportedClaim || 'Not stated')}</dd></div>
        <div><dt>Speaker usage</dt><dd>${escapeHtml(record.speakerUsage || 'Not stated')}</dd></div>
        <div><dt>Citation</dt><dd>${escapeHtml(record.citation || 'None')}</dd></div>
        <div><dt>Author</dt><dd>${escapeHtml(record.author || 'Not stated')}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(record.publishedAt || 'Not stated')}</dd></div>
        <div><dt>Assessment</dt><dd>${escapeHtml(record.explanation || 'No explanation.')}</dd></div>
        <div><dt>Verification</dt><dd>${record.verification ? escapeHtml(record.verification.notes || record.verification.status) : 'No external source was retrieved for this passage.'}</dd></div>
      </dl>`;
  }

  function renderFindingDetail(container) {
    const finding = state.detail.findings.find((entry) => entry.id === state.selectedFindingId);
    if (!finding) {
      container.innerHTML = '<div class="empty-inline">That finding is no longer in this round.</div>';
      return;
    }
    const annotation = state.detail.annotations.find(
      (entry) => entry.targetType === 'round_finding' && entry.targetId === finding.id
    );
    container.innerHTML = `
      <div class="pill-row" style="margin-bottom:8px">${categoryChip(finding.category)}<span class="chip">${escapeHtml(finding.confidence)} confidence</span></div>
      <h3 style="font-size:.92rem;margin:0 0 6px">${escapeHtml(finding.title)}</h3>
      ${finding.passage ? `<blockquote class="finding-card__quote">${escapeHtml(finding.passage)}</blockquote>` : '<p class="tiny muted">No verifiable passage.</p>'}
      <dl class="round-meta">
        <div><dt>What is happening</dt><dd>${escapeHtml(finding.explanation)}</dd></div>
        ${finding.whyItMatters ? `<div><dt>Why it matters</dt><dd>${escapeHtml(finding.whyItMatters)}</dd></div>` : ''}
        ${finding.suggestion ? `<div><dt>Suggestion</dt><dd>${escapeHtml(finding.suggestion)}</dd></div>` : ''}
      </dl>
      <div class="field" style="margin-top:12px">
        <span class="label">Your rating</span>
        <div class="pill-row">
          ${[['accurate', 'Accurate'], ['partially_accurate', 'Partly'], ['inaccurate', 'Wrong']]
            .map(([value, label]) => `<button type="button" class="btn ${finding.feedback?.rating === value ? 'btn-primary' : 'btn-secondary'} btn-sm" data-rate="${value}">${label}</button>`)
            .join('')}
        </div>
      </div>
      <label class="field" style="margin-top:10px"><span class="label">Suggested correction</span>
        <textarea class="textarea" id="correctionText" rows="3" maxlength="4000">${escapeHtml(annotation?.humanValue || finding.feedback?.suggestedCorrection || '')}</textarea>
      </label>
      <button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%" id="saveCorrection">Save correction separately</button>
      <p class="tiny muted" style="margin-top:8px">The original AI finding is never overwritten. Your correction is stored as a human annotation.</p>`;

    container.querySelectorAll('[data-rate]').forEach((button) =>
      button.addEventListener('click', () => submitFeedback(finding.id, button.dataset.rate))
    );

    container.querySelector('#saveCorrection').addEventListener('click', async (event) => {
      const humanValue = container.querySelector('#correctionText').value.trim();
      if (!humanValue) return toast('Write the correction first.', 'error');
      setButtonLoading(event.currentTarget, true, 'Saving...');
      try {
        await api.post('/api/feedback/annotations', {
          targetType: 'round_finding',
          targetId: finding.id,
          aiValue: `${finding.title} — ${finding.explanation}`,
          humanValue,
        });
        toast('Correction stored beside the AI finding.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not store the correction.', 'error');
        setButtonLoading(event.currentTarget, false);
      }
    });
  }

  async function runAnalysis(event) {
    const button = event.currentTarget;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${spinnerHtml()}<span>Analysing round...</span>`;
    try {
      const response = await api.post(`/api/rounds/${roundId}/analyze`, {}, { timeout: 180000 });
      toast(
        response.isDemo
          ? `Round analysed with the demo heuristic: ${response.counts.arguments} arguments found.`
          : `Round analysed: ${response.counts.arguments} arguments found.`,
        'success'
      );
      state.view = 'report';
      await load();
    } catch (error) {
      toast(error.message || 'The round analysis failed.', 'error');
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function openSpeechModal() {
    const formatSpec = meta.formats.find((entry) => entry.id === state.detail.round.format);
    const structure = state.detail.roundStructure;
    const nextSlot = structure && !structure.flexibleOrder ? structure.slots[state.detail.speeches.length] : null;

    const dialog = openModal({
      title: 'Add speech',
      wide: true,
      body: `<form id="speechForm" class="stack">
        <div class="form-grid">
          <label class="field"><span class="label">Side</span>
            <select class="select" name="side">
              ${formatSpec.sides.map((side) => `<option value="${side.id}" ${nextSlot?.side === side.id ? 'selected' : ''}>${escapeHtml(side.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span class="label">Speech type</span>
            <select class="select" name="speechType">
              ${formatSpec.speechTypes.map((type) => `<option value="${escapeHtml(type)}" ${nextSlot?.speechType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field"><span class="label">Speaker</span>
          <input class="input" name="speakerName" maxlength="120" placeholder="Optional">
        </label>
        <label class="field"><span class="label">Speech text</span>
          <textarea class="textarea speech-editor__body" name="content" required minlength="20" placeholder="Paste the speech text."></textarea>
        </label>
        ${state.detail.speeches.length >= 30 ? '<p class="error-text">This round already holds the maximum number of speeches.</p>' : ''}
      </form>`,
      footer: `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary" form="speechForm">Add speech</button>`,
    });

    dialog.footer.querySelector('[data-cancel]').addEventListener('click', dialog.close);
    dialog.body.querySelector('#speechForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = dialog.footer.querySelector('button[type="submit"]');
      setButtonLoading(submit, true, 'Adding...');
      try {
        const response = await api.post(`/api/rounds/${roundId}/speeches`, {
          side: form.elements.side.value,
          speechType: form.elements.speechType.value,
          speakerName: form.elements.speakerName.value.trim() || undefined,
          content: form.elements.content.value,
        });
        state.selectedSpeechId = response.speech.id;
        dialog.close();
        toast('Speech added.', 'success');
        await load();
      } catch (error) {
        toast(error.message || 'Could not add the speech.', 'error');
        setButtonLoading(submit, false);
      }
    });
  }
}
