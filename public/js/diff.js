import { escapeHtml } from './core.js';

function tokenize(text) {
  return String(text || '').match(/\S+|\s+/g) || [];
}

/**
 * Word-level diff using a bounded LCS so the revision workspace can highlight
 * additions and deletions without a diff library.
 */
export function wordDiff(oldText, newText) {
  const before = tokenize(oldText);
  const after = tokenize(newText);

  if (before.length * after.length > 900000) {
    return [
      ...before.map((token) => ({ type: 'del', text: token })),
      ...after.map((token) => ({ type: 'add', text: token })),
    ];
  }

  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = new Uint16Array(rows * cols);

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i * cols + j] = before[i - 1] === after[j - 1]
        ? table[(i - 1) * cols + (j - 1)] + 1
        : Math.max(table[(i - 1) * cols + j], table[i * cols + (j - 1)]);
    }
  }

  const output = [];
  let i = before.length;
  let j = after.length;
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      output.push({ type: 'same', text: before[i - 1] });
      i -= 1;
      j -= 1;
    } else if (table[(i - 1) * cols + j] >= table[i * cols + (j - 1)]) {
      output.push({ type: 'del', text: before[i - 1] });
      i -= 1;
    } else {
      output.push({ type: 'add', text: after[j - 1] });
      j -= 1;
    }
  }
  while (i > 0) {
    output.push({ type: 'del', text: before[i - 1] });
    i -= 1;
  }
  while (j > 0) {
    output.push({ type: 'add', text: after[j - 1] });
    j -= 1;
  }

  return output.reverse();
}

export function renderDiffHtml(oldText, newText) {
  const tokens = wordDiff(oldText, newText);
  const parts = [];
  let buffer = '';
  let currentType = null;

  const flush = () => {
    if (!buffer) return;
    if (currentType === 'add') parts.push(`<span class="diff-add">${escapeHtml(buffer)}</span>`);
    else if (currentType === 'del') parts.push(`<span class="diff-del">${escapeHtml(buffer)}</span>`);
    else parts.push(escapeHtml(buffer));
    buffer = '';
  };

  for (const token of tokens) {
    if (token.type !== currentType) {
      flush();
      currentType = token.type;
    }
    buffer += token.text;
  }
  flush();

  const stats = tokens.reduce(
    (accumulator, token) => {
      if (token.type === 'add') accumulator.added += 1;
      if (token.type === 'del') accumulator.removed += 1;
      return accumulator;
    },
    { added: 0, removed: 0 }
  );

  return { html: parts.join(''), stats };
}

export function renderDiffPanel(container, oldText, newText) {
  if (!container) return;
  const { html, stats } = renderDiffHtml(oldText, newText);
  container.innerHTML = html || '<span class="muted">No text to compare yet.</span>';
  return stats;
}

export function diffSummary(oldText, newText) {
  const { stats } = renderDiffHtml(oldText, newText);
  return stats;
}
