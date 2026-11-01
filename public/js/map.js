import { escapeHtml } from './core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const TYPE_ORDER = ['counterargument', 'assumption', 'evidence', 'warrant', 'claim', 'impact'];
const TYPE_LABELS = {
  claim: 'Claim',
  evidence: 'Evidence',
  warrant: 'Warrant',
  impact: 'Impact',
  assumption: 'Assumption',
  counterargument: 'Counterargument',
};
export const TYPE_COLORS = {
  claim: '#60a5fa',
  evidence: '#10b981',
  warrant: '#9ca3af',
  impact: '#d97706',
  assumption: '#38bdf8',
  counterargument: '#dc2626',
};
export const TYPE_LABELS_EXPORT = TYPE_LABELS;

const NODE_W = 148;
const NODE_H = 58;
const LANE_GAP = 172;
const ROW_GAP = 92;

function wrapLabel(label, maxChars = 20) {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
    if (lines.length === 2) break;
  }
  if (line && lines.length < 2) lines.push(line);
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length + 2) {
    lines[1] = `${lines[1].slice(0, Math.max(4, maxChars - 3))}...`;
  }
  return lines.slice(0, 2);
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/**
 * Renders the argument map from the persisted analysis graph. Every node and
 * edge comes from the analysis result; nothing is hard-coded.
 */
export function createArgumentMap(container, { nodes = [], edges = [], onSelectNode = null } = {}) {
  container.innerHTML = '';

  if (!Array.isArray(nodes) || nodes.length === 0) {
    container.innerHTML = '<div class="empty" style="border:0;background:none"><h3>No graph data</h3><p>This analysis did not return argument nodes.</p></div>';
    return null;
  }

  const safeNodes = nodes.filter((node) => node && node.id);
  const nodeIds = new Set(safeNodes.map((node) => node.id));
  const safeEdges = (edges || []).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  const groups = new Map(TYPE_ORDER.map((type) => [type, []]));
  for (const node of safeNodes) {
    const type = groups.has(node.type) ? node.type : 'claim';
    groups.get(type).push(node);
  }

  const positions = new Map();
  TYPE_ORDER.forEach((type, laneIndex) => {
    groups.get(type).forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: 26 + laneIndex * LANE_GAP,
        y: 96 + rowIndex * ROW_GAP,
        centerX: 26 + laneIndex * LANE_GAP + NODE_W / 2,
        centerY: 96 + rowIndex * ROW_GAP + NODE_H / 2,
      });
    });
  });

  const maxRows = Math.max(1, ...TYPE_ORDER.map((type) => groups.get(type).length));
  const width = 26 * 2 + (TYPE_ORDER.length - 1) * LANE_GAP + NODE_W;
  const height = Math.max(460, 96 + maxRows * ROW_GAP + 30);

  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Interactive argument map',
    preserveAspectRatio: 'xMidYMid meet',
  });

  const defs = createSvgElement('defs');
  defs.innerHTML = `
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.65)"></path>
    </marker>
    <marker id="arrow-unsupported" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(248,113,113,0.8)"></path>
    </marker>`;
  svg.appendChild(defs);

  const edgeLayer = createSvgElement('g', { 'data-layer': 'edges' });
  const nodeLayer = createSvgElement('g', { 'data-layer': 'nodes' });
  svg.append(edgeLayer, nodeLayer);

  const edgeElements = new Map();
  safeEdges.forEach((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;

    let x1 = from.centerX;
    let y1 = from.centerY;
    let x2 = to.centerX;
    let y2 = to.centerY;
    let path;

    if (Math.abs(to.centerX - from.centerX) < 20) {
      const downward = to.centerY > from.centerY;
      y1 = downward ? from.y + NODE_H : from.y;
      y2 = downward ? to.y : to.y + NODE_H;
      const mid = (y1 + y2) / 2;
      path = `M${x1},${y1} C${x1 + 42},${mid} ${x2 - 42},${mid} ${x2},${y2}`;
    } else {
      const rightward = to.centerX > from.centerX;
      x1 = rightward ? from.x + NODE_W : from.x;
      x2 = rightward ? to.x : to.x + NODE_W;
      const mid = (x1 + x2) / 2;
      path = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
    }

    const group = createSvgElement('g', { 'data-edge-index': index });
    const hit = createSvgElement('path', {
      d: path,
      fill: 'none',
      stroke: 'transparent',
      'stroke-width': 12,
      style: 'cursor:pointer',
    });
    const pathElement = createSvgElement('path', {
      d: path,
      class: `map-edge ${edge.supported === false ? 'map-edge--unsupported' : ''}`,
      'marker-end': edge.supported === false ? 'url(#arrow-unsupported)' : 'url(#arrow)',
    });

    const title = createSvgElement('title');
    title.textContent = `${edge.relation}${edge.supported === false ? ' (unsupported)' : ''}${edge.explanation ? `: ${edge.explanation}` : ''}`;
    group.append(hit, pathElement, title);
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      highlightEdge(edge, group);
      onSelectNode?.({
        kind: 'edge',
        relation: edge.relation,
        explanation: edge.explanation,
        supported: edge.supported !== false,
        from: safeNodes.find((node) => node.id === edge.from),
        to: safeNodes.find((node) => node.id === edge.to),
      });
    });
    edgeLayer.appendChild(group);
    edgeElements.set(`${edge.from}|${edge.to}|${edge.relation}`, { path: pathElement, group });
  });

  const nodeElements = new Map();
  for (const node of safeNodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const type = groups.has(node.type) ? node.type : 'claim';
    const group = createSvgElement('g', {
      class: `map-node map-node--${type}`,
      transform: `translate(${position.x}, ${position.y})`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${TYPE_LABELS[type]}: ${node.label}`,
      'data-node-id': node.id,
    });

    const rect = createSvgElement('rect', {
      width: NODE_W,
      height: NODE_H,
      rx: 9,
      'stroke-width': 1.2,
    });
    const typeLabel = createSvgElement('text', {
      x: 10,
      y: 16,
      'font-size': 8,
      fill: TYPE_COLORS[type],
      'font-weight': 600,
    });
    typeLabel.textContent = TYPE_LABELS[type].toUpperCase();

    const lines = wrapLabel(node.label || node.excerpt || '');
    const text = createSvgElement('text', { x: 10, y: 32, 'font-size': 10.5, fill: '#e9eff9' });
    lines.forEach((line, index) => {
      const tspan = createSvgElement('tspan', { x: 10, dy: index === 0 ? 0 : 13 });
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    group.append(rect, typeLabel, text);
    if (node.strength) {
      const strengthLabel = createSvgElement('text', {
        x: NODE_W - 8,
        y: NODE_H - 8,
        'text-anchor': 'end',
        'font-size': 8,
        fill: 'rgba(148,163,184,0.85)',
      });
      strengthLabel.textContent = String(node.strength).toUpperCase();
      group.appendChild(strengthLabel);
    }

    const select = () => {
      highlightNode(node.id);
      onSelectNode?.({ kind: 'node', node });
    };
    group.addEventListener('click', select);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    nodeLayer.appendChild(group);
    nodeElements.set(node.id, group);
  }

  // lane headers
  const laneLayer = createSvgElement('g', { 'data-layer': 'lanes' });
  TYPE_ORDER.forEach((type, laneIndex) => {
    if (groups.get(type).length === 0) return;
    const label = createSvgElement('text', {
      x: 26 + laneIndex * LANE_GAP,
      y: 74,
      'font-size': 9,
      fill: TYPE_COLORS[type],
      'font-weight': 600,
    });
    label.textContent = TYPE_LABELS[type].toUpperCase();
    laneLayer.appendChild(label);
  });
  svg.insertBefore(laneLayer, edgeLayer);

  container.appendChild(svg);

  const view = { x: 0, y: 0, width, height };
  function applyView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
  }

  function clearSelection() {
    nodeElements.forEach((element) => element.classList.remove('is-focus'));
    edgeElements.forEach(({ path }) => path.classList.remove('is-focus'));
  }

  function highlightNode(id) {
    clearSelection();
    for (const [nodeId, element] of nodeElements) {
      element.classList.toggle('is-focus', nodeId === id);
    }
    for (const [key, { path }] of edgeElements) {
      const [from, to] = key.split('|');
      if (from === id || to === id) path.classList.add('is-focus');
    }
  }

  function highlightEdge(edge, group) {
    clearSelection();
    group.querySelector('path.map-edge')?.classList.add('is-focus');
  }

  function setTypeFilter(type) {
    const active = type || null;
    for (const [nodeId, element] of nodeElements) {
      const node = safeNodes.find((entry) => entry.id === nodeId);
      element.classList.toggle('is-dim', Boolean(active) && node?.type !== active);
    }
    for (const [key, { path }] of edgeElements) {
      if (!active) {
        path.classList.remove('is-dim');
        continue;
      }
      const [from, to] = key.split('|');
      const fromNode = safeNodes.find((entry) => entry.id === from);
      const toNode = safeNodes.find((entry) => entry.id === to);
      path.classList.toggle('is-dim', fromNode?.type !== active && toNode?.type !== active);
    }
  }

  function zoom(factor) {
    const centerX = view.x + view.width / 2;
    const centerY = view.y + view.height / 2;
    const nextWidth = Math.min(width * 1.8, Math.max(width * 0.32, view.width / factor));
    const nextHeight = nextWidth * (height / width);
    view.width = nextWidth;
    view.height = nextHeight;
    view.x = centerX - nextWidth / 2;
    view.y = centerY - nextHeight / 2;
    applyView();
  }

  function resetView() {
    view.x = 0;
    view.y = 0;
    view.width = width;
    view.height = height;
    applyView();
  }

  // drag to pan
  let dragState = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.map-node')) return;
    dragState = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    svg.setPointerCapture(event.pointerId);
    svg.style.cursor = 'grabbing';
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const scale = view.width / svg.clientWidth;
    view.x = dragState.viewX - (event.clientX - dragState.x) * scale;
    view.y = dragState.viewY - (event.clientY - dragState.y) * scale;
    applyView();
  });
  const endDrag = () => {
    dragState = null;
    svg.style.cursor = '';
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('click', (event) => {
    if (event.target === svg) clearSelection();
  });

  applyView();

  return {
    svg,
    nodes: safeNodes,
    edges: safeEdges,
    highlightNode,
    clearSelection,
    setTypeFilter,
    zoomIn: () => zoom(1.25),
    zoomOut: () => zoom(0.8),
    resetView,
    destroy() {
      container.innerHTML = '';
    },
  };
}

export function mapLegendHtml(types) {
  return types
    .map((type) => `<span class="tiny muted"><span class="legend-dot" style="background:${TYPE_COLORS[type] || '#94a3b8'}"></span>${escapeHtml(TYPE_LABELS[type] || type)}</span>`)
    .join('');
}
