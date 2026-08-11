import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { safeSkillName, writableSkillDir } from './skill-files'

describe('skill-files 0.3.9 技能管理辅助', () => {
  it('safeSkillName 过滤路径分隔符与非法字符', () => {
    expect(safeSkillName('web 抓取')).toBe('web 抓取')
    expect(safeSkillName('a/b\\c:d')).toBe('abcd')
    expect(safeSkillName('../x')).toBe('x')
    expect(safeSkillName('')).toBe('')
    expect(safeSkillName('x'.repeat(60))).toHaveLength(40)
  })

  it('writableSkillDir 跳过不存在的目录, 返回可写目录', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'hq-skill-'))
    const missing = join(tmp, 'nope')
    expect(writableSkillDir([missing])).toBeNull()
    expect(writableSkillDir([missing, tmp])).toBe(tmp)
  })
})
