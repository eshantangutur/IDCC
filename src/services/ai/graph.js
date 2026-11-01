/**
 * Deterministic graph builder used when a model omits usable nodes/edges.
 * Nodes are derived from the analysis components, never from sample data.
 */
export function deriveGraph({ components, content }) {
  const nodes = [];
  const edges = [];
  const addNode = (type, text, detail, strength = 'moderate') => {
    const excerpt = String(text || '').trim();
    if (!excerpt) return null;
    const id = `n${nodes.length + 1}`;
    nodes.push({
      id,
      type,
      label: excerpt.length > 70 ? `${excerpt.slice(0, 67)}…` : excerpt,
      excerpt,
      detail: detail || '',
      strength,
    });
    return id;
  };

  const claimIds = [];
  (components.claims || []).slice(0, 4).forEach((claim) => {
    const id = addNode('claim', claim.excerpt || claim.text, claim.note, claim.strength);
    if (id) claimIds.push(id);
  });

  if (claimIds.length === 0) {
    const fallback = String(content || '').split(/(?<=[.!?])\s+/).find((sentence) => sentence.trim().length > 20);
    const id = addNode('claim', fallback, 'Primary claim reconstructed from the speech.');
    if (id) claimIds.push(id);
  }

  const linkToClaim = (type, entry, relation, supported) => {
    const id = addNode(type, entry.excerpt || entry.text, entry.note, entry.strength);
    if (!id) return;
    const claimId = claimIds[0];
    if (claimId) edges.push({ from: id, to: claimId, relation, explanation: entry.note || '', supported });
  };

  (components.evidence || []).slice(0, 4).forEach((entry) => linkToClaim('evidence', entry, 'supports', true));
  (components.warrants || []).slice(0, 3).forEach((entry) => linkToClaim('warrant', entry, 'warrants', true));
  (components.assumptions || []).slice(0, 2).forEach((entry) => linkToClaim('assumption', entry, 'assumes', false));

  const impactIds = [];
  (components.impacts || []).slice(0, 3).forEach((entry) => {
    const id = addNode('impact', entry.excerpt || entry.text, entry.note, entry.strength);
    if (id) impactIds.push(id);
  });

  if (claimIds[0] && impactIds.length > 0) {
    edges.push({
      from: claimIds[0],
      to: impactIds[0],
      relation: 'impacts',
      explanation: 'The speech moves from its central claim to this impact.',
      supported: true,
    });
  }

  (components.counterarguments || []).slice(0, 3).forEach((entry) => {
    const id = addNode('counterargument', entry.excerpt || entry.text, entry.note, entry.strength);
    if (id && claimIds[0]) {
      edges.push({
        from: id,
        to: claimIds[0],
        relation: 'rebuts',
        explanation: entry.note || 'The speech does not answer this objection directly.',
        supported: false,
      });
    }
  });

  return { nodes, edges };
}
