// electron/engine/v040-context.test.ts — 四要素提炼(M7) + 技能匹配(M8) 单测
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { extractKeyInfo } from './context'
import { matchSkills, scanSkillDetails } from './skill-files'

describe('extractKeyInfo 四要素(M7)', () => {
  it('提炼目标/已完成/产出物/未决', () => {
    const info = extractKeyInfo('写一个脚本', [
      { id: '1', label: '读文件', status: 'done' },
      { id: '2', label: '写脚本', status: 'pending' },
    ], [
      { name: 'write', args: { path: 'C:/a.js' }, error: false },
    ])
    expect(info).toContain('写一个脚本')
    expect(info).toContain('读文件')
    expect(info).toContain('C:/a.js')
    expect(info).toContain('写脚本')
  })

  it('无任务状态返回空串', () => {
    expect(extractKeyInfo('', [], [])).toBe('')
  })
})

describe('matchSkills 技能匹配(M8)', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-skill-'))

  it('triggers 命中优先于 description, 最多 top2', () => {
    fs.mkdirSync(join(dir, 'code-review'), { recursive: true })
    fs.writeFileSync(join(dir, 'code-review', 'SKILL.md'), '---\nname: code-review\ndescription: 代码审查与风险扫描\ntriggers: 审查|review|检查代码\n---\n## 步骤\n1. 读代码\n', 'utf-8')
    fs.mkdirSync(join(dir, 'writing'), { recursive: true })
    fs.writeFileSync(join(dir, 'writing', 'SKILL.md'), '---\nname: writing\ndescription: 写作助手\ntriggers: 写作|文章\n---\n## 步骤\n1. 列提纲\n', 'utf-8')
    const hit = matchSkills([dir], '帮我审查这段代码', 2)
    expect(hit.map(s => s.name)).toContain('code-review')
    expect(hit[0].body).toContain('读代码')
    expect(scanSkillDetails([dir]).length).toBe(2)
  })

  it('无命中返回空', () => {
    expect(matchSkills([dir], '今天天气', 2)).toHaveLength(0)
  })

  fs.rmSync(dir, { recursive: true, force: true })
})
