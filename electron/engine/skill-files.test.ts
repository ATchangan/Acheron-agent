import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { listSkills, parseSkillDescription, resolveSkillFile } from './skill-files'

function makeTmpSkills(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-skill-test-'))
  fs.mkdirSync(join(dir, 'demo'), { recursive: true })
  fs.writeFileSync(join(dir, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: "演示技能"\n---\n# 指令\n1. 先 read 再 write\n', 'utf-8')
  fs.mkdirSync(join(dir, 'demo', 'scripts'), { recursive: true })
  fs.writeFileSync(join(dir, 'demo', 'scripts', 'run.py'), 'print("hi")\n', 'utf-8')
  fs.mkdirSync(join(dir, 'empty'), { recursive: true })
  return dir
}

describe('parseSkillDescription', () => {
  it('从 frontmatter 提取 description 并去引号', () => {
    expect(parseSkillDescription('---\nname: x\ndescription: "演示技能"\n---\n正文', 'fallback')).toBe('演示技能')
  })

  it('无 description 时回退', () => {
    expect(parseSkillDescription('---\nname: x\n---\n正文', 'fallback')).toBe('fallback')
  })
})

describe('listSkills', () => {
  it('只列出含 SKILL.md 的目录', () => {
    const dir = makeTmpSkills()
    try {
      const skills = listSkills([dir])
      expect(skills.map(s => s.name)).toEqual(['demo'])
      expect(skills[0].description).toBe('演示技能')
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
