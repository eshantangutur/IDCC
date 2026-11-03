# Security notes — Argument Forensics

> **This application has not been independently audited. Do not describe it as "secure" or "production hardened" without the reviews listed at the end of this document.**

This document records the security decisions made in this MVP, the threats they address, and what is still missing before a public deployment.

## Threat model

The application stores private competitive-debate material and accepts arbitrary pasted text and uploaded documents. The relevant adversaries are:

1. An unauthenticated visitor trying to register or log in as someone else, exhaust AI quota, or upload files without an account.
2. An authenticated user trying to read, modify or delete another user's cases, speeches, analyses or findings by changing an identifier.
3. An attacker attempting script injection through stored content (speech text, titles, AI output) or reflected input.
4. A cross-site attacker using a victim's browser to submit state-changing requests.
5. An operator error leaking API keys, password hashes or session tokens.
6. A malicious document crafted to exploit a PDF or Word parser, exhaust server memory, or smuggle instructions into the analysis model (prompt injection).

## Implemented controls

### Authentication and sessions

| Control | Implementation |
|---|---|
| Password hashing | `bcryptjs` with cost 12 (configurable, minimum 10), `src/routes/auth.js` |
| Password strength | Minimum 10 characters with at least one letter and one number, `src/utils/validate.js` |
| Login enumeration resistance | Identical `Invalid email or password.` response and a bcrypt comparison against a dummy hash when the account does not exist |
| Session storage | SQLite `sessions` table via a custom `express-session` store, `src/database/session-store.js` |
| Session fixation | `req.session.regenerate()` on registration, login and password change |
| Session expiry | Cookie and database `expires_at`; expired rows are purged on read and every 15 minutes |
| Logout | Destroys the session row and clears cookies |
| Password change | Revokes all other sessions for the user, then regenerates the current one |
| Account deletion | Verifies the current password, deletes the user (all related rows cascade) and destroys the session |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true` (default in production), path `/` |
| Session id visibility | Session ids are never included in API responses or logs |

### Request protection

- **Helmet** sets security headers, including a restrictive Content-Security-Policy: `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `img-src 'self' data:`. Inline scripts and inline event handlers are forbidden. `style-src` permits `'unsafe-inline'` because the interface uses style attributes for layout and chart colours; this does not permit script execution.
- **CSRF**: a 64-character random token lives in the session and is mirrored in a readable `af.csrf` cookie. Every `POST`, `PUT` and `DELETE` under `/api` must send it back in `X-CSRF-Token`. Comparison uses `crypto.timingSafeEqual`. Origin/Referer-derived host checks reject cross-origin state-changing requests.
- **CORS**: requests with an `Origin` header are allowed only for the request's own host or origins listed in `ALLOWED_ORIGINS`. Credentials are permitted only for those origins.
- **Rate limiting**: global API limiter, stricter limiter on `register`, `login` and `change-password`, and a per-user limiter on `/api/analyze`. All limits and windows are configurable.
- **Request size**: JSON bodies capped at 300 kB, form bodies at 20 kB, speech text capped at 20,000 characters server-side. Uploads are limited to one file, 5 MB by default, and 20,000 extracted characters.
- **Input validation**: every route validates types, lengths, enums and identifiers before use; validation errors return field hints without internal detail.
- **SQL injection**: only prepared statements with bound parameters. No route builds SQL from user input; `LIKE` searches escape `%`, `_` and `\`.
- **Authorization**: every query for cases, speeches, versions, analyses and statistics is scoped with `user_id = ?`. Requests for another user's record return `404`, not `403`, so record existence is not disclosed.
- **XSS**: all user-controlled and AI-generated text is inserted into the DOM through `escapeHtml()` in `public/js/core.js`. Argument map labels are set with `textContent`. The CSP blocks inline scripts as a second layer.
- **Uploads**: authenticated multipart endpoint at `/api/extract`, with a per-user rate limit. One file per request, 5 MB default. Files are held in memory, never written to disk, and discarded after extraction. Allowed types are `.txt`, `.md`, `.markdown`, `.docx`, and `.pdf`; text must be valid UTF-8, and PDF/Word files must have matching signatures. DOCX and PDF parsing uses `mammoth` and `pdfjs-dist`, so those parsers process untrusted input inside the Node process and must be kept current. DOCX archives that expand beyond 25 MB are rejected before parsing to limit ZIP-bomb memory use. This is not a malware scanner; scanned PDFs are rejected because they contain no selectable text.
- **Error handling**: unexpected errors return a generic 500 message. Stack traces are logged only outside production. Request bodies, passwords, session ids and API keys are never logged.

### AI integration

- The provider API key is read from the server environment (`GROK_API_KEY`/`XAI_API_KEY` for xAI, `GROQ_API_KEY` for Groq, or the provider-neutral `AI_API_KEY`) and sent only to the selected provider in an `Authorization` header. Keys are not shared across providers. They are never exposed by `/api/meta`, any other endpoint, or any frontend file.
- The provider is configurable (`AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`) and isolated behind `src/services/ai/provider.js`.
- Model output is treated as untrusted: it is parsed as JSON, validated and normalised (`src/services/ai/normalize.js`), length-capped, enum-checked and re-rendered through HTML escaping. A malformed response is retried once and then rejected with a retryable `502`; nothing is persisted.
- Prompt injection: the speech is delimited as untrusted data and the system prompt explicitly instructs the model to ignore instructions inside it. This is mitigation, not a guarantee — a model can still be influenced by text in the speech. Output is schema-validated and rendered as text, so injection cannot execute script.
- Failures never fabricate a result. When no key is configured the response is labelled `mode: "demo"`, stored with `is_demo = 1`, and the UI displays a demo banner explaining that local heuristics, not an AI model, produced the analysis.
- Speech text is sent to the provider only in live mode. Operators must review the provider's data handling before processing sensitive material.

### Data protection and deletion

- SQLite database file lives under `data/` by default and is excluded from version control. File permissions follow the host account running the process.
- Cascade deletes remove sessions, speeches, versions, analyses, findings, nodes and edges when a user or case is deleted. Account deletion verifies the password first.
- No third-party analytics, advertising or trackers are included.
- The `.env` file is gitignored; `.env.example` contains names only.

## Deliberate limitations

- **No email verification, password reset or MFA.** Operators must add these (or restrict registration) before a public launch.
- **Registration reveals whether an email is already registered** via a `409` response. This is a usability trade-off; use an email-verification flow to avoid enumeration if that matters for your deployment.
- **The rate limiter uses in-memory state.** Multiple Node processes or replicas each keep separate counters, so an attacker can multiply the effective limit. Use a shared store for multi-instance deployments.
- **Single SQLite writer.** WAL and a busy timeout are enabled, but SQLite is not a horizontally scalable database. Plan for backups and a migration path if traffic grows.
- **No audit log** of account activity.
- **No CAPTCHA or proof-of-work** on registration.
- **Sessions are not bound to a device fingerprint or IP address.**
- **AI output is not fact.** The interface labels findings as judgments and attaches confidence and source passages, but a model can still report a plausible-sounding error.

## Required reviews before public deployment

- [ ] Independent penetration test of authentication, session management, IDOR and CSRF flows.
- [ ] Dependency audit (`npm audit`, `npm outdated`) and a process for patching.
- [ ] Add email verification, password reset and optional MFA; rate limit by account in addition to IP.
- [ ] Move rate limiting to a shared store (Redis or equivalent) if running more than one process.
- [ ] Terminate TLS at a reverse proxy, set `COOKIE_SECURE=true`, `NODE_ENV=production`, `TRUST_PROXY=1` and a 32+ character `SESSION_SECRET`.
- [ ] Confirm HSTS is appropriate for the domain before enabling preload.
- [ ] Review the AI provider's terms, data-retention policy and data-processing agreement; decide whether speech text may be sent at all.
- [ ] Configure database backups, restore drills and a retention policy.
- [ ] Review logs for accidentally captured personal data and set a retention period.
- [ ] Add monitoring and alerting for authentication failures, 5xx rates and rate-limit saturation.
- [ ] Add a content-security reporting endpoint (CSP `report-to`) and monitor violations.
- [ ] Load test SQLite and the analysis queue under expected concurrency.
- [ ] Fuzz the DOCX and PDF extraction paths, cap parser CPU and memory, and keep `mammoth` and `pdfjs-dist` patched.
- [ ] Document an incident-response procedure and a security contact.
- [ ] Re-check the CSP after any frontend change: inline styles are allowed, inline scripts are not.

## Reporting a vulnerability

Email `security@argumentforensics.app` with reproduction steps and the affected version. Do not open a public issue for a suspected vulnerability.

---

## Round intelligence expansion (v1.1)

### New data and ownership model

Every new table is owned by a user and scoped by `user_id` in the query, not by
an id supplied by the client:

- `rounds`, `round_participants`, `round_speeches`, `round_analyses`
- `round_arguments`, `argument_relationships`, `argument_status_history`
- `round_findings`, `evidence_records`, `evidence_verifications`
- `skill_assessments`, `finding_feedback`, `human_annotations`
- `benchmark_examples`

Foreign keys cascade on delete, so deleting a round removes its speeches,
arguments, relationships, status history, findings, evidence, verifications,
feedback, annotations and round-sourced skill assessments in one transaction.
Tests assert that no orphan rows remain.

Requests that name a foreign id (a speech, argument, relationship, evidence row,
finding or benchmark) validate that the row belongs to the caller before acting.
A cross-user id returns 404, not 403, so the API does not confirm that another
user's record exists.

### Evidence verification honesty

`src/services/evidence-service.js` is a provider registry. The application ships
with no configured provider, and in that state it stores and returns
`status = unavailable` with an explicit message. It does not return a source
title, URL, excerpt or publication date that was not actually retrieved. A
provider failure is recorded as `error`, never as a successful verification.

### AI output handling

- Round responses are validated and normalised before anything is written
  (`src/services/ai/round-normalize.js`). Unknown enum values fall back to safe
  values; relationships referencing an unknown argument are dropped.
- An evidence record whose quotation cannot be found in the speech it is
  attributed to is discarded, because the quotation would be fabricated.
- A finding whose passage cannot be matched keeps the observation but loses the
  quotation and is downgraded to low confidence.
- Model output is never evaluated as code. It is stored as data and escaped on
  render.
- Round text is wrapped in explicit BEGIN/END UNTRUSTED DATA markers, and the
  prompt instructs the model to ignore instructions inside it. This reduces but
  does not eliminate prompt-injection risk: a hostile speech could still bias
  its own analysis. Treat every finding as an opinion to check.

### Human corrections

User corrections are additive. `finding_feedback` and `human_annotations` store
the human value beside the original AI value; no update path overwrites
`analysis_findings` or `round_findings` content. Re-analysis deletes AI-owned
argument rows but preserves rows the user edited, along with their status,
labels and manual relationships.

### Benchmark privacy

`benchmark_examples` defaults to `is_shared = 0`. Nothing in the application
publishes, exports or trains on them. There is no endpoint that lists another
user's benchmarks. Any future sharing feature would need its own consent step.

### Rate limiting and request size

`/api/rounds/:id/analyze` and `/api/evidence/:id/verify` are limited by the AI
limiter, mounted once per path so a request is counted once. JSON bodies are
capped at 300 KB, uploads by `UPLOAD_MAX_BYTES`, and round speech text by
40,000 characters per speech and 30 speeches per round.

### Retention and deletion

- Users can delete any round, speech, analysis, finding feedback or benchmark
  example they own.
- Account deletion removes all owned rows, including the new round tables.
- Session rows are purged on expiry.
- Analysis text is sent to the configured AI provider when live mode is on. In
  demo mode nothing leaves the server.

### Remaining limitations

- No independent security review has been performed.
- Prompt injection through submitted speech text is mitigated, not solved.
- The local demo analyser is deterministic but crude; it is labelled in every
  report and must not be presented as a model judgement.
- Evidence verification depends on an external provider's accuracy once one is
  configured.
- There is no per-round collaborator or coach role yet; all access is per
  account.
