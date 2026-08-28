import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { listSkills, parseSkillDescription, resolveSkillFile, validateSkill } from './skill-files'

function makeTmpSkills(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-skill-test-'))
  fs.mkdirSync(join(dir, 'demo'), { recursive: true })
  fs.writeFileSync(join(dir, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: "演示技能"\n---\n# 指令\n1. 先 read 再 write\n', 'utf-8')
  fs.mkdirSync(join(dir, 'demo', 'scripts'), { recursive: true })
  fs.writeFileSync(join(dir, 'demo', 'scripts', 'run.py'), 'print("hi")\n', 'utf-8')
  fs.mkdirSync(join(dir, 'empty'), { recursive: true })
  return dir
}

describe('validateSkill(0.4.3 四规则)', () => {
  const good = '---\nname: demo\ndescription: 演示技能\ntriggers: 演示|demo\n---\n# 演示\n## 步骤\n1. read\n'
  it('合法技能通过', () => {
    expect(validateSkill(good).ok).toBe(true)
    expect(validateSkill(good).problems).toHaveLength(0)
  })
  it('缺 description -> error', () => {
    const r = validateSkill('---\nname: demo\ntriggers: 演示\n---\n## 步骤\n1. read\n')
    expect(r.ok).toBe(false)
    expect(r.problems.some(p => p.level === 'error' && p.msg.includes('description'))).toBe(true)
  })
  it('frontmatter 缺失 -> error', () => {
    const r = validateSkill('name: demo\ndescription: x\n')
    expect(r.ok).toBe(false)
    expect(r.problems.some(p => p.msg.includes('frontmatter'))).toBe(true)
  })
  it('triggers 非法正则 -> error', () => {
    const r = validateSkill('---\nname: demo\ndescription: x\ntriggers: (unclosed\n---\n## 步骤\n1. a\n')
    expect(r.ok).toBe(false)
    expect(r.problems.some(p => p.msg.includes('非法正则'))).toBe(true)
  })
  it('无 triggers + 无结构标题 -> warn 不阻断', () => {
    const r = validateSkill('---\ndescription: 演示技能\n---\n# 演示\n直接说明\n', new Set(['read', 'write']))
    expect(r.ok).toBe(true)
    expect(r.problems.some(p => p.level === 'warn' && p.msg.includes('triggers'))).toBe(true)
  })
  it('未知工具(tools 字段) -> warn 不阻断', () => {
    const r = validateSkill('---\nname: demo\ndescription: x\ntriggers: 演示\ntools: not_a_real_tool\n---\n## 步骤\n1. a\n', new Set(['read', 'write']))
    expect(r.ok).toBe(true)
    expect(r.problems.some(p => p.level === 'warn' && p.msg.includes('未知工具'))).toBe(true)
  })
})

describe('parseSkillDescription', () => {
  it('从 frontmatter 提取 description 并去引号', () => {
    expect(parseSkillDescription('---\nname: x\ndescription: "演示技能"\n---\n正文', 'fallback')).toBe('演示技能')
  })

  it('无 description 时回退', () => {
    expect(parseSkillDescription('---\nname: x\n---\n正文', 'fallback')).toBe('fallback')
  })
})

describe('listSkills', () => {
  it('v0.4.4 精简: 技能生态已移除, listSkills 恒返回空集', () => {
    const dir = makeTmpSkills()
    try {
      const skills = listSkills([dir])
      expect(skills).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveSkillFile', () => {
  it('解析 SKILL.md 与技能内脚本', () => {
    const dir = makeTmpSkills()
    try {
      expect(resolveSkillFile([dir], 'demo', 'SKILL.md')).toBe(join(dir, 'demo', 'SKILL.md'))
      expect(resolveSkillFile([dir], 'demo', 'scripts/run.py')).toBe(join(dir, 'demo', 'scripts', 'run.py'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('拒绝路径穿越与未知技能', () => {
    const dir = makeTmpSkills()
    try {
      expect(resolveSkillFile([dir], 'demo', '../secret.txt')).toBeNull()
      expect(resolveSkillFile([dir], '..', 'SKILL.md')).toBeNull()
      expect(resolveSkillFile([dir], 'nope', 'SKILL.md')).toBeNull()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
