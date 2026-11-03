/**
 * Additive schema migrations.
 *
 * Every migration is idempotent and only creates tables or indexes. Existing
 * rows are never dropped, renamed or rewritten, so an older database can be
 * upgraded in place by starting the server once.
 *
 * The base tables live in schema.js. Anything added after the initial release
 * belongs here so existing deployments pick it up on startup.
 */

export const MIGRATIONS = [
  {
    id: '001_round_intelligence',
    statements: [
      `CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        resolution TEXT NOT NULL,
        side TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'analyzed')),
        last_analyzed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rounds_user_updated ON rounds (user_id, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS round_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        team TEXT,
        side TEXT,
        role TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_participants_round ON round_participants (round_id, position)`,
      `CREATE TABLE IF NOT EXISTS round_speeches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        speaker_name TEXT,
        team TEXT,
        side TEXT NOT NULL,
        speech_type TEXT NOT NULL,
        content TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_round_speeches_round ON round_speeches (round_id, position)`,
      `CREATE TABLE IF NOT EXISTS round_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
        provider TEXT NOT NULL,
        model TEXT,
        latency_ms INTEGER,
        speech_count INTEGER NOT NULL DEFAULT 0,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_round_analyses_round ON round_analyses (round_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS round_arguments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_key TEXT NOT NULL,
        argument_key TEXT,
        side TEXT,
        type TEXT NOT NULL DEFAULT 'claim',
        label TEXT NOT NULL,
        claim TEXT,
        warrant TEXT,
        evidence TEXT,
        impact TEXT,
        assumptions TEXT,
        introduced_speech_id INTEGER REFERENCES round_speeches(id) ON DELETE SET NULL,
        latest_speech_id INTEGER REFERENCES round_speeches(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'unclear',
        status_confidence TEXT NOT NULL DEFAULT 'low',
        status_reason TEXT,
        origin TEXT NOT NULL DEFAULT 'ai',
        human_edited INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (round_id, match_key)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_round_arguments_round ON round_arguments (round_id, position)`,
      `CREATE INDEX IF NOT EXISTS idx_round_arguments_status ON round_arguments (round_id, status)`,
      `CREATE TABLE IF NOT EXISTS argument_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_argument_id INTEGER NOT NULL REFERENCES round_arguments(id) ON DELETE CASCADE,
        target_argument_id INTEGER NOT NULL REFERENCES round_arguments(id) ON DELETE CASCADE,
        relation TEXT NOT NULL,
        explanation TEXT,
        origin TEXT NOT NULL DEFAULT 'ai',
        human_edited INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (round_id, source_argument_id, target_argument_id, relation)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_relationships_round ON argument_relationships (round_id)`,
      `CREATE TABLE IF NOT EXISTS argument_status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        argument_id INTEGER NOT NULL REFERENCES round_arguments(id) ON DELETE CASCADE,
        speech_id INTEGER REFERENCES round_speeches(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        previous_status TEXT,
        reason TEXT,
        origin TEXT NOT NULL DEFAULT 'ai',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_status_history_argument ON argument_status_history (argument_id, id)`,
      `CREATE TABLE IF NOT EXISTS round_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        argument_id INTEGER REFERENCES round_arguments(id) ON DELETE SET NULL,
        category TEXT NOT NULL,
        weakness_type TEXT NOT NULL,
        title TEXT NOT NULL,
        passage TEXT,
        explanation TEXT NOT NULL,
        why_it_matters TEXT,
        suggestion TEXT,
        confidence TEXT NOT NULL DEFAULT 'medium',
        origin TEXT NOT NULL DEFAULT 'ai',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_round_findings_round ON round_findings (round_id, position)`,
      `CREATE TABLE IF NOT EXISTS evidence_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        speech_id INTEGER REFERENCES round_speeches(id) ON DELETE SET NULL,
        argument_id INTEGER REFERENCES round_arguments(id) ON DELETE SET NULL,
        passage TEXT NOT NULL,
        citation TEXT,
        author TEXT,
        published_at TEXT,
        supported_claim TEXT,
        speaker_usage TEXT,
        supports_claim INTEGER,
        assessment TEXT NOT NULL DEFAULT 'unsupported',
        explanation TEXT,
        confidence TEXT NOT NULL DEFAULT 'low',
        origin TEXT NOT NULL DEFAULT 'ai',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_evidence_round ON evidence_records (round_id, position)`,
      `CREATE TABLE IF NOT EXISTS evidence_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        evidence_id INTEGER NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        provider TEXT,
        source_title TEXT,
        source_url TEXT,
        excerpt TEXT,
        published_at TEXT,
        relationship TEXT,
        discrepancy TEXT,
        notes TEXT,
        checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_verifications_evidence ON evidence_verifications (evidence_id, checked_at DESC)`,
    ],
  },
  {
    id: '002_feedback_annotations_benchmarks',
    statements: [
      `CREATE TABLE IF NOT EXISTS finding_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        analysis_id INTEGER REFERENCES analyses(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        speech_id INTEGER REFERENCES round_speeches(id) ON DELETE SET NULL,
        rating TEXT NOT NULL CHECK (rating IN ('accurate', 'partially_accurate', 'inaccurate')),
        comment TEXT,
        suggested_correction TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (user_id, target_type, target_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_feedback_round ON finding_feedback (round_id)`,
      `CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON finding_feedback (analysis_id)`,
      `CREATE TABLE IF NOT EXISTS human_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        analysis_id INTEGER REFERENCES analyses(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        ai_value TEXT,
        human_value TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_annotations_round ON human_annotations (round_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_annotations_analysis ON human_annotations (analysis_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS benchmark_examples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        speech_type TEXT,
        resolution TEXT,
        side TEXT,
        speech_text TEXT NOT NULL,
        expected_json TEXT NOT NULL DEFAULT '{}',
        notes TEXT,
        is_shared INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_benchmarks_user ON benchmark_examples (user_id, updated_at DESC)`,
    ],
  },
  {
    id: '003_skill_assessments',
    statements: [
      `CREATE TABLE IF NOT EXISTS skill_assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        skill_key TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        level INTEGER NOT NULL CHECK (level >= 1 AND level <= 5),
        explanation TEXT,
        passage TEXT,
        recommendation TEXT,
        source_type TEXT NOT NULL,
        source_id INTEGER,
        analysis_id INTEGER REFERENCES analyses(id) ON DELETE CASCADE,
        round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
        origin TEXT NOT NULL DEFAULT 'ai',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_skills_user ON skill_assessments (user_id, format, skill_key, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_skills_round ON skill_assessments (round_id)`,
      `CREATE INDEX IF NOT EXISTS idx_skills_analysis ON skill_assessments (analysis_id)`,
    ],
  },
];

export const SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);`;

/**
 * Apply pending migrations in order. Safe to run on every startup and safe to
 * run against a database that already has some of the tables.
 */
export async function applyMigrations(db, logger = null) {
  await db.run(SCHEMA_MIGRATIONS_SQL);

  let applied = new Set();
  try {
    const rows = await db.all('SELECT id FROM schema_migrations');
    applied = new Set(rows.map((row) => row.id));
  } catch (error) {
    logger?.warn('Could not read the migration ledger; assuming none applied', { error: error.message });
  }

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    for (const statement of migration.statements) {
      await db.run(statement);
    }
    await db.run('INSERT INTO schema_migrations (id) VALUES (?)', migration.id);
    logger?.info('Applied database migration', { migration: migration.id });
  }
}
