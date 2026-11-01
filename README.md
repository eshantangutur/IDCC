# Argument Forensics

**Dissect Arguments. Expose Weaknesses. Strengthen Reasoning.**

A full-stack debate-analysis workspace for competitive debaters. Argument Forensics reconstructs the logical structure of a speech into claims, warrants, evidence, impacts, hidden assumptions and counterarguments, then reports weaknesses with the exact passage, an explanation, why it matters, a suggested revision and a confidence indicator.

The frontend is plain HTML, CSS and ES modules. The backend is Node.js + Express with SQLite. AI analysis runs behind a server-side provider abstraction (xAI Grok by default, with built-in Groq support) and falls back to a clearly labelled local demo analyser when no credentials are configured.

---

## Quick start

### Requirements

- **Node.js 22.13 or newer** (24 LTS+ recommended). The application uses Node's built-in `node:sqlite` module, so no native compilation is required. On Node 22.5–22.12 that module requires the `--experimental-sqlite` flag; upgrading is simpler.
- npm 10+.

### Install and run

```bash
git clone <this-repository>
cd argument-forensics

npm install
cp .env.example .env        # then edit .env

npm start                   # http://localhost:3000
```

For development with automatic restart:

```bash
npm run dev
```

Open <http://localhost:3000>, create an account, and start an analysis.

The SQLite database is created automatically at `data/argument-forensics.sqlite` on first start. Delete that file (with the server stopped) to reset the workspace.

### Enable live AI analysis

Choose **one** provider and keep its key on the server only.

**xAI Grok** — keys start with `xai-`:

```env
AI_PROVIDER=grok
GROK_API_KEY=xai-...
AI_BASE_URL=https://api.x.ai/v1
AI_MODEL=grok-4.7
```

**Groq** — keys start with `gsk_` (Groq is a different service from xAI Grok):

```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_...
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-120b
```

Restart the server after changing `.env`. `AI_MODEL` must be a model your account can access; model names change, so check the provider's current catalogue. The two built-in providers have defaults, but setting `AI_BASE_URL` and `AI_MODEL` explicitly is recommended — if you switch providers, update them together, because they are not inferred from the key. The key is read only by the server and is never sent to the browser.

If the key is missing, invalid, or `AI_DEMO_MODE=true`, the app runs in **demo mode**: a local heuristic analyser derives findings from your text. Demo reports are labelled everywhere (`mode: "demo"`, a demo banner in the report, a "Demo" chip in history). Demo output is never presented as AI output and is not a fixed sample — it varies with the speech.

### Swapping the AI provider

`grok` (xAI) and `groq` are built in. The adapter also speaks the OpenAI-compatible chat-completions protocol, so it can target another compatible endpoint:

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-model
AI_API_KEY=your-key
```

`openai-compatible` requires both `AI_BASE_URL` and `AI_MODEL` when a key is set. Adding a provider with a different protocol means implementing `complete({ system, user })` in `src/services/ai/provider.js`; the prompt builder, validator, persistence layer and UI do not change.

---

## Features

### Public landing page
Product explanation, the problem it solves, all five formats with their analysis criteria, feature overview, AI process, CTAs, and footer with privacy, terms and contact details.

### Authentication
Registration, login, logout, persistent SQLite sessions, bcrypt password hashing, session regeneration on login, password change that revokes other sessions, and account deletion with password confirmation.

### Dashboard
Personalised greeting, one-click new analysis, five format cards, saved cases, recent reports, analysis history, activity trend and finding mix.

### Five format workspaces
Each format has its own rubric (five defined dimensions), focus criteria, speech types and format-specific analysis tool:

| Format | Rubric focus | Special tool |
|---|---|---|
| Public Forum | Claim clarity, evidence quality, warranting, impact/weighing, rebuttal extension | Comparative Weighting Analysis (magnitude, probability, timeframe, dropped arguments) |
| Lincoln-Douglas | Framework clarity, framework consistency, philosophical grounding, internal linking, framework interaction | Framework Consistency Checker |
| Policy | Plan clarity, stock issues, DA chain completeness, impact calculus, counterplan/Kritik/T layer | Disadvantage Link Chain Analyzer |
| Congressional | Legislative analysis, evidence integration, organisation, rebuttal/questioning, persuasion/procedure | Legislative Argument Analyzer |
| World Schools | Role adherence, substantive depth, clash, team consistency, comparative analysis | Team Argument Consistency Checker |

The prompt builder includes only the selected format's rubric and instructions, and the backend validates the returned format-specific block against that format. Public Forum standards are never applied to LD, Policy, Congress or World Schools.

### Analysis workspace
Format selection, resolution, side, speech type, optional case attachment, large text editor with character/word counts, keyboard shortcut (Ctrl/Cmd+Enter), loading state with elapsed time, error state with retry.

### Weakness report
Findings grouped into critical, moderate, minor, potential improvement and strong component. Every finding includes:
- a descriptive title and weakness type (`factual_inaccuracy`, `missing_evidence`, `logical_weakness`, `structural_weakness`, `framework_weakness`, `weighing_weakness`, `strategic_judgment`, `clarity`),
- the verbatim passage,
- an explanation and why it matters,
- a suggested improvement,
- a confidence indicator.

Selecting a finding highlights its passage in the speech panel and its node in the argument map. No single opaque "argument score" is produced; only defined format-specific rubric dimensions are scored (1–5) with rationales.

### Interactive argument map
SVG graph generated from the stored analysis: claims, evidence, warrants, impacts, assumptions and counterarguments, with arrows for `supports`, `warrants`, `impacts`, `assumes`, `contradicts` and `rebuts`. Unsupported links are dashed red. Click nodes or edges for source sentences and explanations; filter by type, zoom, pan, and jump to related findings.

### Revision workspace
Side-by-side original and revised editors, word-level diff highlighting, version saving, version history, re-run analysis, and weakness tracking: findings are marked resolved when their passage no longer appears in the revised text, and carried over otherwise.

### Case management
Create, edit, delete, search and filter cases with title, resolution, format, side, notes and structured contentions. Attach analysed speeches to a case; case detail lists all linked speeches, their latest report and revision links.

### History and settings
Searchable, filterable archive of every report with finding counts and deletion. Settings covers profile, password change, AI configuration status, privacy links and permanent account deletion.

---

## Design system

The interface is built from one tokenized system rather than page-specific styling.

- **Palette** — `#111827` background, `#1F2937` surfaces, `#2563EB` accent, `#F9FAFB` / `#9CA3AF` text, `#374151` borders, with `#10B981` / `#D97706` / `#DC2626` reserved for success, warning and error. Light-theme overrides live in `[data-theme="light"]`.
- **Typography** — Manrope for headings, Inter for body copy, IBM Plex Mono for metadata and technical labels. All font files are self-hosted under `public/fonts`, so the CSP can keep `font-src 'self'`.
- **Layout** — an 8-point spacing rhythm, 4–10px radii, a persistent grouped sidebar, and a three-pane report workspace (speech, findings, argument map).
- **Theme** — follows `prefers-color-scheme` on first visit, then remembers the explicit choice in `localStorage`; `theme-init.js` applies it before paint to avoid a flash.
- **Accessibility** — visible focus rings, semantic tabs with arrow-key navigation, reduced-motion support, labelled inputs, and status labels that never rely on colour alone.

## Project structure

```
argument-forensics/
├── public/
│   ├── css/styles.css          Design system and responsive layout
│   ├── js/
│   │   ├── core.js             API client, CSRF header, escaping, toasts, modals
│   │   ├── shell.js            Auth guard, sidebar, topbar, mode banners
│   │   ├── auth.js             Login and registration
│   │   ├── landing.js          Landing page behaviour
│   │   ├── dashboard.js        Dashboard data and charts
│   │   ├── analyzer.js         Analysis form, validation, progress, retry
│   │   ├── report.js           Report tabs, findings, rubric, format tools
│   │   ├── map.js              Interactive SVG argument map
│   │   ├── charts.js           SVG sparkline, donut and bar charts
│   │   ├── diff.js             Word-level diff for revisions
│   │   ├── revise.js           Revision workspace
│   │   ├── cases.js            Case library and editor
│   │   ├── history.js          Analysis archive
│   │   └── settings.js         Account and security settings
│   ├── index.html              Landing page
│   ├── login.html  register.html
│   ├── dashboard.html  analyzer.html  report.html
│   ├── revise.html  cases.html  history.html  settings.html
│   ├── privacy.html  terms.html  404.html
├── src/
│   ├── app.js                  Express app factory
│   ├── config.js               Environment loading and validation
│   ├── database/
│   │   ├── db.js               SQLite wrapper with prepared-statement cache
│   │   ├── schema.sql          Tables, foreign keys and indexes
│   │   └── session-store.js    Persistent express-session store
│   ├── middleware/
│   │   ├── auth.js             Session authentication
│   │   ├── csrf.js             Session-bound CSRF tokens + origin checks
│   │   ├── security.js         Helmet CSP, CORS, rate limiters
│   │   └── error.js            API 404 and central error handler
│   ├── routes/
│   │   ├── auth.js  meta.js  cases.js  speeches.js
│   │   ├── analyses.js  analyze.js  stats.js
│   ├── services/
│   │   ├── formats.js          Five format specifications and rubrics
│   │   ├── analysis-service.js Orchestration, comparison, persistence
│   │   └── ai/
│   │       ├── index.js        Service facade, repair retry, demo fallback
│   │       ├── prompt.js       Format-specific system/user prompts
│   │       ├── provider.js     OpenAI-compatible HTTP adapter
│   │       ├── normalize.js    Strict validation and normalisation
│   │       ├── graph.js        Fallback graph derivation
│   │       └── demo.js         Labelled local heuristic analyser
│   └── utils/
│       ├── errors.js  logger.js  validate.js
├── tests/
│   ├── api.test.js             End-to-end API, auth, isolation, revisions
│   ├── config.test.js          Provider defaults, key isolation, demo fallback
│   ├── prompts.test.js         Per-format prompts and demo behaviour
│   └── helpers/test-server.js
├── server.js
├── .env.example
├── SECURITY.md
└── package.json
```

---

## API reference

All endpoints are JSON. State-changing requests require the `X-CSRF-Token` header matching the `af.csrf` cookie, and a valid session where indicated.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account, start session |
| POST | `/api/auth/login` | – | Authenticate, regenerate session |
| POST | `/api/auth/logout` | – | Destroy session and cookies |
| GET | `/api/auth/me` | – | Current user (401 when signed out) |
| POST | `/api/auth/change-password` | ✓ | Verify and rotate password, revoke other sessions |
| DELETE | `/api/auth/account` | ✓ | Delete account and all data (password required) |
| GET | `/api/meta` | – | Formats, rubrics, labels, AI mode, limits |
| GET | `/api/health` | – | Readiness probe |
| GET | `/api/stats` | ✓ | Dashboard totals, format mix, 30-day trend |
| GET | `/api/cases` | ✓ | List/search/filter cases |
| POST | `/api/cases` | ✓ | Create case |
| GET | `/api/cases/:id` | ✓ | Case + linked speeches |
| PUT | `/api/cases/:id` | ✓ | Update case |
| DELETE | `/api/cases/:id` | ✓ | Delete case (cascades) |
| GET | `/api/speeches/:id` | ✓ | Speech, versions, analyses |
| GET | `/api/speeches/:id/versions` | ✓ | Version list (`?include=content` for text) |
| POST | `/api/speeches/:id/versions` | ✓ | Save a new version |
| DELETE | `/api/speeches/:id` | ✓ | Delete speech (cascades reports) |
| POST | `/api/analyze` | ✓ | Run analysis (live or demo) and persist |
| GET | `/api/analyses` | ✓ | List/search/filter reports |
| GET | `/api/analyses/:id` | ✓ | Full report: summary, findings, graph, rubric, format block |
| DELETE | `/api/analyses/:id` | ✓ | Delete report |

`POST /api/analyze` accepts `{ format, resolution, side, speechType, content, caseId?, speechId?, title? }`. With `speechId`, it creates a new speech version and compares findings against the previous report.

Responses use `{ data }`-style keys (`{ user }`, `{ cases }`, `{ analysis }`, …). Errors use `{ error: { message, code, details? } }` with appropriate status codes (400 validation, 401 unauthenticated, 403 CSRF/origin, 404 not found or not owned, 409 conflict, 413 too large, 429 rate limited, 502 provider failure).

---

## Database

SQLite, WAL mode, foreign keys enabled. Tables:

- `users` — email (unique), bcrypt hash, display name, timestamps
- `sessions` — session id, optional user id, JSON payload, expiry
- `debate_cases` — owner, title, resolution, format, side, notes, contentions JSON
- `speeches` — owner, optional case, metadata, latest version
- `speech_versions` — immutable content per version, label, word count
- `analyses` — owner, speech/version/case links, content snapshot, summary, full result JSON, rubric JSON, format-specific JSON, comparison JSON, provider, model, mode, latency
- `analysis_findings` — category, weakness type, title, passage, explanation, why it matters, suggestion, confidence, node key, tags
- `argument_nodes` — node key, type, label, excerpt, detail, strength
- `argument_edges` — source key, target key, relation, explanation, supported flag

Indexes cover every ownership-scoped listing (`user_id + created_at`, `speech_id`, `case_id`, `analysis_id + category`). All queries are prepared statements with bound parameters.

---

## Testing

```bash
npm test
```

The suite uses Node's built-in test runner against a temporary in-memory database and a real HTTP listener. It covers:

- five formats with distinct rubrics and prompts, and format-specific output for PF, LD, Policy, Congress and WSD
- CSRF rejection, registration validation, duplicate email, password hashing
- session persistence, logout invalidation, wrong-password handling
- anonymous access rejection on protected routes
- case CRUD, validation, search
- analysis persistence: findings, nodes, edges, edge integrity, rubric, format block
- revision flow: new version, resolved/persistent weakness comparison
- cross-user isolation for cases, speeches, analyses and case-linked analysis (all 404)
- input validation for format/side/speech type/length
- provider configuration: xAI and Groq defaults, key isolation and demo fallback
- cascade deletion of analyses when a speech is deleted
- password change revoking old credentials, account deletion removing all rows
- user-scoped statistics

No AI network calls are made in tests; the demo analyser is used.

---

## Production deployment

1. Set `NODE_ENV=production`, a 32+ character `SESSION_SECRET`, `COOKIE_SECURE=true`, and `TRUST_PROXY` appropriate for your proxy.
2. Run behind a TLS-terminating reverse proxy (nginx, Caddy) and keep Node bound to localhost if the proxy is on the same host.
3. Persist the `data/` directory on durable storage and back it up.
4. Run as a non-root user with a systemd unit or process manager; the server handles `SIGTERM` and closes the database cleanly.
5. Set `ALLOWED_ORIGINS` only if you genuinely serve the frontend from another origin (the default same-origin setup does not need it).
6. Review `SECURITY.md` — several controls are explicitly not production-complete.

Suggested systemd environment:

```ini
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=SESSION_SECRET=<48-byte hex>
Environment=COOKIE_SECURE=true
Environment=TRUST_PROXY=1
Environment=AI_PROVIDER=grok
Environment=GROK_API_KEY=<server-side xAI key>
# For Groq instead:
# Environment=AI_PROVIDER=groq
# Environment=GROQ_API_KEY=<server-side Groq key>
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Demo mode" banner | No AI key found, or `AI_DEMO_MODE=true`. Set the matching key (`GROK_API_KEY` for xAI, `GROQ_API_KEY` for Groq) and restart. |
| `401` from the provider | Invalid or revoked key; verify the key and account access. |
| Timeout / `ai_unavailable` | Provider latency or network. Retry, raise `AI_TIMEOUT_MS`, or shorten the speech. |
| `SQLITE_BUSY` under load | Multiple writers; SQLite is single-writer. Reduce concurrency or migrate the database. |
| Login works but session does not persist | `COOKIE_SECURE=true` while serving over plain HTTP, or a proxy not forwarding cookies. |
| 403 on every save | CSRF cookie blocked or a stale page after login. Reload the page. |
| `node:sqlite` not found | Node older than 22.5. Upgrade Node. |

---

## Honest limitations

- AI analysis is evaluative and can be wrong. Every finding links to its passage so it can be checked; confidence is calibrated, not proof.
- Demo mode is a structural heuristic, not an AI model. It detects cues, not meaning.
- Team consistency in World Schools is limited by analysing one speech at a time: cross-speaker contradictions can only be inferred from what a single speech claims about its team line.
- No file uploads, email verification, password reset or MFA in this MVP.
- Rate limiting is per-process, and SQLite is single-node.
- This has not been independently security audited.

## License

MIT.
