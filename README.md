# Argument Forensics

**Dissect Arguments. Expose Weaknesses. Strengthen Reasoning.**

A full-stack debate-analysis workspace for competitive debaters. Argument Forensics reconstructs the logical structure of a speech into claims, warrants, evidence, impacts, hidden assumptions and counterarguments, then reports weaknesses with the exact passage, an explanation, why it matters, a suggested revision and a confidence indicator.

The frontend is plain HTML, CSS and ES modules. The backend is Node.js + Express with SQLite. AI analysis runs behind a server-side provider abstraction (xAI Grok by default, with built-in Groq support) and falls back to a clearly labelled local demo analyser when no credentials are configured.

---

## Deployment

### Vercel

Vercel Functions cannot write to the deployment filesystem. Production on Vercel therefore uses [Turso](https://turso.tech), a hosted SQLite-compatible database. Local development still uses the SQLite file in `data/`.

1. Open the project in Vercel and add Turso from the Vercel Marketplace.
2. Create a database and connect it to the project so `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are added to Production and Preview.
3. Add `SESSION_SECRET` with at least 32 characters.
4. Add `GROQ_API_KEY` or `GROK_API_KEY` for live analysis, or set `AI_PROVIDER=demo` to use the built-in demo analyser.
5. Redeploy the project.

If `TURSO_DATABASE_URL` is missing on Vercel, the server stops with a clear configuration error instead of trying to write a local database file.

Vercel limits request bodies to 4.5 MB. If you plan to upload files on Vercel, set `UPLOAD_MAX_BYTES` to `4194304` or lower.

## License

MIT.
