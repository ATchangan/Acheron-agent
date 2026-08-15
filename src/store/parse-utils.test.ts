import { describe, expect, it } from 'vitest'
import { parseDispatchTasks } from './parse-utils'

describe('parse-utils', () => {
  it('parseDispatchTasks 兼容三种格式', () => {
    expect(parseDispatchTasks([{ agent: '开发', task: '写代码' }]).length).toBe(1)
    expect(parseDispatchTasks({ tasks: [{ agent: '文档', task: '读文档' }] }).length).toBe(1)
    expect(parseDispatchTasks('[{"agent":"主控","task":"调度"}]').length).toBe(1)
    expect(parseDispatchTasks('bad')).toEqual([])
  })

})
