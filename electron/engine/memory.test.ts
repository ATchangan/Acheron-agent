import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { addLesson, memoryBlockText, memoryPathFor, type EngineMemory } from './memory'

function mem(over: Partial<EngineMemory> = {}): EngineMemory {
  return { facts: [], summaries: [], pinnedFacts: [], lessons: [], ...over }
}

describe('memory 0.3.9 修复与增强', () => {
  it('记忆注入块不再包含乱码占位符, 且包含容量头', () => {
    const text = memoryBlockText(mem({
      pinnedFacts: ['用户偏好 PowerShell'],
      facts: ['项目使用 Electron'],
      summaries: [{ content: '本周完成上下文重构', timestamp: 1 }],
    }), 'PowerShell 怎么用')
    expect(text.includes('??')).toBe(false)
    expect(text).toContain('【记忆容量】')
    expect(text).toContain('## 置顶事实')
    expect(text).toContain('## 事实')
    expect(text).toContain('## 摘要')
  })

  it('事实按相关度取 Top5, 而非简单取末尾', () => {
    const facts = [
      'Python 数据分析项目',
      '用户喜欢喝咖啡',
      'Python 环境在 D:\\py',
      '周末去爬山',
      'Python 脚本用 uv 管理',
      '喜欢听音乐',
      'Python 项目部署到服务器',
      '最近在读小说',
    ]
    const text = memoryBlockText(mem({ facts }), 'Python 项目部署')
    const factLines = text.split('\n').filter(l => /^\d+\. /.test(l) && l.includes('Python'))
    expect(factLines.length).toBeGreaterThanOrEqual(3)
    expect(factLines.length).toBeLessThanOrEqual(5)
    // 与查询无关的"喝咖啡/爬山"不应出现在 Top5
    expect(text).not.toContain('喝咖啡')
    expect(text).not.toContain('爬山')
  })

  it('私有记忆命名空间: memoryScope=private 时使用独立文件', () => {
    expect(memoryPathFor('C:/data/memory.json', 'private', '安全')).toBe(join('C:/data', 'memory-安全.json'))
    expect(memoryPathFor('C:/data/memory.json', 'private', 'a/b:c')).toBe(join('C:/data', 'memory-a_b_c.json'))
    expect(memoryPathFor('C:/data/memory.json', 'global', '安全')).toBe('C:/data/memory.json')
    expect(memoryPathFor('C:/data/memory.json', 'private', '')).toBe('C:/data/memory.json')
  })

  it('addLesson 去重并限制容量(最新优先)', () => {
    const m = mem({ lessons: [] })
    expect(addLesson(m, '教训一')).toBe(true)
    expect(addLesson(m, '教训一')).toBe(false)
    expect(addLesson(m, '教训二')).toBe(true)
    expect(m.lessons?.[0].content).toBe('教训二')
    const tiny = mem({ lessons: [] })
    for (let i = 0; i < 5; i++) addLesson(tiny, '教训' + i, 3)
    expect(tiny.lessons?.length).toBe(3)
    expect(tiny.lessons?.[0].content).toBe('教训4')
  })

  it('教训写入记忆块, 且空记忆返回空串', () => {
    expect(memoryBlockText(mem())).toBe('')
    const text = memoryBlockText(mem({ lessons: [{ content: 'exec 失败要先看 stderr', ts: 1 }] }))
    expect(text).toContain('## 经验教训')
    expect(text).toContain('exec 失败要先看 stderr')
  })
})
