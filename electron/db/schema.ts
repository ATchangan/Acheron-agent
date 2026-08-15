// electron/db/schema.ts — SQLite DDL 集中管理(所有建表语句唯一来源)
// 引擎运行时使用 node:sqlite(Electron 43 内置 SQLite 3.53 + FTS5/trigram, 零原生依赖)

// v0.4.0 M4: 四层记忆金字塔(L0 原始记录 → L1 原子事实 → L2 场景记忆 → L3 核心结论)
// 每层带 source_id 指向下层, 支持逐级下钻溯源; superseded 标记软删除, 不物理删除
export const MEMORIES_DDL = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL DEFAULT '助手',
  scope TEXT NOT NULL DEFAULT 'global',
  level TEXT NOT NULL DEFAULT 'normal',
  layer TEXT NOT NULL DEFAULT 'L1',
  content TEXT NOT NULL,
  subject TEXT,
  relation TEXT,
  object TEXT,
  embedding TEXT,
  source_id INTEGER,
  ts INTEGER NOT NULL,
  last_access INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  superseded INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_mem_agent ON memories(agent, scope);
CREATE INDEX IF NOT EXISTS idx_mem_layer ON memories(layer, superseded);
CREATE INDEX IF NOT EXISTS idx_mem_level ON memories(level);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content, subject, relation, object,
  tokenize='trigram'
);
`

// FTS 同步触发器: 仅插入时同步。
// trigram 分词器不支持 FTS5 逐行 'delete' 命令; 本设计中 content 插入后不再变更,
// 软删除(superseded)由查询侧过滤, 因此无需 UPDATE/DELETE 触发器。
export const MEMORIES_FTS_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS mem_fts_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, subject, relation, object)
  VALUES (new.id, new.content, coalesce(new.subject, ''), coalesce(new.relation, ''), coalesce(new.object, ''));
END;
`

export const TOOL_OUTPUTS_DDL = `
CREATE TABLE IF NOT EXISTS tool_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL,
  tool TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_to_sid ON tool_outputs(sid, ts);
`

export const AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  agent TEXT,
  tool TEXT,
  args_summary TEXT,
  result_summary TEXT,
  duration_ms INTEGER,
  tokens INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit(tool);
`

export const SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  agent TEXT,
  title TEXT,
  state_json TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
`

// 会话全文索引: contentless FTS5(trigram), rowid 与 session_chunks 对齐
export const SESSION_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS session_chunks (
  sid TEXT NOT NULL,
  role TEXT NOT NULL,
  snippet TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS session_chunks_fts USING fts5(snippet, tokenize='trigram', content='');
`

export const SKILLS_DDL = `
CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  description TEXT,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER
);
`

// v0.4.0 定稿: 失败教训 / 目标 / 情景(操作追溯)从 memory.json 并入 SQLite
export const LESSONS_DDL = `
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL DEFAULT '助手',
  scope TEXT NOT NULL DEFAULT 'global',
  content TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_agent ON lessons(agent, scope, ts);
`

export const GOALS_DDL = `
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL DEFAULT '助手',
  scope TEXT NOT NULL DEFAULT 'global',
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_agent ON goals(agent, scope, updated);
`

export const EPISODIC_DDL = `
CREATE TABLE IF NOT EXISTS episodic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL DEFAULT '助手',
  scope TEXT NOT NULL DEFAULT 'global',
  op TEXT,
  path TEXT,
  status TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic(agent, scope, ts);
`

export const META_DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`

export function allSchemaDdl(): string[] {
  return [MEMORIES_DDL, MEMORIES_FTS_TRIGGERS, TOOL_OUTPUTS_DDL, AUDIT_DDL, SESSIONS_DDL, SESSION_INDEX_DDL, SKILLS_DDL, LESSONS_DDL, GOALS_DDL, EPISODIC_DDL, META_DDL]
}
