// electron/db/migrate.ts — 版本化迁移(meta.schema_version 记录, 每步包事务)
import { allSchemaDdl } from './schema'

export const SCHEMA_VERSION = 1

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
