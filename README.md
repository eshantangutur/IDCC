# Argument Forensics

**Dissect Arguments. Expose Weaknesses. Strengthen Reasoning.**

A full-stack debate-analysis workspace. It reconstructs the logical structure of a speech into claims, warrants, evidence, impacts, hidden assumptions and counterarguments, then reports weaknesses with the exact passage, an explanation, why it matters, a suggested revision and a confidence indicator.

The application now works at two levels:

- **Speech analysis** — one speech, one report.
- **Round intelligence** — every speech in a round, with argument identities tracked across speeches, a status history, an interactive argument graph, evidence records and skill ratings.

The frontend is plain HTML, CSS and ES modules. The backend is Node.js + Express with SQLite. AI analysis runs behind a server-side provider abstraction (xAI Grok by default, with built-in Groq support) and falls back to a clearly labelled local heuristic analyser when no credentials are configured.

Supported formats: Public Forum, Lincoln-Douglas, Policy, Congressional Debate and World Schools Debate. Each has its own rubric, speech order and analysis instructions.

---

## Features

### Speech analyzer

- Per-format rubric scoring (1–5) with grounded rationale.
- Findings grouped by severity, each with a verbatim passage.
- Argument map generated from the analysis result.
- Revision history with resolved/persistent weakness comparison.
- Upload of text, Markdown, Word and PDF files (read in memory, never stored).

### Round analyzer

- Create a round with title, format, resolution, side, participants and ordered speeches.
- Speech order is generated from the selected format; Congressional Debate accepts free order.
- Round analysis returns a structured model:
  - arguments with a stable key, side, type, claim, warrant, evidence, impact and assumptions;
  - the speech each argument was introduced in and the last speech it appeared in;
  - status (`introduced`, `answered`, `partially_answered`, `extended`, `dropped`, `conceded`, `turned`, `still_contested`, `unclear`) with a confidence and a written reason;
  - relationships between arguments (`supports`, `challenges`, `depends_on`, `responds_to`, `extends`, `contradicts`, `turns`);
  - evidence records with a six-way assessment;
  - round findings and skill ratings.
- Status history per argument, including human corrections.
- Timeline view: what was introduced, touched, evidenced and flagged in each speech.

**Status caution.** The analyser is instructed never to mark an argument `dropped` merely because it was not repeated in the next speech. If the round structure means the other side could still answer it, the status is `still_contested` or `unclear` with a reason. The local heuristic never sets `dropped` at all, and says so.

### Evidence analysis and verification

Evidence records distinguish:

| Assessment | Meaning |
| --- | --- |
| `supported` | The passage as written does establish the claim. |
| `unsupported_claim` | A claim with no adequate support in the text. |
| `misrepresented_evidence` | The cited source does not establish what the speaker says. |
| `potentially_inaccurate` | A factual statement the text contradicts, or that is likely outdated. |
| `correlation_not_causation` | Association is presented as causation. |
| `missing_context` | A limitation, qualification or condition is omitted. |

Verification is a separate, modular service (`src/services/evidence-service.js`). **No verification provider ships with the app.** Without one, every evidence record is reported as `unavailable` with the message "has not been checked against any external source", and the UI says so. It never displays a source title, URL or excerpt that was not actually retrieved.

To enable verification, set `EVIDENCE_SEARCH_URL` to an endpoint that accepts `POST { claim, citation, passage }` and returns `{ found, title, url, excerpt, publishedAt, relationship }`. The API key stays server-side.

### Interactive argument graph

- Nodes are generated from stored argument and evidence rows, never from sample data.
- Node types: claim, evidence, warrant, impact, assumption, counterargument, rebuttal, concession.
- Edges are stored relationships plus evidence-to-argument links.
- Click a node or edge to inspect the speech, speaker, status and explanation.
- Zoom, pan, fit-to-view, type filter and readable labels (SVG).
- Add, edit and remove relationships; changes persist and survive re-analysis.
- Selecting a finding jumps to the graph and focuses its argument. Selecting a node lists its findings.

### Personal progress

- Skill ratings come from stored rubric assessments (speech analyses) and round skill ratings.
- Filters: format, skill, date range.
- Shows previous vs latest, delta, repeated weaknesses, improvements and focus areas.
- A skill with fewer than two assessments is labelled **insufficient data** instead of showing an invented trend.
- No cross-user comparison and no ranking.

### Human feedback and calibration

- Every AI finding can be rated `accurate`, `partially_accurate` or `inaccurate`, with a comment and suggested correction.
- Corrections are stored in `finding_feedback` and `human_annotations`; the original AI finding is never overwritten.
- Argument status and graph relationships can be corrected by hand, and re-analysis preserves those edits.
- Benchmark examples store speech text, format, expected classifications and review notes. They are **private per account by default** and are never used to train a model.

---

## Setup

Requires Node.js 22.13 or newer (the project uses the built-in `node:sqlite` module).

```bash
npm ci
cp .env.example .env
# edit .env: set SESSION_SECRET (32+ characters) and optionally an AI key
npm start          # http://localhost:3000
npm run dev        # restart on change
```

`data/` and `.env` are not committed. The database file is created automatically on first start.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | Listen address (default `3000`, `0.0.0.0`). |
| `SESSION_SECRET` | Session signing secret. Required (32+ chars) in production and on Vercel. |
| `DATABASE_PATH` | Local SQLite file. Defaults to `data/argument-forensics.sqlite`. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Remote libSQL storage. Required on Vercel. |
| `AI_PROVIDER` | `grok` (default), `groq`, `openai-compatible` or `demo`. |
| `GROK_API_KEY` / `XAI_API_KEY`, `GROQ_API_KEY`, `AI_API_KEY` | Provider credential. Keys are never sent to a different provider. |
| `AI_BASE_URL`, `AI_MODEL` | Override the endpoint and model. |
| `AI_DEMO_MODE` | Force the local heuristic analyser. |
| `AI_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, `AI_JSON_MODE` | Provider tuning. |
| `EVIDENCE_PROVIDER`, `EVIDENCE_SEARCH_URL`, `EVIDENCE_API_KEY`, `EVIDENCE_TIMEOUT_MS` | Optional evidence verification. Unset means "not verified". |
| `UPLOAD_MAX_BYTES` | Upload limit. Vercel caps request bodies at 4.5 MB. |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `AI_RATE_LIMIT_*`, `FILE_RATE_LIMIT_*` | Rate limiting windows and caps. |
| `TRUST_PROXY`, `COOKIE_SECURE`, `ALLOWED_ORIGINS`, `LOG_LEVEL` | Deployment and logging controls. |

## Database migrations

Migrations live in `src/database/migrations.js` and are applied automatically, in order, on startup. Each is recordable in `schema_migrations`, idempotent, and only creates tables or indexes, so existing rows are never dropped or rewritten.

Applying them manually is the same as starting the server once:

```bash
node -e "import('./src/config.js').then(async ({loadConfig}) => { const {createDatabase} = await import('./src/database/db.js'); const db = await createDatabase({config: loadConfig()}); console.log('migrations applied'); await db.close(); })"
```

Migrations added by this expansion: `001_round_intelligence`, `002_feedback_annotations_benchmarks`, `003_skill_assessments`.

## AI configuration

Live analysis requires one provider key. Without it the app runs in **demo mode**: the UI shows a demo banner, reports are labelled, and the analysis is produced by a deterministic heuristic over the speech text rather than a model. Demo mode still extracts arguments, matches them across speeches, records evidence and derives findings — it simply cannot follow meaning the way a model can, and it says so in the report.

## Tests

```bash
npm test                              # all suites
node --test tests/rounds.test.js      # round intelligence
node --test tests/security.test.js    # abuse and isolation
```

Tests use Node's built-in runner against an in-memory SQLite database with a deterministic demo analyser. No live AI calls are made.

## Deployment

### Vercel

Vercel Functions cannot write to the deployment filesystem. Production therefore uses [Turso](https://turso.tech), a hosted SQLite-compatible database.

1. Open the project in Vercel and add Turso from the Vercel Marketplace.
2. Create a database and connect it so `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are added to Production and Preview.
3. Add `SESSION_SECRET` with at least 32 characters.
4. Add `GROQ_API_KEY` or `GROK_API_KEY` for live analysis, or set `AI_PROVIDER=demo`.
5. Redeploy.

If `TURSO_DATABASE_URL` is missing on Vercel, the server stops with a clear configuration error instead of writing a local database file.

## Known limitations

- **The local heuristic is not a model.** In demo mode, argument matching uses token overlap, so paraphrases can be missed and statuses are deliberately conservative.
- **No verification provider is configured by default.** Every evidence record is "not verified" until one is connected.
- **Round analysis reads recorded speech text only.** Cross-examination is not transcribed, so a status can only be as good as the speeches entered.
- **Benchmarks are storage and review, not training.** No model is fine-tuned from user data.
- **Skill trends need history.** A single analysis produces one rating per dimension and no trend.
- **Large rounds cost more.** Round analysis sends every speech in one request; a 30-speech Policy round is a large prompt and may hit provider limits long before the app's own 128,000-character-per-speech cap.
- **Not independently security-audited.** See `SECURITY.md` for the assumptions and remaining gaps.

## License

MIT.
