import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { listSkills } from './skill-files'

describe('listSkills 同名优先级(用户覆盖内置)', () => {
  it('v0.4.4 精简: 技能生态已移除, listSkills 恒返回空集', () => {
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'hq-skill-pri-'))
    const builtin = join(tmp, 'builtin', 'code-review')
    const user = join(tmp, 'user', 'code-review')
    fs.mkdirSync(builtin, { recursive: true })
    fs.mkdirSync(user, { recursive: true })
    fs.writeFileSync(join(builtin, 'SKILL.md'), '---\ndescription: 内置版本\n---\n', 'utf-8')
    fs.writeFileSync(join(user, 'SKILL.md'), '---\ndescription: 用户定制版本\n---\n', 'utf-8')
    const list = listSkills([join(tmp, 'builtin'), join(tmp, 'user')])
    expect(list).toHaveLength(0)
  })
})
