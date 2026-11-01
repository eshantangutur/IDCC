export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS debate_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  resolution TEXT NOT NULL,
  format TEXT NOT NULL,
  side TEXT NOT NULL,
  notes TEXT,
  contentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_cases_user_updated ON debate_cases (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS speeches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id INTEGER REFERENCES debate_cases(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  side TEXT NOT NULL,
  speech_type TEXT NOT NULL,
  resolution TEXT NOT NULL,
  latest_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_speeches_user_updated ON speeches (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_speeches_case ON speeches (case_id);

CREATE TABLE IF NOT EXISTS speech_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  speech_id INTEGER NOT NULL REFERENCES speeches(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  label TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (speech_id, version)
);
CREATE INDEX IF NOT EXISTS idx_versions_speech ON speech_versions (speech_id, version DESC);

CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  speech_id INTEGER REFERENCES speeches(id) ON DELETE CASCADE,
  speech_version_id INTEGER REFERENCES speech_versions(id) ON DELETE SET NULL,
  case_id INTEGER REFERENCES debate_cases(id) ON DELETE SET NULL,
  format TEXT NOT NULL,
  side TEXT NOT NULL,
  speech_type TEXT NOT NULL,
  resolution TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  rubric_json TEXT NOT NULL DEFAULT '{}',
  format_specific_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL,
  comparison_json TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON analyses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_speech ON analyses (speech_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_user_format ON analyses (user_id, format);

CREATE TABLE IF NOT EXISTS analysis_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  weakness_type TEXT NOT NULL,
  title TEXT NOT NULL,
  passage TEXT NOT NULL,
  explanation TEXT NOT NULL,
  why_it_matters TEXT,
  suggestion TEXT,
  confidence TEXT NOT NULL,
  node_key TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_findings_analysis ON analysis_findings (analysis_id, category);

CREATE TABLE IF NOT EXISTS argument_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  excerpt TEXT,
  detail TEXT,
  strength TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (analysis_id, node_key)
);

CREATE TABLE IF NOT EXISTS argument_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  relation TEXT NOT NULL,
  explanation TEXT,
  supported INTEGER NOT NULL DEFAULT 1,
  UNIQUE (analysis_id, source_key, target_key, relation)
);
CREATE INDEX IF NOT EXISTS idx_edges_analysis ON argument_edges (analysis_id);
`;
