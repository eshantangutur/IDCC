import {
  api,
  escapeHtml,
  formatChip,
  icons,
  param,
  setButtonLoading,
  toast,
} from './core.js';
import { mountShell, demoBanner, liveBanner } from './shell.js';

const shell = await mountShell({
  page: 'analyzer',
  title: 'New analysis',
  subtitle: 'Reconstruct a speech and report its weaknesses',
  actionsHtml: '<a class="btn btn-ghost btn-sm" href="/history.html">History</a>',
});

if (shell) {
  const { meta } = shell;
  const form = document.getElementById('analysisForm');
  const formatInput = document.getElementById('formatInput');
  const formatPicker = document.getElementById('formatPicker');
  const sideSelect = document.getElementById('side');
  const speechTypeSelect = document.getElementById('speechType');
  const resolutionInput = document.getElementById('resolution');
  const contentInput = document.getElementById('content');
  const caseSelect = document.getElementById('caseId');
  const wordCount = document.getElementById('wordCount');
  const charCount = document.getElementById('charCount');
  const analyzeButton = document.getElementById('analyzeButton');
  const errorBox = document.getElementById('formError');
  const errorText = errorBox.querySelector('[data-error-text]');
  const retryButton = errorBox.querySelector('[data-retry]');
  const analyzingSlot = document.getElementById('analyzingSlot');
  const reviseSlot = document.getElementById('reviseSlot');
  const clearButton = document.getElementById('clearButton');

  document.getElementById('modeSlot').innerHTML = meta.ai.mode === 'demo' ? demoBanner(meta) : liveBanner(meta);

  const maxChars = meta.limits?.maxSpeechChars ?? 20000;
  contentInput.setAttribute('maxlength', String(maxChars));

  let currentFormat = meta.formats.find((entry) => entry.id === param('format')) || meta.formats[0];
  let speechId = null;
  let pending = false;

  function getFormat(id) {
    return meta.formats.find((entry) => entry.id === id) || meta.formats[0];
  }

  function renderFormatPicker() {
    formatPicker.innerHTML = meta.formats.map((format) => `
      <button type="button" class="format-option ${format.id === currentFormat.id ? 'is-selected' : ''}"
        role="radio" aria-checked="${format.id === currentFormat.id}" data-format="${format.id}">
        <span class="format-option__abbr">${escapeHtml(format.abbreviation.toUpperCase())}</span>
        <strong>${escapeHtml(format.name)}</strong>
        <span>${escapeHtml(format.tagline)}</span>
      </button>`).join('');
    formatPicker.querySelectorAll('[data-format]').forEach((button) => {
      button.addEventListener('click', () => {
        selectFormat(button.dataset.format);
        const url = new URL(window.location.href);
        url.searchParams.set('format', button.dataset.format);
        if (!param('speechId')) window.history.replaceState({}, '', url);
      });
    });
  }

  function selectFormat(formatId) {
    currentFormat = getFormat(formatId);
    formatInput.value = currentFormat.id;
    renderFormatPicker();

    sideSelect.innerHTML = currentFormat.sides
      .map((side) => `<option value="${escapeHtml(side.id)}">${escapeHtml(side.label)}</option>`)
      .join('');
    speechTypeSelect.innerHTML = currentFormat.speechTypes
      .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
      .join('');

    renderGuide();
  }

  function renderGuide() {
    document.getElementById('formatGuide').innerHTML = `
      <div class="card-header" style="margin-bottom:10px">
        <div>
          <span class="eyebrow">${escapeHtml(currentFormat.abbreviation.toUpperCase())} standard</span>
          <h3 style="margin-top:4px">${escapeHtml(currentFormat.name)}</h3>
        </div>
        ${formatChip(currentFormat.id)}
      </div>
      <p class="small muted">${escapeHtml(currentFormat.description)}</p>
      <div style="margin-top:14px">
        <span class="eyebrow">Evaluation focus</span>
        <div class="focus-list" style="margin-top:8px">
          ${currentFormat.focusAreas.map((area) => `<span>${escapeHtml(area)}</span>`).join('')}
        </div>
      </div>
      <div class="panel-note" style="margin-top:14px">
        <strong style="color:var(--text)">${escapeHtml(currentFormat.specialTool.label)}</strong><br>
        ${escapeHtml(currentFormat.specialTool.description)}
      </div>
      <div style="margin-top:14px">
        <span class="eyebrow">Rubric dimensions</span>
        <div class="stack-sm" style="margin-top:8px">
          ${currentFormat.rubric.map((dimension) => `
            <div class="tiny muted"><strong style="color:var(--text-soft)">${escapeHtml(dimension.name)}</strong> — ${escapeHtml(dimension.definition)}</div>`).join('')}
        </div>
      </div>`;
  }

  function updateCounts() {
    const text = contentInput.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    wordCount.textContent = `${words} word${words === 1 ? '' : 's'}`;
    charCount.textContent = `${text.length} / ${maxChars} characters`;
    charCount.style.color = text.length > maxChars ? 'var(--critical)' : '';
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
    retryButton.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    retryButton.hidden = true;
  }

  function validate() {
    const resolution = resolutionInput.value.trim();
    if (resolution.length < 5) {
      resolutionInput.focus();
      return 'Enter the resolution or topic you are debating (at least 5 characters).';
    }
    if (!sideSelect.value) return 'Select your side.';
    if (!speechTypeSelect.value) return 'Select the speech type.';
    const content = contentInput.value.trim();
    if (!content) {
      contentInput.focus();
      return 'Paste the speech text you want analysed.';
    }
    if (content.length < 40) {
      contentInput.focus();
      return 'The speech is too short to analyse. Paste at least a full paragraph (40 characters).';
    }
    if (content.length > maxChars) {
      contentInput.focus();
      return `The speech exceeds the ${maxChars} character limit. Split it into separate speeches.`;
    }
    return null;
  }

  function showAnalyzing() {
    const startedAt = Date.now();
    analyzingSlot.innerHTML = `
      <div class="analyzing" role="status" aria-live="polite">
        <div class="analyzing__head">
          <span class="spinner spinner--lg" aria-hidden="true"></span>
          <div>
            <strong>${meta.ai.mode === 'demo' ? 'Running local structural analysis…' : 'Analyzing your argument…'}</strong>
            <div class="tiny muted">${meta.ai.mode === 'demo'
              ? 'Demo mode: local heuristics extract structure from your text. No model is called.'
              : `Live mode: ${escapeHtml(meta.ai.provider)} is reconstructing the argument. This can take 20–60 seconds.`}</div>
          </div>
          <span class="chip" data-elapsed style="margin-left:auto">0s</span>
        </div>
        <div class="steps">
          <div class="step is-active"><span class="step__dot"></span><span>Send the speech with the ${escapeHtml(currentFormat.abbreviation.toUpperCase())} rubric</span></div>
          <div class="step"><span class="step__dot"></span><span>Validate the structured response</span></div>
          <div class="step"><span class="step__dot"></span><span>Store findings and the argument graph</span></div>
        </div>
      </div>`;
    const elapsedElement = analyzingSlot.querySelector('[data-elapsed]');
    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (elapsedElement) elapsedElement.textContent = `${seconds}s`;
    }, 500);
    return {
      setStage(stage) {
        analyzingSlot.querySelectorAll('.step').forEach((step, index) => {
          step.classList.toggle('is-done', index < stage);
          step.classList.toggle('is-active', index === stage);
        });
      },
      stop() {
        clearInterval(timer);
        analyzingSlot.innerHTML = '';
      },
    };
  }

  async function submitAnalysis() {
    if (pending) return;
    clearError();
    const problem = validate();
    if (problem) return showError(problem);

    pending = true;
    setButtonLoading(analyzeButton, true, 'Analysing…');
    const progress = showAnalyzing();

    const payload = {
      format: currentFormat.id,
      resolution: resolutionInput.value.trim(),
      side: sideSelect.value,
      speechType: speechTypeSelect.value,
      content: contentInput.value.trim(),
      caseId: caseSelect.value ? Number(caseSelect.value) : null,
    };
    if (speechId) payload.speechId = speechId;

    // Reflect real phases as the request progresses.
    setTimeout(() => progress.setStage(1), 900);

    try {
      const result = await api.post('/api/analyze', payload, { timeout: 180000 });
      progress.setStage(3);
      toast(
        result.comparison
          ? `Revision analysed. ${result.comparison.resolvedCount} previous weakness${result.comparison.resolvedCount === 1 ? '' : 'es'} resolved.`
          : 'Analysis complete. Opening the report…',
        'success',
        { duration: 2600 }
      );
      window.location.href = `/report.html?id=${result.analysisId}`;
    } catch (error) {
      progress.stop();
      pending = false;
      setButtonLoading(analyzeButton, false);
      showError(
        error.code === 'ai_unavailable' || error.code === 'ai_invalid_response'
          ? `${error.message} Your speech was not saved. You can retry, or switch AI_DEMO_MODE on to analyse locally.`
          : error.message || 'The analysis could not be completed.'
      );
      toast('Analysis failed.', 'error');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAnalysis();
  });

  retryButton.addEventListener('click', () => {
    clearError();
    submitAnalysis();
  });

  contentInput.addEventListener('input', updateCounts);
  contentInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submitAnalysis();
    }
  });
  clearButton.addEventListener('click', () => {
    contentInput.value = '';
    updateCounts();
    clearError();
    contentInput.focus();
  });

  renderFormatPicker();
  selectFormat(currentFormat.id);
  updateCounts();

  // Load saved cases into the selector.
  try {
    const { cases } = await api.get('/api/cases?limit=200');
    caseSelect.innerHTML = '<option value="">No case — standalone analysis</option>' + cases
      .map((entry) => `<option value="${entry.id}">${escapeHtml(entry.title)} · ${escapeHtml(entry.format.toUpperCase())}</option>`)
      .join('');
  } catch (error) {
    toast(error.message || 'Could not load saved cases.', 'error');
  }

  const caseIdParam = param('caseId');
  if (caseIdParam) {
    try {
      const data = await api.get(`/api/cases/${Number(caseIdParam)}`);
      selectFormat(data.case.format);
      sideSelect.value = data.case.side;
      resolutionInput.value = data.case.resolution;
      caseSelect.value = String(data.case.id);
      toast(`Loaded case: ${data.case.title}`, 'info');
    } catch (error) {
      toast(error.message || 'That case could not be loaded.', 'error');
    }
  }

  const speechIdParam = param('speechId');
  if (speechIdParam) {
    try {
      const [speechData, versionsData] = await Promise.all([
        api.get(`/api/speeches/${Number(speechIdParam)}`),
        api.get(`/api/speeches/${Number(speechIdParam)}/versions?include=content`),
      ]);
      speechId = speechData.speech.id;
      selectFormat(speechData.speech.format);
      sideSelect.value = speechData.speech.side;
      speechTypeSelect.value = speechData.speech.speechType;
      resolutionInput.value = speechData.speech.resolution;
      if (speechData.speech.caseId) caseSelect.value = String(speechData.speech.caseId);
      const latest = versionsData.versions[0];
      if (latest) contentInput.value = latest.content;
      updateCounts();

      reviseSlot.innerHTML = `
        <div class="banner banner--info">
          ${icons.info}
          <div>
            <strong>Revision mode.</strong> This analysis will create version ${speechData.speech.latestVersion + 1} of
            “${escapeHtml(speechData.speech.title)}” and compare it with the previous report.
            <a href="/revise.html?id=${speechData.speech.id}">Open the revision workspace</a> for a diff and readiness checklist.
          </div>
        </div>`;
    } catch (error) {
      toast(error.message || 'That speech could not be loaded.', 'error');
    }
  }
}
