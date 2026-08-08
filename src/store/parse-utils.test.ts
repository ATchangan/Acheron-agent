import { describe, expect, it } from 'vitest'
import { parseDispatchTasks } from './parse-utils'

describe('parse-utils', () => {
  it('parseDispatchTasks 兼容三种格式', () => {
    expect(parseDispatchTasks([{ agent: '螺丝咕姆', task: '写代码' }]).length).toBe(1)
    expect(parseDispatchTasks({ tasks: [{ agent: '三月七', task: '读文档' }] }).length).toBe(1)
    expect(parseDispatchTasks('[{"agent":"姬子","task":"调度"}]').length).toBe(1)
    expect(parseDispatchTasks('bad')).toEqual([])
  })

})
