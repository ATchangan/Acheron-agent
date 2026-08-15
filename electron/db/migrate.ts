// electron/db/migrate.ts — 版本化迁移(meta.schema_version 记录, 每步包事务)
import { allSchemaDdl } from './schema'

export const SCHEMA_VERSION = 2

interface DbLike {
  exec(sql: string): void
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown }
}

interface MigrationStep { version: number; up: (db: DbLike) => void }

// 增量迁移列表: 未来加表/改表在尾部追加新 step, 不修改已发布 step
const STEPS: MigrationStep[] = [
  {
    version: 1,
    up: (db) => {
      for (const ddl of allSchemaDdl()) db.exec(ddl)
    },
  },
  {
    // v0.4.0 定稿: lessons/goals/episodic 三张表(已含在 allSchemaDdl 中, 老库升级时补建)
    version: 2,
    up: (db) => {
      db.exec(
        `CREATE TABLE IF NOT EXISTS lessons (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           agent TEXT NOT NULL DEFAULT '助手',
           scope TEXT NOT NULL DEFAULT 'global',
           content TEXT NOT NULL,
           ts INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_lessons_agent ON lessons(agent, scope, ts);
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
         CREATE TABLE IF NOT EXISTS episodic (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           agent TEXT NOT NULL DEFAULT '助手',
           scope TEXT NOT NULL DEFAULT 'global',
           op TEXT,
           path TEXT,
           status TEXT,
           ts INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic(agent, scope, ts);`
      )
    },
  },
]

function currentVersion(db: DbLike): number {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value?: string } | undefined
    return row?.value ? Number(row.value) || 0 : 0
  } catch { return 0 }
}

export function migrate(db: DbLike): void {
  let from = currentVersion(db)
  for (const step of STEPS) {
    if (step.version <= from) continue
    db.exec('BEGIN')
    try {
      step.up(db)
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)").run(String(step.version))
      db.exec('COMMIT')
      from = step.version
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
