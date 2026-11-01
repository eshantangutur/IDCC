import { escapeHtml } from './core.js';

/**
 * Lightweight SVG charts. No external chart library, so the restrictive
 * Content-Security-Policy can stay at script-src 'self'.
 */

export function sparkline(points, { width = 420, height = 96 } = {}) {
  const data = Array.isArray(points) ? points : [];
  if (data.length === 0) {
    return `<div class="tiny muted">No analyses yet.</div>`;
  }

  const max = Math.max(...data.map((point) => point.count), 1);
  const stepX = data.length > 1 ? (width - 24) / (data.length - 1) : 0;
  const coords = data.map((point, index) => {
    const x = 12 + index * stepX;
    const y = height - 12 - (point.count / max) * (height - 30);
    return [x, y];
  });

  const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height - 6} L${coords[0][0].toFixed(1)},${height - 6} Z`;
  const dots = coords.map(([x, y]) => `<circle class="spark-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" />`).join('');

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Analyses per day over the last 30 days" style="width:100%;height:auto">
    <path class="spark-area" d="${area}"></path>
    <path class="spark-line" d="${line}" stroke-linejoin="round"></path>
    ${dots}
  </svg>`;
}

export function donut(segments, { size = 148, thickness = 16 } = {}) {
  const items = (segments || []).filter((segment) => segment.value > 0);
  const total = items.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return `<div class="tiny muted">No findings recorded yet.</div>`;
  }

  let offset = 0;
  const rings = items.map((segment) => {
    const fraction = segment.value / total;
    const dash = fraction * circumference;
    const ring = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none"
      stroke="${segment.color}" stroke-width="${thickness}"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"></circle>`;
    offset += dash;
    return ring;
  }).join('');

  const legend = items.map((segment) => `
    <div class="row" style="gap:8px;justify-content:space-between">
      <span class="tiny muted"><span class="legend-dot" style="background:${segment.color}"></span>${escapeHtml(segment.label)}</span>
      <span class="tiny">${segment.value}</span>
    </div>`).join('');

  return `<div class="row" style="gap:18px;align-items:center;flex-wrap:nowrap">
    <svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;flex:0 0 auto" role="img" aria-label="Findings by severity">
      <circle class="donut-track" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${thickness}"></circle>
      ${rings}
      <text class="donut-total" x="50%" y="47%" text-anchor="middle">${total}</text>
      <text class="donut-label" x="50%" y="60%" text-anchor="middle" letter-spacing="1.4">FINDINGS</text>
    </svg>
    <div class="stack-sm" style="flex:1;min-width:0">${legend}</div>
  </div>`;
}

export function barChart(segments, { height = 8 } = {}) {
  const max = Math.max(...segments.map((segment) => segment.value), 1);
  return segments.map((segment) => `
    <div class="stack-sm" style="gap:5px">
      <div class="row" style="justify-content:space-between;gap:8px">
        <span class="tiny muted">${escapeHtml(segment.label)}</span>
        <span class="tiny">${segment.value}</span>
      </div>
      <div class="meter" style="height:${height}px"><div class="meter__fill" style="width:${((segment.value / max) * 100).toFixed(1)}%;background:${segment.color || 'var(--accent)'}"></div></div>
    </div>`).join('');
}
