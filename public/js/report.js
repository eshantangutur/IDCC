import {
  api,
  CATEGORY_META,
  WEAKNESS_LABELS,
  SIDE_LABELS,
  escapeHtml,
  formatChip,
  formatDate,
  highlightPassage,
  icons,
  modeChip,
  param,
  confirmDialog,
  copyText,
  toast,
  emptyState,
} from './core.js';
import { mountShell, demoBanner, liveBanner } from './shell.js';
import { createArgumentMap, TYPE_COLORS, TYPE_LABELS_EXPORT, mapLegendHtml } from './map.js';
import { donut } from './charts.js';

const ROOT = document.getElementById('reportRoot');
const analysisId = Number(param('id'));

async function main() {
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    window.location.replace('/history.html');
    return;
  }

  const shell = await mountShell({
    page: 'history',
    title: 'Analysis report',
    subtitle: 'Summary, findings, and argument map',
    actionsHtml: '<a class="btn btn-ghost btn-sm" href="/history.html">All analyses</a>',
  });
  if (!shell) return;

  let analysis;
  try {
    const response = await api.get(`/api/analyses/${analysisId}`);
    analysis = response.analysis;
  } catch (error) {
    ROOT.innerHTML = `<div class="stack">
      <div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'This report could not be loaded.')}</span></div>
      <a class="btn btn-secondary" href="/history.html">Back to analysis history</a>
    </div>`;
    return;
  }

  render(analysis, shell);
}

function render(analysis, shell) {
  const { meta } = shell;
  const result = analysis.result || {};
  const summary = result.summary || {};
  const counts = result.counts || {};
  const formatSpec = meta.formats.find((entry) => entry.id === analysis.format);
  const formatName = formatSpec?.name || analysis.format;
  const title = analysis.speech?.title || analysis.resolution;
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const nodes = Array.isArray(result.nodes) ? result.nodes : [];
  const edges = Array.isArray(result.edges) ? result.edges : [];

  document.title = `${formatSpec?.abbreviation || analysis.format} report | Argument Forensics`;

  const comparisonCard = analysis.comparison
    ? `<div class="card">
        <div class="card-title" style="margin-bottom:10px">${icons.refresh} Compared with the previous analysis</div>
        <p class="small muted">${analysis.comparison.resolvedCount} finding${analysis.comparison.resolvedCount === 1 ? '' : 's'} resolved, ${analysis.comparison.persistentCount} carried over.</p>
        <div class="resolution-list" style="margin-top:10px">
          ${(analysis.comparison.resolved || []).slice(0, 3).map((finding) => `
            <div class="resolution-item resolution-item--resolved">${icons.check}<span>Resolved: ${escapeHtml(finding.title)}</span></div>`).join('')}
          ${(analysis.comparison.persistent || []).slice(0, 3).map((finding) => `
            <div class="resolution-item resolution-item--open">${icons.alert}<span>Still open: ${escapeHtml(finding.title)}</span></div>`).join('')}
        </div>
      </div>`
    : '';

  ROOT.innerHTML = `
    <div class="report-head">
      <div class="row" style="gap:8px">
        <a class="btn btn-ghost btn-sm" href="/history.html">${icons.arrowLeft}<span>History</span></a>
        <span class="tiny muted">Report #${analysis.id}</span>
      </div>
      <span class="small muted">${escapeHtml(formatName)}, ${escapeHtml(analysis.speechType)}</span>
      <h1>${escapeHtml(title)}</h1>
      <div class="report-meta">
        ${formatChip(analysis.format)}
        <span class="chip">${escapeHtml(SIDE_LABELS[analysis.side] || analysis.side)}</span>
        ${modeChip(analysis.mode)}
        ${analysis.speechVersion ? `<span class="chip">Version ${analysis.speechVersion}</span>` : ''}
        <span class="tiny muted">Analysed ${escapeHtml(formatDate(analysis.createdAt))}</span>
      </div>
      <p class="small muted" style="max-width:85ch">${escapeHtml(analysis.resolution)}</p>
      <div class="row">
        ${analysis.speechId ? `<a class="btn btn-secondary btn-sm" href="/revise.html?id=${analysis.speechId}">${icons.edit}<span>Revise speech</span></a>` : ''}
        ${analysis.speechId ? `<a class="btn btn-ghost btn-sm" href="/analyzer.html?speechId=${analysis.speechId}">${icons.refresh}<span>Re-analyse</span></a>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="copyReportButton">Copy speech text</button>
        <button type="button" class="btn btn-danger btn-sm" id="deleteAnalysisButton">${icons.trash}<span>Delete report</span></button>
      </div>
    </div>

    <div class="stack-sm" style="margin-top:14px">
      ${analysis.isDemo ? demoBanner(meta) : liveBanner(meta)}
      <div class="banner">
        ${icons.alert}
        <div>
          <strong>Read findings as opinions, not verdicts.</strong>
          Each weakness cites the passage that generated it, and the confidence indicator reflects how directly the text supports the finding.
          A high-confidence finding means the passage is clear, not that the conclusion is objectively true.
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <div>
          <span class="small muted">Summary</span>
          <h2 style="font-size:1.15rem;margin-top:4px">${escapeHtml(summary.structureAssessment ? 'How this argument is built' : 'Analysis summary')}</h2>
        </div>
        <div class="summary-grid" style="gap:8px;width:100%;max-width:380px">
          <div class="mini-kpi"><b>${counts.claims || 0}</b><span>Claims</span></div>
          <div class="mini-kpi"><b>${counts.evidence || 0}</b><span>Evidence</span></div>
          <div class="mini-kpi"><b>${counts.warrants || 0}</b><span>Warrants</span></div>
          <div class="mini-kpi"><b>${counts.impacts || 0}</b><span>Impacts</span></div>
          <div class="mini-kpi"><b>${counts.assumptions || 0}</b><span>Assumptions</span></div>
        </div>
      </div>
      <p style="color:var(--text-soft);font-size:.94rem;max-width:100ch">${escapeHtml(summary.overview || 'No summary was produced for this analysis.')}</p>
      <div class="grid-2" style="margin-top:16px">
        ${summary.structureAssessment ? `<div><span class="small muted">Structure</span><p class="small muted" style="margin-top:6px">${escapeHtml(summary.structureAssessment)}</p></div>` : ''}
        ${summary.weighingSummary ? `<div><span class="small muted">Weighing</span><p class="small muted" style="margin-top:6px">${escapeHtml(summary.weighingSummary)}</p></div>` : ''}
      </div>
      ${Array.isArray(summary.strongComponents) && summary.strongComponents.length ? `
        <div style="margin-top:16px">
          <span class="small muted">What is working</span>
          <div class="focus-list" style="margin-top:8px">
            ${summary.strongComponents.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
          </div>
        </div>` : ''}
    </div>

    <div class="tabs" role="tablist" aria-label="Report sections" style="margin-top:18px">
      <button class="tab" role="tab" id="tab-workspace" aria-controls="panel-workspace" aria-selected="true">Workspace</button>
      <button class="tab" role="tab" id="tab-structure" aria-controls="panel-structure" aria-selected="false">Structure</button>
      <button class="tab" role="tab" id="tab-rubric" aria-controls="panel-rubric" aria-selected="false">Rubric</button>
      <button class="tab" role="tab" id="tab-tool" aria-controls="panel-tool" aria-selected="false">${escapeHtml(result.formatSpecific?.label || formatSpec?.specialTool?.label || 'Format tool')}</button>
    </div>

    <section class="tab-panel" id="panel-workspace" role="tabpanel" aria-labelledby="tab-workspace">
      <div class="workspace">
        <div class="workspace__col">
          <div class="workspace__head">
            <div>
              <span class="small muted">Speech</span>
              <span class="tiny muted mono" style="margin-left:8px">${analysis.content.length} chars</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="copySpeechButton">Copy</button>
          </div>
          <div class="workspace__scroll">
            <div class="speech-view" id="speechText">${escapeHtml(analysis.content)}</div>
          </div>
        </div>

        <div class="workspace__col">
          <div class="workspace__head">
            <span class="small muted">Findings</span>
            <span class="chip">${findings.length}</span>
          </div>
          <div class="workspace__body" style="padding-bottom:0">
            <p class="tiny muted" id="passageHint">Select a finding to locate its passage in the speech.</p>
            <div class="passage-panel" id="passagePanel" style="margin-top:8px"></div>
          </div>
          <div class="workspace__scroll" id="findingsList"></div>
          <div class="workspace__insights">
            <div>
              <div class="card-title" style="margin-bottom:10px">${icons.layers} Finding mix</div>
              ${donut(buildDonut(counts))}
            </div>
            ${comparisonCard}
          </div>
        </div>

        <div class="workspace__col workspace__col--map workspace__map" id="workspaceMap">
          <div class="workspace__head">
            <span class="small muted">Argument map</span>
            <span class="chip">${nodes.length} nodes, ${edges.length} links</span>
          </div>
          <div class="map-toolbar">
            <div class="map-legend" id="mapLegend"></div>
            <div class="map-zoom btn-group">
              <button type="button" class="btn btn-secondary btn-sm btn-icon" id="zoomIn" aria-label="Zoom in">${icons.zoomIn}</button>
              <button type="button" class="btn btn-secondary btn-sm btn-icon" id="zoomOut" aria-label="Zoom out">${icons.zoomOut}</button>
              <button type="button" class="btn btn-secondary btn-sm btn-icon" id="zoomReset" aria-label="Reset zoom">${icons.reset}</button>
            </div>
          </div>
          <div class="map-canvas" title="Scroll horizontally or drag the canvas to explore the full graph.">
            <div id="mapHost"></div>
          </div>
          <div class="row map-filters" id="mapFilters"></div>
          <aside class="map-detail" id="mapDetail">
            <span class="small muted">Inspector</span>
            <h3 style="margin-top:6px">Select a node</h3>
            <p class="small muted" style="margin-top:6px">Click any node to read the exact sentence and the model's explanation. Click an edge to inspect the relationship and whether the speech actually warrants it.</p>
            <div class="map-detail__row"><span>Nodes</span><span>${nodes.length}</span></div>
            <div class="map-detail__row"><span>Relationships</span><span>${edges.length}</span></div>
            <div class="map-detail__row"><span>Unsupported links</span><span>${edges.filter((edge) => edge.supported === false).length}</span></div>
          </aside>
        </div>
      </div>
    </section>

    <section class="tab-panel" id="panel-structure" role="tabpanel" aria-labelledby="tab-structure" hidden>
      ${renderStructure(result.structure || {})}
    </section>

    <section class="tab-panel" id="panel-rubric" role="tabpanel" aria-labelledby="tab-rubric" hidden>
      ${renderRubric(result.rubric, formatSpec)}
    </section>

    <section class="tab-panel" id="panel-tool" role="tabpanel" aria-labelledby="tab-tool" hidden>
      ${renderFormatSpecific(result.formatSpecific)}
    </section>`;

  document.title = `${formatName} report | Argument Forensics`;

  // ---------------- findings ----------------
  const findingsList = document.getElementById('findingsList');
  findingsList.innerHTML = findings.length
    ? ['critical', 'moderate', 'minor', 'improvement', 'strength']
      .map((category) => {
        const group = findings.filter((finding) => finding.category === category);
        if (!group.length) return '';
        const metaCategory = CATEGORY_META[category] || { heading: category };
        return `<div class="finding-group">
          <div class="finding-group__head">
            <span class="chip chip-${category}">${escapeHtml(metaCategory.label || category)}</span>
            <h3>${escapeHtml(metaCategory.heading || category)}</h3>
            <span class="finding-group__count">${group.length}</span>
          </div>
          <p class="tiny muted">${escapeHtml(metaCategory.hint || '')}</p>
          ${group.map((finding) => {
            const index = findings.indexOf(finding);
            return renderFinding(finding, index);
          }).join('')}
        </div>`;
      }).join('')
    : emptyState({
      title: 'No findings returned',
      message: 'The analysis completed without findings. Try a longer excerpt or a different format standard.',
    });

  const passagePanel = document.getElementById('passagePanel');
  const passageHint = document.getElementById('passageHint');
  let mapApi = null;
  let mapBuilt = false;
  let pendingNode = null;

  function selectFinding(index, { openMap = false } = {}) {
    const finding = findings[index];
    if (!finding) return;
    findingsList.querySelectorAll('[data-finding-index]').forEach((element) => {
      element.classList.toggle('is-active', Number(element.dataset.findingIndex) === index);
    });
    if (passagePanel) {
      passagePanel.innerHTML = finding.passage
        ? `<blockquote class="finding__passage" style="display:block;margin:0">"${escapeHtml(finding.passage)}"</blockquote>`
        : '<span class="muted">No verbatim passage was returned for this finding.</span>';
      passageHint.textContent = finding.confidence
        ? `Confidence: ${finding.confidence}. The passage is highlighted in the speech column.`
        : 'The passage is highlighted in the speech column.';
    }
    const speechText = document.getElementById('speechText');
    if (speechText) {
      speechText.innerHTML = finding.passage
        ? highlightPassage(analysis.content, finding.passage)
        : escapeHtml(analysis.content);
    }

    if (finding.nodeId) {
      pendingNode = finding.nodeId;
      if (mapApi) mapApi.highlightNode(finding.nodeId);
    }
    if (openMap) {
      document.getElementById('workspaceMap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  findingsList.addEventListener('click', (event) => {
    const card = event.target.closest('[data-finding-index]');
    if (!card) return;
    const index = Number(card.dataset.findingIndex);
    selectFinding(index, { openMap: Boolean(event.target.closest('[data-goto-map]')) });
  });
  findingsList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-finding-index]');
    if (!card) return;
    event.preventDefault();
    selectFinding(Number(card.dataset.findingIndex));
  });

  // ---------------- tabs ----------------
  const tabs = [...ROOT.querySelectorAll('[role="tab"]')];
  const panels = {
    workspace: document.getElementById('panel-workspace'),
    structure: document.getElementById('panel-structure'),
    rubric: document.getElementById('panel-rubric'),
    tool: document.getElementById('panel-tool'),
  };

  function activateTab(name) {
    for (const tab of tabs) {
      const target = tab.id.replace('tab-', '');
      tab.setAttribute('aria-selected', String(target === name));
    }
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;

    if (name === 'workspace' && !mapBuilt) buildMap();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.id.replace('tab-', '')));
    tab.addEventListener('keydown', (event) => {
      const current = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const next = tabs[(current + 1) % tabs.length];
        next.focus();
        activateTab(next.id.replace('tab-', ''));
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const previous = tabs[(current - 1 + tabs.length) % tabs.length];
        previous.focus();
        activateTab(previous.id.replace('tab-', ''));
      }
    });
  });

  // The workspace is the default view: build the map immediately.
  activateTab('workspace');

  // ---------------- argument map ----------------
  function buildMap() {
    const host = document.getElementById('mapHost');
    if (!host) return;
    mapApi = createArgumentMap(host, {
      nodes,
      edges,
      onSelectNode: (selection) => {
        const detail = document.getElementById('mapDetail');
        if (!detail) return;
        if (selection.kind === 'edge') {
          const { from, to, relation, explanation, supported } = selection;
          detail.innerHTML = `
            <span class="small muted">Relationship</span>
            <h3 style="margin-top:6px">${escapeHtml(relation)} ${supported ? '' : '· unsupported'}</h3>
            <div class="stack-sm" style="margin-top:10px">
              <div class="map-detail__row"><span>From</span><span>${escapeHtml(from?.label || 'unknown')}</span></div>
              <div class="map-detail__row"><span>To</span><span>${escapeHtml(to?.label || 'unknown')}</span></div>
              <div class="map-detail__row"><span>Warranted</span><span style="color:${supported ? 'var(--strength)' : 'var(--critical)'}">${supported ? 'yes' : 'no'}</span></div>
            </div>
            ${explanation ? `<p class="small" style="margin-top:10px;color:var(--text-soft)">${escapeHtml(explanation)}</p>` : ''}
            ${!supported ? '<p class="tiny" style="margin-top:8px;color:#fca5a5">The speech asserts this connection without showing why it is true.</p>' : ''}`;
          return;
        }

        const node = selection.node;
        const incoming = edges.filter((edge) => edge.to === node.id);
        const outgoing = edges.filter((edge) => edge.from === node.id);
        const relatedFinding = findings.findIndex((finding) => finding.nodeId === node.id);
        detail.innerHTML = `
          <span class="small muted" style="color:${TYPE_COLORS[node.type] || 'var(--muted)'}">${escapeHtml(TYPE_LABELS_EXPORT[node.type] || node.type)}</span>
          <h3 style="margin-top:6px">${escapeHtml(node.label)}</h3>
          ${node.excerpt ? `<p class="map-detail__excerpt">${escapeHtml(node.excerpt)}</p>` : ''}
          ${node.detail ? `<p class="small" style="color:var(--text-soft)">${escapeHtml(node.detail)}</p>` : ''}
          <div class="stack-sm" style="margin-top:10px">
            <div class="map-detail__row"><span>Strength</span><span>${escapeHtml(node.strength || 'unrated')}</span></div>
            <div class="map-detail__row"><span>Incoming</span><span>${incoming.length}</span></div>
            <div class="map-detail__row"><span>Outgoing</span><span>${outgoing.length}</span></div>
          </div>
          ${relatedFinding >= 0 ? `<button type="button" class="btn btn-secondary btn-sm btn-block" style="margin-top:12px" data-related-finding="${relatedFinding}">Open related finding</button>` : ''}
          ${!node.strength && !node.detail ? '<p class="tiny muted" style="margin-top:10px">No further detail was returned for this node.</p>' : ''}`;

        detail.querySelector('[data-related-finding]')?.addEventListener('click', (event) => {
          const index = Number(event.currentTarget.dataset.relatedFinding);
          selectFinding(index);
          document.querySelector(`[data-finding-index="${index}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      },
    });

    const legend = document.getElementById('mapLegend');
    if (legend) {
      const presentTypes = [...new Set(nodes.map((node) => node.type))];
      legend.innerHTML = mapLegendHtml(presentTypes);
    }

    const filters = document.getElementById('mapFilters');
    if (filters) {
      const presentTypes = [...new Set(nodes.map((node) => node.type))];
      filters.innerHTML = `<button type="button" class="chip-toggle is-on" data-filter="">All types</button>` +
        presentTypes.map((type) => `<button type="button" class="chip-toggle" data-filter="${escapeHtml(type)}">${escapeHtml(TYPE_LABELS_EXPORT[type] || type)}</button>`).join('');
      filters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-filter]');
        if (!button) return;
        filters.querySelectorAll('[data-filter]').forEach((entry) => entry.classList.toggle('is-on', entry === button));
        mapApi?.setTypeFilter(button.dataset.filter || null);
      });
    }

    document.getElementById('zoomIn')?.addEventListener('click', () => mapApi?.zoomIn());
    document.getElementById('zoomOut')?.addEventListener('click', () => mapApi?.zoomOut());
    document.getElementById('zoomReset')?.addEventListener('click', () => mapApi?.resetView());

    mapBuilt = true;
    if (pendingNode) mapApi.highlightNode(pendingNode);
  }

  // ---------------- actions ----------------
  document.getElementById('copySpeechButton')?.addEventListener('click', async () => {
    const ok = await copyText(analysis.content);
    toast(ok ? 'Speech copied to clipboard.' : 'Could not copy the speech.', ok ? 'success' : 'error');
  });

  document.getElementById('copyReportButton')?.addEventListener('click', async () => {
    const ok = await copyText(analysis.content);
    toast(ok ? 'Speech copied to clipboard.' : 'Could not copy the speech.', ok ? 'success' : 'error');
  });

  document.getElementById('deleteAnalysisButton')?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Delete this report?',
      message: 'The analysis, its findings and its argument graph will be permanently deleted. The speech version is kept with the speech.',
      confirmLabel: 'Delete report',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.delete(`/api/analyses/${analysis.id}`);
      toast('Report deleted.', 'success');
      window.location.href = '/history.html';
    } catch (error) {
      toast(error.message || 'Could not delete the report.', 'error');
    }
  });
}

function renderFinding(finding, index) {
  const confidence = finding.confidence || 'medium';
  return `<article class="finding finding--${escapeHtml(finding.category)}" data-finding-index="${index}" tabindex="0" role="button"
      aria-label="Finding: ${escapeHtml(finding.title)}">
    <div class="finding__top">
      <div>
        <div class="finding__title">${escapeHtml(finding.title)}</div>
        <div class="finding__tags" style="margin-top:7px">
          <span class="chip">${escapeHtml(WEAKNESS_LABELS[finding.weaknessType] || finding.weaknessType)}</span>
          <span class="chip" title="Confidence indicator">${escapeHtml(confidence)} confidence</span>
          ${(finding.tags || []).slice(0, 2).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
      ${finding.nodeId ? `<button type="button" class="btn btn-ghost btn-sm" data-goto-map title="Highlight this node in the argument map">${icons.map}<span>Map node</span></button>` : ''}
    </div>
    ${finding.passage ? `<blockquote class="finding__passage">"${escapeHtml(finding.passage)}"</blockquote>` : ''}
    <p class="finding__detail">${escapeHtml(finding.explanation)}</p>
    <dl class="finding__grid">
      ${finding.whyItMatters ? `<div class="finding__row"><dt>Why it matters</dt><dd>${escapeHtml(finding.whyItMatters)}</dd></div>` : ''}
      ${finding.suggestion ? `<div class="finding__row"><dt>Suggestion</dt><dd>${escapeHtml(finding.suggestion)}</dd></div>` : ''}
    </dl>
  </article>`;
}

function buildDonut(counts) {
  return [
    { label: 'Critical', value: counts.critical || 0, color: '#f87171' },
    { label: 'Moderate', value: counts.moderate || 0, color: '#f59e0b' },
    { label: 'Minor', value: counts.minor || 0, color: '#9ca3af' },
    { label: 'Improvement', value: counts.improvements || 0, color: '#60a5fa' },
    { label: 'Strength', value: counts.strengths || 0, color: '#34d399' },
  ];
}

function componentSection(title, typeLabel, items, { emptyText = 'None were identified in this speech.' } = {}) {
  return `<div class="card">
    <div class="card-header">
      <div class="card-title">${escapeHtml(title)}</div>
      <span class="chip">${items.length}</span>
    </div>
    ${items.length
      ? `<div class="component-block">${items.map((item) => `
        <div class="component-item">
          <div class="component-item__head">
            <span class="tiny muted">${escapeHtml(typeLabel)}</span>
            ${item.strength ? `<span class="chip">${escapeHtml(item.strength)}</span>` : ''}
          </div>
          <p class="component-item__text">${escapeHtml(item.text || '')}</p>
          ${item.excerpt && item.excerpt !== item.text ? `<p class="component-item__excerpt">"${escapeHtml(item.excerpt)}"</p>` : ''}
          ${item.note ? `<p class="tiny muted">${escapeHtml(item.note)}</p>` : ''}
        </div>`).join('')}</div>`
      : `<p class="small muted">${escapeHtml(emptyText)}</p>`}
  </div>`;
}

function renderStructure(structure) {
  const components = [
    ['Claims', 'Claim', structure.claims],
    ['Evidence', 'Evidence', structure.evidence],
    ['Warrants', 'Warrant', structure.warrants],
    ['Impacts', 'Impact', structure.impacts],
    ['Hidden assumptions', 'Assumption', structure.assumptions],
    ['Counterarguments', 'Counterargument', structure.counterarguments],
  ];

  const listSection = (title, rows, renderer) => `<div class="card">
    <div class="card-header"><div class="card-title">${escapeHtml(title)}</div><span class="chip">${rows.length}</span></div>
    ${rows.length ? `<div class="stack-list">${rows.map(renderer).join('')}</div>` : '<p class="small muted">None were identified in this speech.</p>'}
  </div>`;

  return `<div class="grid-2">
    ${components.map(([title, label, items]) => componentSection(title, label, Array.isArray(items) ? items : [])).join('')}
  </div>
  <div class="grid-2" style="margin-top:16px">
    ${listSection('Logical relationships', Array.isArray(structure.relationships) ? structure.relationships : [], (entry) => `
      <div class="component-item">
        <p class="component-item__text">${escapeHtml(entry.description)}</p>
        <p class="tiny muted">${escapeHtml(entry.from)} to ${escapeHtml(entry.to)}</p>
      </div>`)}
    ${listSection('Potential contradictions', Array.isArray(structure.contradictions) ? structure.contradictions : [], (entry) => `
      <div class="component-item">
        <div class="component-item__head"><span class="chip chip-${escapeHtml(entry.severity || 'moderate')}">${escapeHtml(entry.severity || 'moderate')}</span></div>
        <p class="component-item__text">${escapeHtml(entry.title)}</p>
        ${(entry.passages || []).map((passage) => `<p class="component-item__excerpt">"${escapeHtml(passage)}"</p>`).join('')}
        <p class="tiny muted">${escapeHtml(entry.explanation)}</p>
      </div>`)}
    ${listSection('Unsupported assertions', Array.isArray(structure.unsupportedAssertions) ? structure.unsupportedAssertions : [], (entry) => `
      <div class="component-item">
        <p class="component-item__text">${escapeHtml(entry.text)}</p>
        <p class="tiny muted">${escapeHtml(entry.why)}</p>
      </div>`)}
    ${listSection('Missing logical connections', Array.isArray(structure.missingConnections) ? structure.missingConnections : [], (entry) => `
      <div class="component-item">
        <p class="component-item__text">${escapeHtml(entry.description)}</p>
        ${entry.suggestion ? `<p class="tiny muted">Suggestion: ${escapeHtml(entry.suggestion)}</p>` : ''}
      </div>`)}
  </div>
  <div style="margin-top:16px">
    ${listSection('Counterargument analysis', Array.isArray(structure.counterargumentAnalysis) ? structure.counterargumentAnalysis : [], (entry) => `
      <div class="component-item">
        <div class="component-item__head">
          <span class="component-item__text">${escapeHtml(entry.argument)}</span>
          <span class="chip">${escapeHtml(entry.strength)}</span>
        </div>
        <p class="tiny muted">${escapeHtml(entry.response)}</p>
      </div>`)}
  </div>`;
}

function renderRubric(rubric, formatSpec) {
  if (!rubric || !Array.isArray(rubric.dimensions)) {
    return emptyState({ title: 'No rubric returned', message: 'This analysis did not include rubric dimensions.' });
  }

  return `<div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">${icons.scale} ${escapeHtml(formatSpec?.name || 'Format')} rubric</div>
        <p class="small muted" style="margin-top:6px">${escapeHtml(rubric.scale || '5-point analytical rubric')}, each dimension is defined and scored independently.</p>
      </div>
      <span class="chip">${rubric.scored ?? 0}/${rubric.dimensions.length} scored</span>
    </div>
    <div class="stack-sm">
      ${rubric.dimensions.map((dimension) => {
        const score = dimension.score;
        const width = score === null || score === undefined ? 0 : (score / 5) * 100;
        return `<div class="rubric-row">
          <div class="rubric-row__head">
            <span class="rubric-row__name">${escapeHtml(dimension.name)}</span>
            <span class="rubric-row__score">${score === null || score === undefined ? 'Not scored' : `${score} / 5`}</span>
          </div>
          <div class="meter"><div class="meter__fill" style="width:${width}%"></div></div>
          <p class="rubric-row__definition">${escapeHtml(dimension.definition)}</p>
          ${dimension.rationale ? `<p class="rubric-row__rationale">${escapeHtml(dimension.rationale)}</p>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div class="panel-note" style="margin-top:16px">${escapeHtml(rubric.caution || '')}</div>
    ${rubric.scaleDefinitions ? `<div style="margin-top:16px">
      <span class="small muted">Scale definitions</span>
      <div class="stack-sm" style="margin-top:8px">
        ${Object.entries(rubric.scaleDefinitions).map(([score, definition]) => `<p class="tiny muted"><strong style="color:var(--text-soft)">${escapeHtml(score)}</strong>: ${escapeHtml(definition)}</p>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

function isMissing(value) {
  return !value || /^(missing|not addressed|not stated)/i.test(String(value).trim());
}

function chainNode(label, value) {
  const missing = isMissing(value);
  return `<div class="chain__node ${missing ? 'is-missing' : ''}">
    <b>${escapeHtml(label)}</b>
    <span>${escapeHtml(Array.isArray(value) ? (value.length ? value.join(', ') : 'Missing') : value || 'Missing')}</span>
  </div>`;
}

function renderFormatSpecific(formatSpecific) {
  if (!formatSpecific) {
    return emptyState({ title: 'No format-specific output', message: 'This analysis did not include its format-specific block.' });
  }

  const { key, label, description, data } = formatSpecific;

  if (key === 'weighing') {
    return `<div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${icons.scale} ${escapeHtml(label)}</div>
          <p class="small muted" style="margin-top:6px">${escapeHtml(description || '')}</p>
        </div>
      </div>
      <div class="grid-2">
        ${[['Magnitude', data.magnitude], ['Probability', data.probability], ['Timeframe', data.timeframe], ['Comparative framing', data.comparativeFraming]].map(([title, value]) => `
          <div class="component-item">
            <div class="component-item__head">
              <span class="small muted">${escapeHtml(title)}</span>
              ${isMissing(value) ? '<span class="chip chip-critical">Not addressed</span>' : '<span class="chip chip-strength">Addressed</span>'}
            </div>
            <p class="component-item__text">${escapeHtml(value || 'Not addressed in this speech.')}</p>
          </div>`).join('')}
      </div>
      <div style="margin-top:16px">
        <span class="small muted">Dropped arguments</span>
        ${Array.isArray(data.droppedArguments) && data.droppedArguments.length
          ? `<ul class="stack-sm" style="margin:8px 0 0;padding-left:20px;color:var(--text-soft);font-size:.86rem">${data.droppedArguments.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
          : '<p class="small muted" style="margin-top:6px">No dropped arguments were found in this speech.</p>'}
      </div>
    </div>`;
  }

  if (key === 'frameworkCheck') {
    const badgeClass = data.consistency === 'consistent'
      ? 'chip-strength'
      : data.consistency === 'inconsistent'
        ? 'chip-critical'
        : data.consistency === 'partially_consistent'
          ? 'chip-moderate'
          : 'chip-minor';
    return `<div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${icons.scale} ${escapeHtml(label)}</div>
          <p class="small muted" style="margin-top:6px">${escapeHtml(description || '')}</p>
        </div>
        <span class="chip ${badgeClass}">${escapeHtml(String(data.consistency || 'unclear').replace(/_/g, ' '))}</span>
      </div>
      <div class="grid-2">
        <div class="component-item">
          <span class="small muted">Value</span>
          <p class="component-item__text">${escapeHtml(data.value)}</p>
        </div>
        <div class="component-item">
          <span class="small muted">Criterion</span>
          <p class="component-item__text">${escapeHtml(data.criterion)}</p>
        </div>
      </div>
      ${data.notes ? `<p class="small" style="margin-top:14px;color:var(--text-soft)">${escapeHtml(data.notes)}</p>` : ''}
      <div style="margin-top:14px">
        <span class="small muted">Framework tensions</span>
        ${Array.isArray(data.tensions) && data.tensions.length
          ? `<div class="stack-sm" style="margin-top:8px">${data.tensions.map((tension) => `<div class="resolution-item resolution-item--open">${icons.alert}<span>${escapeHtml(tension)}</span></div>`).join('')}</div>`
          : '<p class="small muted" style="margin-top:6px">No explicit tensions were identified.</p>'}
      </div>
      <div style="margin-top:14px">
        <span class="small muted">Framework interaction</span>
        <p class="small muted" style="margin-top:6px">${escapeHtml(data.frameworkInteraction || 'Not addressed in this speech.')}</p>
      </div>
    </div>`;
  }

  if (key === 'disadvantageChains') {
    const chains = Array.isArray(data.chains) ? data.chains : [];
    return `<div class="stack-lg">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${icons.layers} ${escapeHtml(label)}</div>
            <p class="small muted" style="margin-top:6px">${escapeHtml(description || '')}</p>
          </div>
          <span class="chip">${chains.length} chain${chains.length === 1 ? '' : 's'}</span>
        </div>
        ${chains.length ? `<div class="stack">${chains.map((chain) => `
          <div class="chain">
            <div class="row-between">
              <strong style="font-size:.92rem">${escapeHtml(chain.name)}</strong>
              <span class="chip chip-${chain.strength === 'strong' ? 'strength' : chain.strength === 'weak' ? 'critical' : 'moderate'}">${escapeHtml(chain.strength)}</span>
            </div>
            <div class="chain__flow">
              ${chainNode('Uniqueness', chain.uniqueness)}
              ${chainNode('Link', chain.link)}
              ${chainNode('Internal links', chain.internalLinks)}
              ${chainNode('Impact', chain.impact)}
            </div>
            ${chain.notes ? `<p class="tiny muted">${escapeHtml(chain.notes)}</p>` : ''}
          </div>`).join('')}</div>` : '<p class="small muted">No disadvantage chains were identified in this speech.</p>'}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">${icons.file} Stock issues</div>
          <dl style="margin:0">
            ${Object.entries({
              Harms: data.stockIssues?.harms,
              Inherency: data.stockIssues?.inherency,
              Solvency: data.stockIssues?.solvency,
              Topicality: data.stockIssues?.topicality,
              'Counterplan / Kritik': data.stockIssues?.counterplanOrKritik,
            }).map(([term, value]) => `<div class="info-row"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value || 'Not addressed in this speech.')}</dd></div>`).join('')}
          </dl>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">${icons.scale} Impact calculus</div>
          <p class="small" style="color:var(--text-soft)">${escapeHtml(data.impactCalculus || 'Not addressed in this speech.')}</p>
          <p class="tiny muted" style="margin-top:14px">A complete chain requires uniqueness, a link, at least one internal link and a terminal impact. Missing nodes are highlighted in red above.</p>
        </div>
      </div>
    </div>`;
  }

  if (key === 'legislativeAnalysis') {
    const provisions = Array.isArray(data.provisions) ? data.provisions : [];
    return `<div class="stack-lg">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${icons.file} ${escapeHtml(label)}</div>
            <p class="small muted" style="margin-top:6px">${escapeHtml(description || '')}</p>
          </div>
          <span class="chip">${provisions.length} provision${provisions.length === 1 ? '' : 's'}</span>
        </div>
        ${provisions.length ? `<div class="stack">${provisions.map((provision) => `
          <div class="component-item">
            <div class="component-item__head">
              <span class="small muted">Provision</span>
            </div>
            <p class="component-item__text">${escapeHtml(provision.text)}</p>
            <div class="grid-2" style="margin-top:6px">
              <div><span class="tiny muted">Interpretation</span><p class="small" style="color:var(--text-soft)">${escapeHtml(provision.interpretation || 'Not set')}</p></div>
              <div><span class="tiny muted">Strongest affirmative use</span><p class="small" style="color:var(--text-soft)">${escapeHtml(provision.support || 'Not set')}</p></div>
            </div>
            <div><span class="tiny muted">Strongest legislative objection</span><p class="small" style="color:var(--text-soft)">${escapeHtml(provision.attack || 'Not set')}</p></div>
          </div>`).join('')}</div>` : '<p class="small muted">No legislative provisions were identified in this speech.</p>'}
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">${icons.file} Procedure &amp; questioning</div>
          <dl style="margin:0">
            <div class="info-row"><dt>Procedural notes</dt><dd>${escapeHtml(data.proceduralNotes || 'Not addressed in this speech.')}</dd></div>
            <div class="info-row"><dt>Questioning</dt><dd>${escapeHtml(data.questioning || 'Not addressed in this speech.')}</dd></div>
          </dl>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">${icons.scale} Persuasiveness</div>
          <p class="small" style="color:var(--text-soft)">${escapeHtml(data.persuasiveness || 'Not addressed in this speech.')}</p>
        </div>
      </div>
    </div>`;
  }

  if (key === 'teamConsistency') {
    const contradictions = Array.isArray(data.contradictions) ? data.contradictions : [];
    const repetition = Array.isArray(data.repetition) ? data.repetition : [];
    return `<div class="stack-lg">
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${icons.layers} ${escapeHtml(label)}</div>
            <p class="small muted" style="margin-top:6px">${escapeHtml(description || '')}</p>
          </div>
        </div>
        <div class="info-row"><dt>Role adherence</dt><dd>${escapeHtml(data.roleAdherence || 'Not assessed.')}</dd></div>
        <div class="info-row"><dt>Comparative stance</dt><dd>${escapeHtml(data.comparativeStance || 'Not addressed in this speech.')}</dd></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">${icons.alert} Contradictions</div><span class="chip">${contradictions.length}</span></div>
          ${contradictions.length ? `<div class="stack-sm">${contradictions.map((entry) => `
            <div class="resolution-item resolution-item--open">${icons.alert}<span><strong>${escapeHtml(entry.between)}</strong>: ${escapeHtml(entry.description)} <em>(${escapeHtml(entry.severity)})</em></span></div>`).join('')}</div>`
            : '<p class="small muted">No contradictions were identified in this single speech. Team consistency across speakers requires analysing each speech separately.</p>'}
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">${icons.refresh} Repetition</div><span class="chip">${repetition.length}</span></div>
          ${repetition.length ? `<div class="stack-sm">${repetition.map((entry) => `
            <div class="component-item"><p class="component-item__text">${escapeHtml(entry.idea)}</p><p class="tiny muted">${escapeHtml(entry.speakers)}</p></div>`).join('')}</div>`
            : '<p class="small muted">No significant repetition was identified.</p>'}
        </div>
      </div>
    </div>`;
  }

  return emptyState({ title: 'Format tool unavailable', message: 'This format-specific block could not be rendered.' });
}

main().catch((error) => {
  ROOT.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'The report could not be rendered.')}</span></div>`;
});
