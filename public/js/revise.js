import {
  api,
  escapeHtml,
  formatChip,
  formatDate,
  icons,
  param,
  setButtonLoading,
  toast,
  emptyState,
  SIDE_LABELS,
  debounce,
} from './core.js';
import { mountShell, demoBanner } from './shell.js';
import { renderDiffPanel } from './diff.js';

const speechId = Number(param('id'));

const shell = await mountShell({
  page: 'history',
  title: 'Revision workspace',
  subtitle: 'Compare versions and re-analyse',
  actionsHtml: '<a class="btn btn-ghost btn-sm" href="/history.html">History</a>',
});

if (shell) {
  const { meta } = shell;

  if (!Number.isInteger(speechId) || speechId <= 0) {
    document.getElementById('speechTitle').textContent = 'Speech not specified';
    document.getElementById('noticeSlot').innerHTML = '<div class="banner banner--error">No speech id was provided. Open a report and choose “Revise speech”.</div>';
  } else {
    const originalEditor = document.getElementById('originalEditor');
    const revisedEditor = document.getElementById('revisedEditor');
    const baselineSelect = document.getElementById('baselineSelect');
    const diffPanel = document.getElementById('diffPanel');
    const diffStats = document.getElementById('diffStats');
    const diffToggle = document.getElementById('diffToggle');
    const versionList = document.getElementById('versionList');
    const versionLabel = document.getElementById('versionLabel');
    const saveButton = document.getElementById('saveVersionButton');
    const reanalyzeButton = document.getElementById('reanalyzeButton');
    const trackingPanel = document.getElementById('trackingPanel');

    let speech = null;
    let versions = [];
    let analyses = [];
    let baselineVersion = 1;
    let busy = false;

    function updateCounts() {
      const text = revisedEditor.value;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      document.getElementById('revisedMeta').textContent = `${words} word${words === 1 ? '' : 's'}`;
    }

    function updateDiff() {
      const baseline = versions.find((entry) => entry.version === baselineVersion);
      if (!baseline) return;
      if (!diffToggle.checked) {
        diffPanel.innerHTML = '<span class="muted">Diff highlighting is off.</span>';
        diffStats.textContent = 'Hidden';
        return;
      }
      const stats = renderDiffPanel(diffPanel, baseline.content, revisedEditor.value);
      diffStats.textContent = `+${stats.added} / −${stats.removed} words`;
    }

    const updateDiffDebounced = debounce(updateDiff, 220);

    function fillBaselineOptions() {
      baselineSelect.innerHTML = versions
        .map((entry) => `<option value="${entry.version}" ${entry.version === baselineVersion ? 'selected' : ''}>Version ${entry.version}${entry.label ? ` · ${escapeHtml(entry.label)}` : ''}</option>`)
        .join('');
      const baseline = versions.find((entry) => entry.version === baselineVersion);
      if (baseline) {
        originalEditor.value = baseline.content;
        document.getElementById('originalMeta').textContent = `${baseline.wordCount} words · ${formatDate(baseline.createdAt, { time: false })}`;
      }
    }

    function renderVersions() {
      document.getElementById('versionCount').textContent = String(versions.length);
      versionList.innerHTML = versions.map((entry) => {
        const isLatest = entry.version === speech.latestVersion;
        return `<div class="version-item ${isLatest ? 'is-current' : ''}">
          <span class="chip">v${entry.version}</span>
          <span class="grow truncate">${escapeHtml(entry.label || 'Untitled version')}</span>
          <span class="tiny muted nowrap">${entry.wordCount} words</span>
          <button type="button" class="btn btn-ghost btn-sm" data-load-version="${entry.version}">Load</button>
        </div>`;
      }).join('') || '<p class="small muted">No versions stored.</p>';

      versionList.querySelectorAll('[data-load-version]').forEach((button) => {
        button.addEventListener('click', () => {
          const version = Number(button.dataset.loadVersion);
          const entry = versions.find((candidate) => candidate.version === version);
          if (!entry) return;
          revisedEditor.value = entry.content;
          updateCounts();
          updateDiff();
          toast(`Loaded version ${version} into the editor.`, 'info');
        });
      });

      const analysisLinks = document.getElementById('analysisLinks');
      analysisLinks.innerHTML = analyses.length
        ? `<span class="eyebrow">Reports on this speech</span>
           <div class="stack-sm" style="margin-top:8px">
             ${analyses.map((entry) => `<a class="list__item" href="/report.html?id=${entry.id}" style="padding:8px 0">
               <div class="list__main">
                 <div class="list__title">Report #${entry.id} · ${escapeHtml(entry.speechType)}</div>
                 <div class="list__meta"><span>${escapeHtml(formatDate(entry.createdAt))}</span>${entry.isDemo ? '<span class="chip chip-demo">Demo</span>' : ''}</div>
               </div>
               <div class="list__side">Open →</div>
             </a>`).join('')}
           </div>`
        : '';
    }

    async function loadTracking() {
      const latest = analyses[0];
      if (!latest) {
        trackingPanel.innerHTML = emptyState({
          title: 'No analysis yet',
          message: 'Run the first analysis to establish a baseline for weakness tracking.',
        });
        document.getElementById('trackingCount').textContent = '0 open';
        return;
      }

      try {
        const { analysis } = await api.get(`/api/analyses/${latest.id}`);
        const findings = analysis.result?.findings || [];
        const comparison = analysis.comparison;

        if (comparison) {
          const resolved = comparison.resolved || [];
          const persistent = comparison.persistent || [];
          document.getElementById('trackingCount').textContent = `${resolved.length} resolved · ${persistent.length} open`;
          trackingPanel.innerHTML = `
            <div class="resolution-list">
              ${resolved.slice(0, 5).map((finding) => `<div class="resolution-item resolution-item--resolved">${icons.check}<span><strong>Resolved:</strong> ${escapeHtml(finding.title)}</span></div>`).join('')}
              ${persistent.slice(0, 6).map((finding) => `<div class="resolution-item resolution-item--open">${icons.alert}<span><strong>Still open:</strong> ${escapeHtml(finding.title)}</span></div>`).join('')}
            </div>
            ${resolved.length === 0 && persistent.length === 0 ? '<p class="small muted" style="margin-top:10px">No tracked findings were carried across this comparison.</p>' : ''}
            <p class="tiny muted" style="margin-top:12px">Comparison against report #${comparison.previousAnalysisId}. Findings count as resolved when their passage no longer appears in the revised text.</p>
            <a class="btn btn-secondary btn-sm" style="margin-top:12px" href="/report.html?id=${analysis.id}">Open latest report</a>`;
          return;
        }

        const open = findings.filter((finding) => finding.category !== 'strength');
        document.getElementById('trackingCount').textContent = `${open.length} open`;
        trackingPanel.innerHTML = `
          <div class="resolution-list">
            ${open.slice(0, 8).map((finding) => `<div class="resolution-item resolution-item--open">${icons.alert}<span><strong>${escapeHtml(finding.title)}</strong><br><span class="tiny muted">${escapeHtml(finding.weaknessType)} · ${escapeHtml(finding.confidence)} confidence</span></span></div>`).join('')}
          </div>
          ${open.length === 0 ? '<p class="small muted">The latest report found no open weaknesses.</p>' : ''}
          <p class="tiny muted" style="margin-top:12px">This report is not yet a revision, so nothing can be marked resolved. Re-run the analysis on an edited text to enable tracking.</p>
          <a class="btn btn-secondary btn-sm" style="margin-top:12px" href="/report.html?id=${analysis.id}">Open latest report</a>`;
      } catch (error) {
        trackingPanel.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'Could not load weakness tracking.')}</span></div>`;
      }
    }

    async function loadSpeech() {
      const [speechData, versionsData] = await Promise.all([
        api.get(`/api/speeches/${speechId}`),
        api.get(`/api/speeches/${speechId}/versions?include=content`),
      ]);
      speech = speechData.speech;
      analyses = speechData.analyses;
      versions = versionsData.versions;

      document.title = `${speech.title} — Revision workspace`;
      document.getElementById('speechTitle').textContent = speech.title;
      document.getElementById('speechMeta').innerHTML =
        `${formatChip(speech.format)} <span class="chip">${escapeHtml(SIDE_LABELS[speech.side] || speech.side)}</span>
         <span class="chip">${escapeHtml(speech.speechType)}</span>
         <span class="tiny muted">${escapeHtml(speech.resolution)}</span>`;

      document.getElementById('headerActions').innerHTML = `
        ${analyses[0] ? `<a class="btn btn-secondary btn-sm" href="/report.html?id=${analyses[0].id}">Latest report</a>` : ''}
        <a class="btn btn-ghost btn-sm" href="/analyzer.html?speechId=${speech.id}">${icons.plus}<span>Analyze in new workspace</span></a>`;

      if (versions.length) {
        baselineVersion = versions[versions.length - 1].version;
        fillBaselineOptions();
        const latest = versions[0];
        if (!revisedEditor.value.trim()) revisedEditor.value = latest.content;
        updateCounts();
        updateDiff();
      }

      versionLabel.value = '';
      renderVersions();
      await loadTracking();
    }

    baselineSelect.addEventListener('change', () => {
      baselineVersion = Number(baselineSelect.value);
      fillBaselineOptions();
      updateDiff();
    });

    revisedEditor.addEventListener('input', () => {
      updateCounts();
      updateDiffDebounced();
    });

    diffToggle.addEventListener('change', updateDiff);

    saveButton.addEventListener('click', async () => {
      if (busy) return;
      const content = revisedEditor.value.trim();
      if (content.length < 20) {
        toast('Write at least a full sentence before saving a version.', 'error');
        return;
      }
      busy = true;
      setButtonLoading(saveButton, true, 'Saving…');
      try {
        const result = await api.post(`/api/speeches/${speechId}/versions`, {
          content,
          label: versionLabel.value.trim() || null,
        });
        toast(result.created ? `Version ${result.version.version} saved.` : 'This text matches the latest version — nothing new was saved.', result.created ? 'success' : 'info');
        await loadSpeech();
      } catch (error) {
        toast(error.message || 'Could not save the version.', 'error');
      } finally {
        busy = false;
        setButtonLoading(saveButton, false);
      }
    });

    reanalyzeButton.addEventListener('click', async () => {
      if (busy || !speech) return;
      const content = revisedEditor.value.trim();
      if (content.length < 40) {
        toast('The revised speech is too short to analyse. Paste at least a paragraph.', 'error');
        return;
      }
      busy = true;
      setButtonLoading(reanalyzeButton, true, 'Analysing…');
      try {
        const result = await api.post('/api/analyze', {
          format: speech.format,
          resolution: speech.resolution,
          side: speech.side,
          speechType: speech.speechType,
          content,
          speechId: speech.id,
          caseId: speech.caseId || null,
        }, { timeout: 180000 });
        const resolved = result.comparison?.resolvedCount ?? 0;
        toast(`New analysis complete. ${resolved} previous weakness${resolved === 1 ? '' : 'es'} resolved.`, 'success', { duration: 2600 });
        window.location.href = `/report.html?id=${result.analysisId}`;
      } catch (error) {
        toast(error.message || 'The analysis could not be completed.', 'error');
      } finally {
        busy = false;
        setButtonLoading(reanalyzeButton, false);
      }
    });

    if (meta.ai.mode === 'demo') {
      document.getElementById('noticeSlot').innerHTML = demoBanner(meta);
    }

    try {
      await loadSpeech();
    } catch (error) {
      document.getElementById('speechTitle').textContent = 'Speech unavailable';
      document.getElementById('noticeSlot').innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(error.message || 'This speech could not be loaded.')}</span></div>`;
      versionList.innerHTML = '';
    }
  }
}
