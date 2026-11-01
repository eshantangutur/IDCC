/**
 * Debate format specifications.
 *
 * Every format has its own evaluation criteria, rubric dimensions and
 * format-specific analysis block. The AI prompt builder and the demo
 * analysis generator both read from this single source of truth so that a
 * Public Forum speech is never graded with Lincoln-Douglas standards.
 */

export const SCORE_SCALE = {
  min: 1,
  max: 5,
  label: '5-point rubric',
  definitions: {
    1: 'Absent, counterproductive, or contradicted elsewhere in the speech.',
    2: 'Present but underdeveloped, largely asserted, or unclear.',
    3: 'Recognisable and functional, but generic or only partially supported.',
    4: 'Clear, supported and competitively useful in a real round.',
    5: 'Exceptional: explicit, well-evidenced and fully integrated into weighing.',
  },
  caution:
    'Scores describe the written speech only. They do not predict the round result or measure speaker quality.',
};

export const FORMATS = [
  {
    id: 'pf',
    name: 'Public Forum',
    abbreviation: 'PF',
    tagline: 'Two-on-two debate about a current event.',
    description:
      'Public Forum is a two-on-two debate about a current event. The report checks each contention, the evidence behind it, the reason it supports the claim, and how the impacts compare.',
    sides: [
      { id: 'pro', label: 'Pro' },
      { id: 'con', label: 'Con' },
    ],
    speechTypes: [
      'Case / Constructive',
      'Rebuttal',
      'Summary',
      'Final Focus',
      'Crossfire Notes',
    ],
    focusAreas: [
      'Claims',
      'Warrants',
      'Evidence',
      'Impacts',
      'Contention structure',
      'Rebuttal effectiveness',
      'Summary extensions',
      'Final Focus extension',
      'Comparing impacts',
      'Size, likelihood, and speed',
      'Dropped arguments and concessions',
    ],
    rubric: [
      { key: 'claim_clarity', name: 'Claim Clarity', definition: 'Each contention is stated as a clear claim a judge can vote on.' },
      { key: 'evidence_quality', name: 'Evidence Quality', definition: 'Sources, dates, and statistics are specific, relevant, and described fairly.' },
      { key: 'warranting', name: 'Warrant Strength', definition: 'The reasoning that connects evidence to claim is explicit rather than assumed.' },
      { key: 'impact_weighing', name: 'Impact & Weighing', definition: 'Impacts are measured and compared by size, likelihood, and speed.' },
      { key: 'rebuttal_extension', name: 'Rebuttal & Extension', definition: 'Responses answer the opposing case and are extended through summary and final focus.' },
    ],
    analysisInstructions: `You are analysing a PUBLIC FORUM speech. Apply Public Forum judging conventions only.
- Reconstruct the contention structure: contention -> claim -> warrant -> evidence -> impact. Name each contention explicitly.
- Test warrant quality: does the cited evidence actually prove the claim, or is there a gap?
- Judge rebuttal effectiveness: does the speech answer the opponent's actual argument, or a weaker version of it?
- Track summary extensions and final focus crystallization: are the winning arguments selected and extended with weighing?
- Evaluate comparative weighing using magnitude, probability and timeframe. Flag the absence of explicit comparison as a strategic weakness.
- Identify dropped arguments and concessions, but only when the text itself shows them (do not invent an opponent's case).
- Do NOT use Lincoln-Douglas value/criterion frameworks, Policy stock issues, or World Schools team-role standards.`,
    formatSpecific: {
      key: 'weighing',
      label: 'Comparative Weighing Analysis',
      description: 'Checks size, likelihood, speed, and dropped arguments.',
      shape: `"formatSpecific": {
    "weighing": {
      "magnitude": "What the speech says about scale of impact, or 'Not addressed'",
      "probability": "What the speech says about likelihood, or 'Not addressed'",
      "timeframe": "What the speech says about speed of impact, or 'Not addressed'",
      "comparativeFraming": "How the speech explicitly compares its impacts to the opponent's",
      "droppedArguments": ["arguments the speech leaves unanswered, described from the text only"]
    }
  }`,
    },
  },
  {
    id: 'ld',
    name: 'Lincoln-Douglas',
    abbreviation: 'LD',
    tagline: 'One-on-one debate about a value.',
    description:
      'Lincoln-Douglas is a one-on-one debate about a value and a standard for judging it. The report checks whether the contentions meet that standard and whether the moral reasoning is explained.',
    sides: [
      { id: 'affirmative', label: 'Affirmative' },
      { id: 'negative', label: 'Negative' },
    ],
    speechTypes: [
      'Affirmative Constructive (AC)',
      'Negative Constructive (NC)',
      'First Affirmative Rebuttal (1AR)',
      'Second Negative Rebuttal (2NR)',
      'Second Affirmative Rebuttal (2AR)',
      'Value / Criterion Framework',
    ],
    focusAreas: [
      'Value frameworks',
      'Value criteria',
      'Framework consistency',
      'Philosophical reasoning',
      'Contentions',
      'Moral and ethical assumptions',
      'Framework interaction',
      'Weighing',
      'Internal links and impacts',
    ],
    rubric: [
      { key: 'framework_clarity', name: 'Framework Clarity', definition: 'The value and criterion are clear enough to decide the round.' },
      { key: 'framework_consistency', name: 'Framework Consistency', definition: 'Contentions and impacts resolve through the stated criterion without contradiction.' },
      { key: 'philosophical_grounding', name: 'Philosophical Grounding', definition: 'Moral premises are defended with argument rather than asserted as obvious.' },
      { key: 'internal_linking', name: 'Internal Linking', definition: 'Each contention carries a complete chain from premise to value-level impact.' },
      { key: 'framework_interaction', name: 'Framework Interaction', definition: 'The speech explains why its standard should govern when frameworks conflict.' },
    ],
    analysisInstructions: `You are analysing a LINCOLN-DOUGLAS speech. Apply Lincoln-Douglas conventions only.
- Identify the stated value, value criterion and any observations/definitions. If they are missing or vague, that is a framework weakness.
- Run a framework consistency check: for each contention, trace whether its impact actually resolves through the stated criterion. Quote the exact link or the exact gap.
- Evaluate philosophical reasoning: are moral premises argued or merely asserted? Name the ethical theory or assumption being relied on when it is identifiable.
- Evaluate framework interaction: does the speech explain why its criterion should be preferred when the opponent's framework competes?
- Assess weighing mechanisms (strength of link, scope, severity, probability) as used in LD, not PF magnitude/probability/timeframe boilerplate.
- Flag unstated moral assumptions and internal-link gaps.
- Do NOT score this speech using Public Forum evidence/contention standards, Policy stock issues or World Schools team roles.`,
    formatSpecific: {
      key: 'frameworkCheck',
      label: 'Framework Consistency Checker',
      description: 'Checks the value, criterion, consistency, and framework conflicts.',
      shape: `"formatSpecific": {
    "frameworkCheck": {
      "value": "Stated value, or 'Not stated'",
      "criterion": "Stated criterion, or 'Not stated'",
      "consistency": "consistent | partially_consistent | inconsistent",
      "notes": "Why that verdict follows from the text",
      "tensions": ["specific places where a contention does not resolve through the criterion"],
      "frameworkInteraction": "How the speech argues its framework should be preferred"
    }
  }`,
    },
  },
  {
    id: 'policy',
    name: 'Policy Debate',
    abbreviation: 'Policy',
    tagline: 'Plan-based debate about a specific policy.',
    description:
      'Policy debate asks whether the affirmative plan should be adopted. The report checks the plan, harms, inherency, solvency, disadvantages, counterplans, and topicality.',
    sides: [
      { id: 'affirmative', label: 'Affirmative' },
      { id: 'negative', label: 'Negative' },
    ],
    speechTypes: [
      '1AC',
      '1NC',
      '2AC',
      '2NC',
      '1NR',
      '1AR',
      '2NR',
      '2AR',
      'Plan / Advantage Overview',
      'Disadvantage / Counterplan',
    ],
    focusAreas: [
      'Affirmative plan structure',
      'Harms',
      'Inherency',
      'Solvency',
      'Advantages',
      'Disadvantages',
      'Uniqueness',
      'Links',
      'Internal links',
      'Comparing impacts',
      'Counterplans',
      'Kritiks',
      'Topicality',
    ],
    rubric: [
      { key: 'plan_clarity', name: 'Plan Clarity', definition: 'The plan text is specific enough to evaluate: agent, mandate, funding and enactment.' },
      { key: 'stock_issues', name: 'Stock Issue Coverage', definition: 'Harms, inherency and solvency are each established rather than assumed.' },
      { key: 'da_completeness', name: 'DA Chain Completeness', definition: 'Each disadvantage has uniqueness, link, internal link and impact components.' },
      { key: 'impact_calculus', name: 'Comparing Impacts', definition: 'Impacts are compared by size, likelihood, and speed.' },
      { key: 'negative_layer', name: 'Counterplan / Kritik / T Layer', definition: 'Alternative negative strategy is engaged or pre-empted with competitive argument.' },
    ],
    analysisInstructions: `You are analysing a POLICY DEBATE speech. Apply policy conventions only.
- Identify the affirmative plan (agent, mandate, funding, enactment) and whether it is textually complete.
- Assess stock issues: harms, inherency, solvency, advantages. Quote missing links.
- Reconstruct each disadvantage as a chain: uniqueness -> link -> internal link(s) -> impact. Name any missing link in the chain.
- Identify counterplans, kritiks, topicality and framework arguments, and whether the speech engages their competitiveness.
- Evaluate impact calculus explicitly (magnitude, probability, timeframe) and point out where the chain stops before an impact.
- Do NOT evaluate this as a value debate: no LD value/criterion scoring. Do not apply Public Forum contention boilerplate.`,
    formatSpecific: {
      key: 'disadvantageChains',
      label: 'Disadvantage Link Chain Analyzer',
      description: 'Uniqueness, link, internal links and impact for each disadvantage.',
      shape: `"formatSpecific": {
    "disadvantageChains": [
      {
        "name": "Short name",
        "uniqueness": "The uniqueness claim in the text, or 'Missing'",
        "link": "The link claim, or 'Missing'",
        "internalLinks": ["each internal link that is present"],
        "impact": "The terminal impact, or 'Missing'",
        "strength": "strong | moderate | weak",
        "notes": "Which link is weakest and why"
      }
    ],
    "stockIssues": {
      "harms": "...", "inherency": "...", "solvency": "...", "topicality": "...", "counterplanOrKritik": "..."
    },
    "impactCalculus": "How impacts are compared"
  }`,
    },
  },
  {
    id: 'congress',
    name: 'Congressional Debate',
    abbreviation: 'Congress',
    tagline: 'Legislative debate about a bill.',
    description:
      'Congressional debate is a floor debate about a bill. The report checks how well the speech explains the bill, uses evidence, answers objections, and handles questioning.',
    sides: [
      { id: 'affirmative', label: 'Affirmative (for the bill)' },
      { id: 'negative', label: 'Negative (against the bill)' },
    ],
    speechTypes: [
      'Sponsorship Speech',
      'First Affirmation',
      'First Negation',
      'Subsequent Affirmation',
      'Subsequent Negation',
      'Questioning / Cross-Examination',
      'Rebuttal',
    ],
    focusAreas: [
      'Legislation interpretation',
      'Legislative provisions',
      'Affirmative and negative arguments',
      'Evidence integration',
      'Speech organization',
      'Rebuttals',
      'Questioning effectiveness',
      'Persuasiveness',
      'Parliamentary procedure',
    ],
    rubric: [
      { key: 'legislative_analysis', name: 'Legislative Analysis', definition: 'The speech engages the actual provisions and mechanisms of the legislation.' },
      { key: 'evidence_integration', name: 'Evidence Integration', definition: 'Evidence is attributed, relevant and woven into the argument rather than listed.' },
      { key: 'speech_organization', name: 'Organization', definition: 'Clear structure (introduction, contentions, conclusion) that a chamber can follow.' },
      { key: 'rebuttal_questioning', name: 'Rebuttal & Questioning', definition: 'Responses and questioning address the main claims in the bill.' },
      { key: 'persuasion_procedure', name: 'Persuasion & Procedure', definition: 'Rhetoric serves the argument, and procedure is used correctly where relevant.' },
    ],
    analysisInstructions: `You are analysing a CONGRESSIONAL DEBATE speech. Apply Congressional Debate conventions only.
- Identify the specific legislative provisions the speech interprets (what the bill shall fund, require, prohibit or establish).
- Assess both the affirmative/negative argument load and whether the speech answers the strongest opposing case.
- Evaluate evidence integration: attribution, relevance and whether the source supports the legislative claim.
- Evaluate speech organisation as a floor speech a chamber must follow, and persuasiveness without rewarding empty rhetoric.
- Evaluate questioning/cross-examination effectiveness where the speech includes or responds to questions.
- Note parliamentary procedure only where the text makes it relevant (amendments, motions, germaneness).
- Do NOT apply Public Forum contention weighing, LD value frameworks or Policy disadvantage chains.`,
    formatSpecific: {
      key: 'legislativeAnalysis',
      label: 'Legislative Argument Analyzer',
      description: 'Checks each provision, its support, and the main objection.',
      shape: `"formatSpecific": {
    "legislativeAnalysis": {
      "provisions": [
        {
          "text": "The provision as quoted or closely paraphrased",
          "interpretation": "What it would actually do",
          "support": "The best affirmative use of it in this speech",
          "attack": "The strongest legislative objection available"
        }
      ],
      "proceduralNotes": "Amendment, motion or germaneness issues visible in the text",
      "persuasiveness": "Assessment of rhetorical effectiveness tied to argument",
      "questioning": "Questioning strengths or vulnerabilities"
    }
  }`,
    },
  },
  {
    id: 'wsd',
    name: 'World Schools Debate',
    abbreviation: 'WSD',
    tagline: 'Three-on-three debate about a motion.',
    description:
      'World Schools is a three-on-three team debate. The report checks each speaker role, clash with the other team, consistency with teammates, and comparative analysis.',
    sides: [
      { id: 'proposition', label: 'Proposition' },
      { id: 'opposition', label: 'Opposition' },
    ],
    speechTypes: [
      'First Proposition',
      'First Opposition',
      'Second Proposition',
      'Second Opposition',
      'Third Proposition',
      'Third Opposition',
      'Reply Speech',
    ],
    focusAreas: [
      'Team position consistency',
      'Substantive arguments',
      'Speaker roles',
      'Rebuttal effectiveness',
      'Extensions',
      'Clash engagement',
      'Comparative analysis',
      'Repetition between speakers',
      'Contradictions between team members',
    ],
    rubric: [
      { key: 'role_adherence', name: 'Role Adherence', definition: 'The speech does the job its position demands (opening, extension, reply).' },
      { key: 'argument_depth', name: 'Substantive Depth', definition: 'Arguments are developed with mechanism and example rather than slogans.' },
      { key: 'clash', name: 'Clash', definition: 'The speech engages the opposing case directly and answers its strongest point.' },
      { key: 'team_consistency', name: 'Team Consistency', definition: 'The line is consistent with earlier teammates, without contradiction or repetition.' },
      { key: 'comparative_analysis', name: 'Comparative Analysis', definition: 'The speech explains why its world is preferable, not merely why it is good.' },
    ],
    analysisInstructions: `You are analysing a WORLD SCHOOLS DEBATE speech. Apply World Schools conventions only.
- Identify the speaker role (first/second/third proposition or opposition, reply) and assess role adherence.
- Assess substantive argument depth: mechanism, example and impact rather than assertion.
- Assess clash engagement with the opposing case and rebuttal effectiveness.
- Identify extensions: does this speaker add a distinct, developed argument for the team line?
- Detect repetition between speakers and contradictions between team members where the text permits; if the text is a single speech, judge internal consistency of the team line it states.
- Evaluate comparative analysis: does the speech compare worlds/impacts rather than list benefits?
- Do NOT apply Public Forum evidence standards, LD value/criterion frameworks or Policy plan/stock-issue analysis.`,
    formatSpecific: {
      key: 'teamConsistency',
      label: 'Team Argument Consistency Checker',
      description: 'Checks roles, contradictions, repetition, and comparison.',
      shape: `"formatSpecific": {
    "teamConsistency": {
      "roleAdherence": "How well the speech performs its role",
      "contradictions": [
        { "between": "Which claims conflict", "description": "The conflict described from the text", "severity": "critical | moderate | minor" }
      ],
      "repetition": [
        { "idea": "The repeated idea", "speakers": "Where the repetition appears" }
      ],
      "comparativeStance": "How the speech compares its world to the opponent's"
    }
  }`,
    },
  },
];

export const FORMAT_IDS = FORMATS.map((format) => format.id);

export function getFormat(formatId) {
  return FORMATS.find((format) => format.id === formatId) || null;
}

export function getSideLabel(formatId, sideId) {
  const format = getFormat(formatId);
  const side = format?.sides.find((entry) => entry.id === sideId);
  if (side) return side.label;
  return sideId ? String(sideId) : '';
}

export function isValidSide(formatId, sideId) {
  const format = getFormat(formatId);
  return Boolean(format?.sides.some((entry) => entry.id === sideId));
}
