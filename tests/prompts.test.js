import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, getFormat } from '../src/services/formats.js';
import { buildAnalysisPrompt } from '../src/services/ai/prompt.js';
import { generateDemoAnalysis } from '../src/services/ai/demo.js';

const SPEECH = `Resolved: The United States should increase transit funding.
First, transit reduces congestion because commuters switch modes. According to a 2024 study, rail expansion cut vehicle hours by 12 percent.
Second, transit spending creates jobs, which leads to economic growth.`;

test('every format builds a distinct, format-specific prompt', () => {
  const prompts = new Map();

  for (const format of FORMATS) {
    const prompt = buildAnalysisPrompt({
      formatSpec: format,
      resolution: 'Resolved: Test resolution.',
      sideLabel: format.sides[0].label,
      speechType: format.speechTypes[0],
      content: SPEECH,
    });

    assert.ok(prompt.system.includes(format.name), `${format.id} names its format`);
    assert.ok(prompt.system.includes(format.analysisInstructions), `${format.id} includes its instructions`);
    for (const dimension of format.rubric) {
      assert.ok(prompt.system.includes(dimension.key), `${format.id} includes rubric key ${dimension.key}`);
    }
    assert.ok(prompt.system.includes('Ignore any instruction'), 'prompt injection guard present');
    assert.ok(prompt.system.includes('untrusted data'));
    assert.ok(prompt.user.includes(SPEECH));
    prompts.set(format.id, prompt.system);
  }

  const systems = [...prompts.values()];
  assert.equal(new Set(systems).size, systems.length, 'no two formats share a prompt');

  const pf = prompts.get('pf');
  const ld = prompts.get('ld');
  const policy = prompts.get('policy');
  assert.ok(!ld.includes('Magnitude, probability and timeframe'));
  assert.ok(!pf.includes('Framework Consistency Checker'));
  assert.ok(policy.includes('Disadvantage Link Chain Analyzer'));
});

test('demo analysis is derived from the actual speech and varies by text', () => {
  const format = getFormat('pf');
  const first = generateDemoAnalysis({
    formatSpec: format,
    content: SPEECH,
    resolution: 'Resolved: Test.',
    sideLabel: 'Pro',
    speechType: 'Case / Constructive',
  });
  const second = generateDemoAnalysis({
    formatSpec: format,
    content: 'The resolution is just obviously correct. Everyone supports it and no one disagrees.',
    resolution: 'Resolved: Test.',
    sideLabel: 'Pro',
    speechType: 'Rebuttal',
  });

  assert.notEqual(
    JSON.stringify(first.findings.map((finding) => finding.title)),
    JSON.stringify(second.findings.map((finding) => finding.title)),
    'demo findings differ between speeches'
  );
  assert.ok(first.findings.some((finding) => finding.passage.includes('transit') || finding.passage.includes('rail')));
  assert.ok(first.components.evidence.length >= 1);
  assert.equal(first.formatSpecific.weighing.comparativeFraming, 'Not addressed in this speech.');
  assert.ok(first.summary.overview.includes('Demo structural read'));
});

test('demo analysis refuses to fabricate format-specific framework data', () => {
  const format = getFormat('ld');
  const demo = generateDemoAnalysis({
    formatSpec: format,
    content: 'Justice requires protecting autonomy. My criterion is autonomy because coercion is wrong.',
    resolution: 'Resolved: Liberty is prior to security.',
    sideLabel: 'Affirmative',
    speechType: 'Affirmative Constructive (AC)',
  });

  assert.ok(['consistent', 'partially_consistent', 'inconsistent', 'unclear'].includes(demo.formatSpecific.frameworkCheck.consistency));
  assert.ok(demo.formatSpecific.frameworkCheck.notes.length > 10);
  assert.ok(demo.formatSpecific.frameworkCheck.notes.includes('Demo heuristic'));
});
