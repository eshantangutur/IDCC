# Argument Forensics

**Dissect Arguments. Expose Weaknesses. Strengthen Reasoning.**

A full-stack debate-analysis workspace for competitive debaters. Argument Forensics reconstructs the logical structure of a speech into claims, warrants, evidence, impacts, hidden assumptions and counterarguments, then reports weaknesses with the exact passage, an explanation, why it matters, a suggested revision and a confidence indicator.

The frontend is plain HTML, CSS and ES modules. The backend is Node.js + Express with SQLite. AI analysis runs behind a server-side provider abstraction (xAI Grok by default, with built-in Groq support) and falls back to a clearly labelled local demo analyser when no credentials are configured.

---



## License

MIT.
