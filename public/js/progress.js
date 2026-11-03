import { api, emptyState, escapeHtml, formatChip, formatDate, icons, relativeTime, SIDE_LABELS } from './core.js';
import { mountShell } from './shell.js';

const shell = await mountShell({
  page: 'progress',
  title: 'My progress',
  subtitle: 'Skill development from stored analyses',
});

if (shell) {
  const { meta } = shell;
  const state = { format: '', skill: '', from: '', to: '', data: null };

  const formatSelect = document.getElementById('progressFormat');
  formatSelect.innerHTML = `<option value="">All formats</option>${meta.formats
    .map((format) => `<option value="${format.id}">${escapeHtml(format.name)}</option>`)
    .join('')}`;

  const skillSelect = document.getElementById('progressSkill');
  const fromInput = document.getElementById('progressFrom');
  const toInput = document.getElementById('progressTo');

  formatSelect.addEventListener('change', async () => {
    state.format = formatSelect.value;
    state.skill = '';
    await load();
  });
  skillSelect.addEventListener('change', () => {
    state.skill = skillSelect.value;
    load();
  });
  fromInput.addEventListener('change', () => {
    state.from = fromInput.value;
    load();
  });
  toInput.addEventListener('change', () => {
    state.to = toInput.value;
    load();
  });
  document.getElementById('progressReset').addEventListener('click', () => {
    state.format = '';
    state.skill = '';
    state.from = '';
    state.to = '';
    formatSelect.value = '';
    fromInput.value = '';
    toInput.value = '';
    load();
  });

  await load();

  async function load() {
    const params = new URLSearchParams();
    if (state.format) params.set('format', state.format);
    if (state.skill) params.set('skill', state.skill);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);

    const root = document.getElementById('progressRoot');
    root.innerHTML = '<div class="skeleton" style="height:240px"></div>';

    try {
      const data = await api.get(`/api/progress?${params.toString()}`);
      state.data = data;
      document.getElementById('progressCount').textContent = `${data.totals.assessments} assessment${
        data.totals.assessments === 1 ? '' : 's'
      }`;
      populateSkills(data);
      render(data);
    } catch (error) {
      root.innerHTML = `<div class="banner banner--error">${icons.alert}<span>${escapeHtml(
        error.message || 'Could not load your progress.'
      )}</span></div>`;
    }
  }

  function populateSkills(data) {
    const selected = state.skill;
    const skills = new Map();
    for (const skill of data.skills) skills.set(skill.key, skill.name);
    const available = data.availableFormats.length
      ? data.availableFormats.flatMap((format) => format.skills)
      : meta.formats.flatMap((format) => format.rubric.map((entry) => ({ key: entry.key, name: entry.name })));
    for (const entry of available) if (!skills.has(entry.key)) skills.set(entry.key, entry.name);

    document.getElementById('progressSkill').innerHTML =
      '<option value="">All skills</option>' +
      [...skills.entries()]
        .map(([key, name]) => `<option value="${escapeHtml(key)}" ${key === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`)
        .join('');
  }

  function render(data) {
    const root = document.getElementById('progressRoot');

    if (data.totals.assessments === 0) {
      root.innerHTML = emptyState({
        title: 'No assessments yet',
        message:
          'Progress is built only from saved analyses. Run the speech analyzer, or add a round and run the round analysis, and the ratings from those reports will appear here.',
        action: '<div class="row" style="gap:8px;justify-content:center"><a class="btn btn-primary btn-sm" href="/analyzer.html">Analyze a speech</a><a class="btn btn-secondary btn-sm" href="/rounds.html">Start a round</a></div>',
      });
      return;
    }

    const kpis = [
      ['Assessments', data.totals.assessments, 'Stored rubric ratings'],
      ['Skills tracked', data.totals.skillsTracked, 'Across your history'],
      ['From speeches', data.totals.speechAssessments, 'Speech analyses'],
      ['From rounds', data.totals.roundAssessments, 'Round analyses'],
    ];

    root.innerHTML = `
      <div class="quick-stats">
        ${kpis
          .map(
            ([label, value, hint]) => `<div class="kpi">
              <span class="kpi__value">${Number(value) || 0}</span>
              <span class="kpi__label">${escapeHtml(label)}</span>
              <span class="tiny muted">${escapeHtml(hint)}</span>
            </div>`
          )
          .join('')}
      </div>

      <div class="banner banner--info">${icons.info}<div>${escapeHtml(data.note)}</div></div>

      ${data.focusAreas.length ? `<section class="card">
        <div class="card-header"><h2 class="card-title">Where to focus next</h2></div>
        <div class="card-body stack-sm">
          ${data.focusAreas
            .map(
              (area) => `<div class="row-between" style="gap:10px">
                <div>
                  <div class="small" style="font-weight:600">${escapeHtml(area.name)} ${formatChip(area.format)}</div>
                  <div class="tiny muted">${escapeHtml(area.recommendation || 'No recommendation stored yet.')}</div>
                </div>
                <span class="chip">${area.latest}/5</span>
              </div>`
            )
            .join('')}
        </div>
      </section>` : ''}

      ${data.repeatedWeaknesses.length ? `<section class="card">
        <div class="card-header"><h2 class="card-title">Repeated weaknesses</h2></div>
        <div class="card-body stack-sm">
          ${data.repeatedWeaknesses
            .map(
              (entry) => `<div class="row-between" style="gap:10px">
                <div>
                  <div class="small" style="font-weight:600">${escapeHtml(entry.name)} ${formatChip(entry.format)}</div>
                  <div class="tiny muted">Rated 2 or lower in ${entry.lowCount} of ${entry.count} assessments.</div>
                </div>
                <span class="status-chip status-chip--warning">Needs work</span>
              </div>`
            )
            .join('')}
        </div>
      </section>` : ''}

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">Skill development</h2>
          <span class="tiny muted">Previous and latest rating, with the evidence behind each one</span>
        </div>
        <div class="card-body">
          ${data.skills.length ? data.skills.map((skill) => skillRow(skill)).join('') : '<div class="empty-inline">No skills match these filters.</div>'}
        </div>
      </section>

      ${data.improvements.length ? `<section class="card">
        <div class="card-header"><h2 class="card-title">Improvements</h2></div>
        <div class="card-body stack-sm">
          ${data.improvements
            .map(
              (entry) => `<div class="row-between" style="gap:10px">
                <div>
                  <div class="small" style="font-weight:600">${escapeHtml(entry.name)} ${formatChip(entry.format)}</div>
                  <div class="tiny muted">From ${entry.first}/5 to ${entry.latest}/5 across ${entry.count} assessments.</div>
                </div>
                <span class="status-chip status-chip--positive">+${entry.improvement}</span>
              </div>`
            )
            .join('')}
        </div>
      </section>` : ''}
    `;
  }

  function skillRow(skill) {
    const tone = skill.latest <= 2 ? 'is-low' : skill.latest === 3 ? 'is-mid' : 'is-high';
    const history = skill.assessments
      .slice(-8)
      .map(
        (assessment) =>
          `<span title="${escapeHtml(`${assessment.level}/5 · ${formatDate(assessment.createdAt)}`)}" style="display:inline-block;width:14px;height:6px;border-radius:2px;margin-right:3px;background:${
            assessment.level <= 2 ? 'var(--critical)' : assessment.level === 3 ? 'var(--moderate)' : 'var(--strength)'
          }"></span>`
      )
      .join('');

    return `<div class="skill-row">
      <div class="skill-row__head">
        <span class="skill-row__name">${escapeHtml(skill.name)} ${formatChip(skill.format)}</span>
        <span class="skill-row__value">
          ${skill.previous !== null ? `${skill.previous} → ` : ''}${skill.latest}/5
          ${skill.delta !== null ? `<span class="tiny ${skill.delta > 0 ? 'muted' : 'muted'}">(${skill.delta > 0 ? '+' : ''}${skill.delta})</span>` : ''}
        </span>
      </div>
      <div class="skill-row__meter"><span class="${tone}" style="width:${(skill.latest / 5) * 100}%"></span></div>
      <div class="row-between" style="gap:10px">
        <div class="skill-row__note" style="flex:1">
          ${skill.insufficientData ? '<strong>Insufficient data for a trend.</strong> ' : ''}
          ${escapeHtml(skill.latestExplanation || 'No explanation stored.')}
          ${skill.recommendation ? `<br><strong>Next step:</strong> ${escapeHtml(skill.recommendation)}` : ''}
        </div>
        <div class="tiny muted" style="white-space:nowrap">${history}</div>
      </div>
      ${skill.latestPassage ? `<blockquote class="finding-card__quote" style="margin:6px 0 0">${escapeHtml(skill.latestPassage)}</blockquote>` : ''}
      <div class="tiny muted">${skill.count} assessment${skill.count === 1 ? '' : 's'} · latest ${escapeHtml(relativeTime(skill.assessments[skill.assessments.length - 1]?.createdAt))}</div>
    </div>`;
  }
}
