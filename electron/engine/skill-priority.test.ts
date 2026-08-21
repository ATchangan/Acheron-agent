import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { listSkills } from './skill-files'

describe('listSkills 同名优先级(用户覆盖内置)', () => {
  it('后扫描目录同名技能覆盖先扫描目录', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'hq-skill-pri-'))
    const builtin = join(tmp, 'builtin', 'code-review')
    const user = join(tmp, 'user', 'code-review')
    fs.mkdirSync(builtin, { recursive: true })
    fs.mkdirSync(user, { recursive: true })
    fs.writeFileSync(join(builtin, 'SKILL.md'), '---\ndescription: 内置版本\n---\n', 'utf-8')
    fs.writeFileSync(join(user, 'SKILL.md'), '---\ndescription: 用户定制版本\n---\n', 'utf-8')
    const list = listSkills([join(tmp, 'builtin'), join(tmp, 'user')])
    expect(list.length).toBe(1)
    expect(list[0].name).toBe('code-review')
    expect(list[0].description).toBe('用户定制版本')
  })
})
